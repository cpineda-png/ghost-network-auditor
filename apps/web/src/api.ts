import {
  COLD_RUN_ID,
  WARM_RUN_ID,
  fixtureDiffCsv,
  fixtureReceipts,
  fixtureRun,
  fixtureTrust,
} from "./fixtures";
import { z } from "zod";
import {
  evidenceCardSchema,
  receiptSchema,
  rulingSchema,
  runReportSchema,
  runRequestSchema,
  trustRowSchema,
  wmEventSchema,
  type EvidenceCard,
  type Receipt,
  type Ruling,
  type RunReport,
  type RunRequest,
  type TrustRow,
  type WmEvent,
} from "./types";

export { COLD_RUN_ID, WARM_RUN_ID };

const EVENT_DELAY_MS = 100;

export function usingFixtures(): boolean {
  const flag = import.meta.env.VITE_USE_FIXTURES;
  return flag === undefined || flag === "" || flag === "true";
}

export async function getHealth(): Promise<{ llmReplay?: boolean }> {
  if (usingFixtures()) {
    return { llmReplay: true };
  }
  const response = await fetch("/api/health");
  if (!response.ok) {
    throw new Error("health failed");
  }
  return response.json() as Promise<{ llmReplay?: boolean }>;
}

export async function createRun(request: RunRequest): Promise<{ runId: string }> {
  const body = runRequestSchema.parse(request);
  if (usingFixtures()) {
    return { runId: body.useMemory === false ? COLD_RUN_ID : WARM_RUN_ID };
  }
  return z.object({ runId: z.string() }).parse(await postJson("/runs", body));
}

export function streamEvents(
  runId: string,
  onEvent: (event: WmEvent) => void,
  onDone?: () => void,
): () => void {
  if (usingFixtures()) {
    const events = fixtureRun(runId)?.events ?? [];
    let index = 0;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      if (cancelled) return;
      if (index >= events.length) {
        onDone?.();
        return;
      }
      const parsed = wmEventSchema.parse(events[index]);
      index += 1;
      onEvent(parsed);
      timer = setTimeout(tick, EVENT_DELAY_MS);
    };
    timer = setTimeout(tick, EVENT_DELAY_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }

  const source = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events`);
  source.onmessage = (message) => {
    try {
      const parsed = wmEventSchema.safeParse(JSON.parse(message.data));
      if (parsed.success) onEvent(parsed.data);
    } catch {
      /* ignore frames that are not events */
    }
  };
  source.onerror = () => {
    source.close();
    onDone?.();
  };
  return () => source.close();
}

export async function getCards(runId: string): Promise<EvidenceCard[]> {
  if (usingFixtures()) {
    return evidenceCardSchema.array().parse(fixtureRun(runId)?.cards ?? []);
  }
  return evidenceCardSchema.array().parse(await getJson(`/runs/${encodeURIComponent(runId)}/cards`));
}

export async function postRuling(ruling: Ruling): Promise<Ruling> {
  const body = rulingSchema.parse(ruling);
  if (usingFixtures()) {
    return body;
  }
  return rulingSchema.parse(await postJson("/rulings", body));
}

export async function getTrust(): Promise<TrustRow[]> {
  if (usingFixtures()) {
    return trustRowSchema.array().parse(fixtureTrust);
  }
  return trustRowSchema.array().parse(await getJson("/memory/trust"));
}

export async function getReport(runId: string): Promise<RunReport> {
  if (usingFixtures()) {
    const report = fixtureRun(runId)?.report;
    if (!report) {
      throw new Error(`Unknown run ${runId}`);
    }
    return runReportSchema.parse(report);
  }
  return runReportSchema.parse(await getJson(`/runs/${encodeURIComponent(runId)}/report`));
}

export async function getDiffCsv(runId: string): Promise<string> {
  if (usingFixtures()) {
    return fixtureDiffCsv;
  }
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/diff.csv`);
  if (!response.ok) {
    throw new Error("diff failed");
  }
  return response.text();
}

export async function getReceipt(receiptId: string): Promise<Receipt> {
  if (usingFixtures()) {
    const receipt = fixtureReceipts.find((item) => item.receiptId === receiptId);
    if (!receipt) {
      throw new Error(`Unknown receipt ${receiptId}`);
    }
    return receiptSchema.parse(receipt);
  }
  return receiptSchema.parse(await getJson(`/receipts/${encodeURIComponent(receiptId)}`));
}

async function getJson(path: string): Promise<unknown> {
  const response = await fetch(`/api${path}`);
  if (!response.ok) {
    throw new Error(`${path} failed: ${response.status}`);
  }
  return response.json() as Promise<unknown>;
}

async function postJson(path: string, body: unknown): Promise<unknown> {
  const response = await fetch(`/api${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${path} failed: ${response.status}`);
  }
  return response.json() as Promise<unknown>;
}
