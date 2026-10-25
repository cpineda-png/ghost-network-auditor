import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EvidenceCard, RunReport, TrustRow, WmEvent } from "./types";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const finished: WmEvent = {
  eventId: "evt-1",
  runId: "run-9",
  ts: "2026-04-02T14:00:01.000Z",
  actor: "planner",
  type: "run_finished",
  entityId: "run:run-9",
  payload: {},
};

const report: RunReport = {
  runId: "run-9",
  useMemory: true,
  listings: 1,
  applied: 0,
  escalated: 1,
  retried: 0,
  ghosts: 1,
  memoryHits: 0,
  models: [{ model: "nemotron-super", calls: 2 }],
};

const trust: TrustRow = {
  source: "roster",
  field: "status",
  helpful: 1,
  notHelpful: 0,
  wrong: 0,
  score: 1,
};

const ghost: EvidenceCard = {
  runId: "run-9",
  listingId: "listing:plan:L-00002",
  field: "status",
  sources: [
    { source: "directory", value: "accepting", receiptIds: ["rcpt-dir"] },
    { source: "roster", value: "terminated", receiptIds: ["rcpt-roster"] },
  ],
  winner: null,
  confidence: 0.42,
  rationale: "Terminated in the roster while the directory still lists the provider.",
  critique: null,
  status: "escalated",
  memoryIds: [],
};

class SilentEventSource {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  close() {}
}

class FinishingEventSource {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(_url: string) {
    queueMicrotask(() => {
      this.onmessage?.({ data: JSON.stringify(finished) } as MessageEvent);
    });
  }
  close() {}
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function renderApp() {
  vi.stubEnv("VITE_USE_FIXTURES", "false");
  const { default: App } = await import("./App");
  render(<App />);
}

describe("demo path", () => {
  it("posts the launcher RunRequest and shows the run id", async () => {
    const user = userEvent.setup();
    let runBody: unknown;
    let releaseRun: (response: Response) => void = () => undefined;
    const runPosted = new Promise<Response>((resolve) => {
      releaseRun = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/health") return json({ ok: true, llmReplay: true });
        if (url === "/api/memory/trust") return json([]);
        if (url === "/api/runs" && init?.method === "POST") {
          runBody = JSON.parse(String(init.body));
          return runPosted;
        }
        return json({ error: "missing" }, 500);
      }),
    );
    vi.stubGlobal("EventSource", SilentEventSource);
    await renderApp();

    await user.click(screen.getByRole("checkbox", { name: "Use memory" }));
    await user.click(screen.getByRole("button", { name: "Start" }));

    expect(await screen.findByText("Starting run…")).toBeInTheDocument();
    expect(runBody).toEqual({ scope: { batch: "A" }, useMemory: false });
    releaseRun(json({ runId: "run-9" }));
    expect(await screen.findByText("Run run-9")).toBeInTheDocument();
    expect(screen.getByText("REPLAY")).toBeInTheDocument();
  });

  it("posts a ruling, disables the controls, and refreshes trust", async () => {
    const user = userEvent.setup();
    let rulingBody: unknown;
    let ruled = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/health") return json({ ok: true, llmReplay: false });
        if (url === "/api/memory/trust") return json(ruled ? [trust] : []);
        if (url === "/api/runs" && init?.method === "POST") return json({ runId: "run-9" });
        if (url === "/api/runs/run-9/cards") return json([ghost]);
        if (url === "/api/runs/run-9/report") return json(report);
        if (url === "/api/runs/run-9/diff.csv") return new Response("listing_id,field\n", { status: 200 });
        if (url === "/api/rulings" && init?.method === "POST") {
          rulingBody = JSON.parse(String(init.body));
          ruled = true;
          return json({ memoryId: "mem-9" });
        }
        return json({ error: "missing" }, 500);
      }),
    );
    vi.stubGlobal("EventSource", FinishingEventSource);
    await renderApp();

    await user.click(screen.getByRole("button", { name: "Start" }));
    expect((await screen.findAllByText("Possible ghost, needs analyst")).length).toBeGreaterThan(0);
    const roster = await screen.findAllByRole("radio", { name: /roster: terminated/ });
    await user.click(roster[0]);
    const submits = screen.getAllByRole("button", { name: "Submit ruling" });
    await user.click(submits[0]);

    await waitFor(() => {
      expect(rulingBody).toEqual({
        runId: "run-9",
        listingId: "listing:plan:L-00002",
        field: "status",
        value: "terminated",
        source: "roster",
        analyst: "analyst",
      });
    });
    expect(screen.getAllByText("Memory mem-9").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Submit ruling" }).every((button) => button.hasAttribute("disabled"))).toBe(
      true,
    );
    expect(await screen.findByRole("cell", { name: "1.00" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "roster" })).toBeInTheDocument();
  });

  it("shows the error when the report failed", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/health") return json({ ok: true, llmReplay: false });
        if (url === "/api/memory/trust") return json([]);
        if (url === "/api/runs" && init?.method === "POST") return json({ runId: "run-9" });
        if (url === "/api/runs/run-9/cards") return json([]);
        if (url === "/api/runs/run-9/report") {
          return json({ ...report, status: "failed", error: "nightshift down" });
        }
        if (url === "/api/runs/run-9/diff.csv") return new Response("listing_id,field\n", { status: 200 });
        return json({ error: "missing" }, 500);
      }),
    );
    vi.stubGlobal("EventSource", FinishingEventSource);
    await renderApp();

    await user.click(screen.getByRole("button", { name: "Start" }));
    expect(await screen.findByText("run failed: nightshift down")).toBeInTheDocument();
  });
});
