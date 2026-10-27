import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ZodError, type ZodIssue, type ZodType } from "zod";

export type ChatRole = "planner" | "worker" | "critic";
export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type ChatJsonResult<T> = {
  data: T;
  model: string;
  latencyMs: number;
  replayed: boolean;
  meterlessReceiptId: string | null;
  routedModel: string | null;
};

export class EscalationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EscalationError";
  }
}

export class ReplayMissError extends Error {
  constructor(readonly key: string) {
    super(`LLM replay miss for key ${key}`);
    this.name = "ReplayMissError";
  }
}

export type NemotronConfig = {
  token: string | undefined;
  plannerModel: string;
  workerModel: string;
  baseURL: string;
  fetchImpl?: typeof fetch;
  recordDir?: string;
  enableThinking?: boolean;
  maxTokens?: number;
};

export interface LlmClient {
  chatJson<T>(role: ChatRole, messages: ChatMessage[], schema: ZodType<T>): Promise<ChatJsonResult<T>>;
}

const RECORD_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../recordings/llm");
const MAX_CONCURRENT = 3;
const MIN_MAX_TOKENS = 1500;

export function readMaxTokens(raw = process.env.NIGHTSHIFT_MAX_TOKENS): number {
  if (raw === undefined || raw.trim() === "") return MIN_MAX_TOKENS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return MIN_MAX_TOKENS;
  return Math.max(MIN_MAX_TOKENS, Math.floor(parsed));
}

export function answerContent(message: { content?: unknown } | undefined): string {
  return typeof message?.content === "string" ? message.content : "";
}

let inflight = 0;
const waiters: Array<() => void> = [];

export function readNemotronConfig(): NemotronConfig {
  return {
    token: process.env.NIGHTSHIFT_TOKEN,
    plannerModel: process.env.NEMOTRON_PLANNER_MODEL ?? "",
    workerModel: process.env.NEMOTRON_WORKER_MODEL ?? "",
    baseURL: (process.env.NIGHTSHIFT_BASE_URL ?? "http://127.0.0.1:8088/v1").replace(/\/$/, ""),
    enableThinking: process.env.NIGHTSHIFT_THINKING === "true",
    maxTokens: readMaxTokens(),
  };
}

export function createNemotronClient(config: NemotronConfig = readNemotronConfig()): LlmClient {
  return new NightshiftLlmClient(config);
}

const RECEIPT_ID = /rcpt_[0-9a-f]{16}/g;

export function alignReceiptIds(recorded: unknown, current: unknown): Map<string, string> {
  const oldIds = receiptIdsIn(recorded);
  const newIds = receiptIdsIn(current);
  const map = new Map<string, string>();
  if (oldIds.length !== newIds.length) return map;
  const conflicts = new Set<string>();
  for (let index = 0; index < oldIds.length; index++) {
    const from = oldIds[index];
    const to = newIds[index];
    if (from === undefined || to === undefined) continue;
    const prior = map.get(from);
    if (prior === undefined) map.set(from, to);
    else if (prior !== to) conflicts.add(from);
  }
  for (const id of conflicts) map.delete(id);
  return map;
}

export function applyReceiptIds(content: string, map: Map<string, string>): string {
  if (map.size === 0) return content;
  return content.replace(RECEIPT_ID, (id) => map.get(id) ?? id);
}

function receiptIdsIn(value: unknown): string[] {
  if (value === undefined) return [];
  return JSON.stringify(value).match(RECEIPT_ID) ?? [];
}

export function replayKey(role: ChatRole, model: string, messages: ChatMessage[]): string {
  return createHash("sha256")
    .update(role + model + JSON.stringify(stripPerRun(messages)))
    .digest("hex")
    .slice(0, 16);
}

export function stripPerRun(value: unknown): unknown {
  if (typeof value === "string") {
    return value
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
      .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, "<ts>")
      .replace(/"runId"\s*:\s*"[^"]*"/g, '"runId":""')
      .replace(/"receiptId"\s*:\s*"[^"]*"/g, '"receiptId":""')
      .replace(/receipt-[A-Za-z0-9:_-]+/g, "<receipt>")
      .replace(/rcpt_[0-9a-f]{16}/g, "<receipt>");
  }
  if (Array.isArray(value)) return value.map(stripPerRun);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (key === "runId" || key === "receiptId" || key === "receiptIds" || key === "executedAt" || key === "ts") {
        continue;
      }
      out[key] = stripPerRun(nested);
    }
    return out;
  }
  return value;
}

class NightshiftLlmClient implements LlmClient {
  constructor(private readonly config: NemotronConfig) {}

  async chatJson<T>(role: ChatRole, messages: ChatMessage[], schema: ZodType<T>): Promise<ChatJsonResult<T>> {
    // Ultra (planner model) serves planner, arbiter, and critic. Lightning is the worker and the fallback when Ultra fails.
    const primary = role === "worker" ? this.config.workerModel : this.config.plannerModel;
    const fallback = this.config.workerModel;
    try {
      return await this.callWithModel(role, messages, schema, primary);
    } catch (error) {
      if (error instanceof ReplayMissError) throw error;
      if (fallback && fallback !== primary) {
        return this.callWithModel(role, messages, schema, fallback);
      }
      throw error;
    }
  }

  private async callWithModel<T>(
    role: ChatRole,
    messages: ChatMessage[],
    schema: ZodType<T>,
    model: string,
  ): Promise<ChatJsonResult<T>> {
    const key = replayKey(role, model, messages);
    const recordDir = this.config.recordDir ?? RECORD_DIR;
    const file = join(recordDir, `${key}.json`);

    if (process.env.LLM_REPLAY === "true") {
      if (!existsSync(file)) throw new ReplayMissError(key);
      const recorded = JSON.parse(readFileSync(file, "utf8")) as LlmRecording;
      const data = schema.parse(parseContent(rewriteRecordedResponse(recorded, messages)));
      return {
        data,
        model: recorded.model,
        latencyMs: recorded.latencyMs,
        replayed: true,
        meterlessReceiptId: stringOrNull(recorded.meterlessReceiptId),
        routedModel: stringOrNull(recorded.routedModel),
      };
    }

    const started = Date.now();
    let completion = await withLimit(() => this.complete(role, model, messages));
    let parsed: T;
    try {
      parsed = schema.parse(parseJson(completion.content));
    } catch {
      completion = await withLimit(() => this.complete(role, model, messages));
      try {
        parsed = schema.parse(parseJson(completion.content));
      } catch (error) {
        throw new EscalationError(escalationMessage(error, completion.content));
      }
    }
    const latencyMs = Date.now() - started;
    const trace = {
      model,
      latencyMs,
      replayed: false,
      meterlessReceiptId: completion.meterlessReceiptId,
      routedModel: completion.routedModel,
    };
    if (process.env.LLM_RECORD === "true") {
      mkdirSync(recordDir, { recursive: true });
      writeFileSync(
        file,
        `${JSON.stringify({ request: { role, model, messages }, response: { content: completion.content }, ...trace }, null, 2)}\n`,
      );
    }
    return { data: parsed, ...trace };
  }

  private async complete(role: ChatRole, model: string, messages: ChatMessage[]): Promise<Completion> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    const body: Record<string, unknown> = {
      model,
      messages,
      response_format: { type: "json_object" },
      max_tokens: readMaxTokens(this.config.maxTokens === undefined ? undefined : String(this.config.maxTokens)),
    };
    if (role === "critic" && this.config.enableThinking) {
      body.chat_template_kwargs = { enable_thinking: true, reasoning_budget: 2048 };
    }
    const fetchImpl = this.config.fetchImpl ?? fetch;
    try {
      const response = await fetchImpl(`${this.config.baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: this.config.token ? `Bearer ${this.config.token}` : "",
          "meterless-app": "ghost-network-auditor",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Nightshift HTTP ${response.status}`);
      }
      const json = (await response.json()) as NightshiftChat;
      const message = json.choices?.[0]?.message;
      return {
        content: answerContent(message),
        ...meterlessTrace(json),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

type Completion = {
  content: string;
  meterlessReceiptId: string | null;
  routedModel: string | null;
};

type LlmRecording = {
  request?: { messages?: ChatMessage[] };
  response: unknown;
  model: string;
  latencyMs: number;
  replayed?: boolean;
  meterlessReceiptId?: unknown;
  routedModel?: unknown;
};

type NightshiftChat = {
  choices?: { message?: { content?: unknown } }[];
  meterless?: {
    receipt_id?: unknown;
    winning_route?: { model?: unknown };
  };
};

function meterlessTrace(json: NightshiftChat): { meterlessReceiptId: string | null; routedModel: string | null } {
  return {
    meterlessReceiptId: stringOrNull(json.meterless?.receipt_id),
    routedModel: stringOrNull(json.meterless?.winning_route?.model),
  };
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function rewriteRecordedResponse(recorded: LlmRecording, messages: ChatMessage[]): unknown {
  const response = recorded.response;
  if (!response || typeof response !== "object" || !("content" in response)) return response;
  const content = (response as { content: unknown }).content;
  if (typeof content !== "string") return response;
  const map = alignReceiptIds(recorded.request?.messages, messages);
  return { ...response, content: applyReceiptIds(content, map) };
}

function parseContent(response: unknown): unknown {
  if (response && typeof response === "object" && "content" in response) {
    return parseJson(String((response as { content: unknown }).content));
  }
  return response;
}

function parseJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    throw new Error("invalid json");
  }
}

function issueLine(issue: ZodIssue): string {
  const path = issue.path.map((part) => String(part)).join(".");
  if (issue.code === "invalid_type") return `${path}: expected ${issue.expected}`;
  return `${path}: ${issue.message}`;
}

function escalationMessage(error: unknown, content: string): string {
  const detail =
    error instanceof ZodError
      ? error.issues.map((issue) => issueLine(issue)).join("; ")
      : error instanceof Error
        ? error.message
        : "schema validation failed";
  return `model response failed schema validation after retry (${detail}) ${content.slice(0, 300)}`;
}

async function withLimit<T>(fn: () => Promise<T>): Promise<T> {
  if (inflight >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
  inflight += 1;
  try {
    return await fn();
  } finally {
    inflight -= 1;
    waiters.shift()?.();
  }
}
