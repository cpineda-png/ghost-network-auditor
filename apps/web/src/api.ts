import { z } from "zod";
import {
  COLD_RUN_ID,
  WARM_RUN_ID,
  fixtureDiffCsv,
  fixtureReceipts,
  fixtureRun,
  fixtureTrust,
} from "./fixtures";
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

export const AGENTS_UNREACHABLE = "Agents service is unreachable";

const EVENT_DELAY_MS = 100;
const READY_ATTEMPTS = 8;
const READY_DELAY_MS = 150;

const rulingStoredSchema = z.object({ memoryId: z.string() });

export type StreamDone = { ok: boolean };

export function usingFixtures(): boolean {
  return import.meta.env.VITE_USE_FIXTURES === "true";
}

export function errorText(reason: unknown): string {
  if (reason instanceof Error && reason.message) return reason.message;
  return AGENTS_UNREACHABLE;
}

export async function getHealth(): Promise<{ llmReplay?: boolean }> {
  if (usingFixtures()) {
    return { llmReplay: true };
  }
  const response = await request("/health");
  return response.json() as Promise<{ llmReplay?: boolean }>;
}

export async function createRun(request: RunRequest): Promise<{ runId: string }> {
  const body = runRequestSchema.parse(request);
  if (usingFixtures()) {
    return { runId: body.useMemory === false ? COLD_RUN_ID : WARM_RUN_ID };
  }
  return read(z.object({ runId: z.string() }), await postJson("/runs", body), "runs");
}

export function streamEvents(
  runId: string,
  onEvent: (event: WmEvent) => void,
  onDone?: (result: StreamDone) => void,
): () => void {
  if (usingFixtures()) {
    const events = fixtureRun(runId)?.events ?? [];
    let index = 0;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      if (cancelled) return;
      if (index >= events.length) {
        onDone?.({ ok: true });
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
  let settled = false;
  const finish = (ok: boolean) => {
    if (settled) return;
    settled = true;
    source.close();
    onDone?.({ ok });
  };
  source.onmessage = (message) => {
    let parsed: ReturnType<typeof wmEventSchema.safeParse>;
    try {
      parsed = wmEventSchema.safeParse(JSON.parse(message.data));
    } catch {
      return;
    }
    if (!parsed.success) return;
    onEvent(parsed.data);
    const runFailed = parsed.data.type === "escalated" && parsed.data.entityId.startsWith("run:");
    if (parsed.data.type === "run_finished" || runFailed) finish(true);
  };
  source.onerror = () => finish(false);
  return () => {
    settled = true;
    source.close();
  };
}

export async function getCards(runId: string): Promise<EvidenceCard[]> {
  if (usingFixtures()) {
    return evidenceCardSchema.array().parse(fixtureRun(runId)?.cards ?? []);
  }
  return read(evidenceCardSchema.array(), await getJson(`/runs/${encodeURIComponent(runId)}/cards`, true), "cards");
}

export async function postRuling(ruling: Ruling): Promise<Ruling> {
  const body = rulingSchema.parse(ruling);
  if (usingFixtures()) {
    return body;
  }
  read(rulingStoredSchema, await postJson("/rulings", body), "rulings");
  return body;
}

export async function getTrust(): Promise<TrustRow[]> {
  if (usingFixtures()) {
    return trustRowSchema.array().parse(fixtureTrust);
  }
  return read(trustRowSchema.array(), await getJson("/memory/trust"), "trust");
}

export async function getReport(runId: string): Promise<RunReport> {
  if (usingFixtures()) {
    const report = fixtureRun(runId)?.report;
    if (!report) {
      throw new Error(`Unknown run ${runId}`);
    }
    return runReportSchema.parse(report);
  }
  return read(runReportSchema, await getJson(`/runs/${encodeURIComponent(runId)}/report`, true), "report");
}

export async function getDiffCsv(runId: string): Promise<string> {
  if (usingFixtures()) {
    return fixtureDiffCsv;
  }
  const response = await request(`/runs/${encodeURIComponent(runId)}/diff.csv`, undefined, true);
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
  return read(receiptSchema, await getJson(`/receipts/${encodeURIComponent(receiptId)}`), "receipt");
}

async function getJson(path: string, ready = false): Promise<unknown> {
  const response = await request(path, undefined, ready);
  return response.json() as Promise<unknown>;
}

async function postJson(path: string, body: unknown): Promise<unknown> {
  const response = await request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return response.json() as Promise<unknown>;
}

async function request(path: string, init?: RequestInit, ready = false): Promise<Response> {
  const attempts = ready ? READY_ATTEMPTS : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(`/api${path}`, init);
    } catch {
      throw new Error(AGENTS_UNREACHABLE);
    }
    if (response.ok) return response;
    const text = await response.text();
    const notReady = response.status === 404 && text.includes("run not ready");
    if (notReady && attempt < attempts - 1) {
      await delay(READY_DELAY_MS);
      continue;
    }
    throw new Error(messageFromBody(text, response.status));
  }
  throw new Error("Run is not ready");
}

function messageFromBody(text: string, status: number): string {
  try {
    const body = JSON.parse(text) as { error?: unknown };
    if (body.error === "run not ready") return "Run is not ready";
    if (typeof body.error === "string" && body.error.length > 0) return body.error;
  } catch {
    /* response was not JSON */
  }
  if (text.trim().length > 0) return text;
  return `Request failed: ${status}`;
}

function read<T>(schema: z.ZodType<T>, data: unknown, label: string): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new Error(`Unexpected ${label} response from the agents service`);
  }
  return parsed.data;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
