import { afterEach, describe, expect, it, vi } from "vitest";
import { AGENTS_UNREACHABLE } from "./api";
import type { EvidenceCard, Receipt, RunReport, TrustRow, WmEvent } from "./types";

const card: EvidenceCard = {
  runId: "run-1",
  listingId: "listing:plan:L-00001",
  field: "address",
  sources: [{ source: "claims", value: "400 Harbor Ave", receiptIds: ["rcpt-1"] }],
  winner: { value: "400 Harbor Ave", source: "claims" },
  confidence: 0.91,
  rationale: "Claims address is current.",
  critique: { verdict: "pass", reasons: ["Receipt matches."] },
  status: "applied",
  memoryIds: [],
};

const report: RunReport = {
  runId: "run-1",
  useMemory: true,
  listings: 1,
  applied: 1,
  escalated: 0,
  retried: 0,
  ghosts: 0,
  memoryHits: 0,
  models: [{ model: "nemotron-super", calls: 1 }],
};

const trust: TrustRow = {
  source: "claims",
  field: "address",
  helpful: 1,
  notHelpful: 0,
  wrong: 0,
  score: 1,
};

const receipt: Receipt = {
  receiptId: "rcpt-1",
  runId: "run-1",
  templateId: "claims_locations_by_npi",
  sql: "SELECT practice_address FROM claims WHERE npi = $npi",
  params: { npi: "1234567893" },
  sources: ["claims"],
  rowCount: 1,
  rowsHash: "hash-rcpt-1",
  rowsPreview: [{ practice_address: "400 Harbor Ave" }],
  executedAt: "2026-04-02T14:00:00.000Z",
  mode: "live",
  durationMs: 12,
};

const finished: WmEvent = {
  eventId: "evt-1",
  runId: "run-1",
  ts: "2026-04-02T14:00:01.000Z",
  actor: "planner",
  type: "run_finished",
  entityId: "run:run-1",
  payload: { model: "nemotron-super", latencyMs: 20, replayed: false },
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("agents api", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("calls the agents routes with fetch and reads an SSE event", async () => {
    vi.stubEnv("VITE_USE_FIXTURES", "false");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/health") return json({ ok: true, llmReplay: false });
      if (url === "/api/runs" && init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toEqual({
          scope: { batch: "A" },
          useMemory: true,
        });
        return json({ runId: "run-1" });
      }
      if (url === "/api/runs/run-1/cards") return json([card]);
      if (url === "/api/runs/run-1/report") return json(report);
      if (url === "/api/memory/trust") return json([trust]);
      if (url === "/api/runs/run-1/diff.csv") return new Response("listing_id,field\n", { status: 200 });
      if (url === "/api/receipts/rcpt-1") return json(receipt);
      if (url === "/api/receipts/rcpt-1/replay" && init?.method === "POST") {
        return json({
          receiptId: "rcpt-1",
          match: false,
          originalRowsHash: receipt.rowsHash,
          newRowsHash: "other",
          rows: [],
        });
      }
      if (url === "/api/runs/run-failed/report") {
        return json({ ...report, runId: "run-failed", status: "failed", error: "nightshift down" });
      }
      if (url === "/api/rulings" && init?.method === "POST") return json({ memoryId: "mem-1" });
      return json({ error: "missing" }, 500);
    });
    vi.stubGlobal("fetch", fetchMock);

    const events: WmEvent[] = [];
    let streamUrl = "";
    class FakeEventSource {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(url: string) {
        streamUrl = url;
        queueMicrotask(() => {
          this.onmessage?.({ data: JSON.stringify(finished) } as MessageEvent);
        });
      }
      close() {}
    }
    vi.stubGlobal("EventSource", FakeEventSource);

    const api = await import("./api");
    expect(api.usingFixtures()).toBe(false);
    await expect(api.getHealth()).resolves.toEqual({ ok: true, llmReplay: false });
    await expect(api.createRun({ scope: { batch: "A" }, useMemory: true })).resolves.toEqual({ runId: "run-1" });
    await expect(api.getCards("run-1")).resolves.toEqual([card]);
    await expect(api.getReport("run-1")).resolves.toEqual(report);
    await expect(api.getTrust()).resolves.toEqual([trust]);
    await expect(api.getDiffCsv("run-1")).resolves.toBe("listing_id,field\n");
    await expect(api.getReceipt("rcpt-1")).resolves.toEqual(receipt);
    await expect(api.replayReceipt("rcpt-1")).resolves.toMatchObject({ receiptId: "rcpt-1", match: false });
    await expect(api.getReport("run-failed")).resolves.toMatchObject({
      runId: "run-failed",
      status: "failed",
      error: "nightshift down",
    });
    await expect(
      api.postRuling({
        runId: "run-1",
        listingId: card.listingId,
        field: "address",
        value: "400 Harbor Ave",
        source: "claims",
        analyst: "analyst",
      }),
    ).resolves.toEqual({ memoryId: "mem-1" });

    const done = new Promise<boolean>((resolve) => {
      api.streamEvents("run-1", (event) => events.push(event), (result) => resolve(result.ok));
    });
    await expect(done).resolves.toBe(true);
    expect(streamUrl).toBe("/api/runs/run-1/events");
    expect(events).toEqual([finished]);

    fetchMock.mockRejectedValue(new Error("connection refused"));
    await expect(api.getHealth()).rejects.toThrow(AGENTS_UNREACHABLE);
  });
});
