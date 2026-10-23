import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ZodType } from "zod";

export type ChatRole = "planner" | "worker" | "critic";
export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type ChatJsonResult<T> = {
  data: T;
  model: string;
  latencyMs: number;
  replayed: boolean;
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
};

export interface LlmClient {
  chatJson<T>(role: ChatRole, messages: ChatMessage[], schema: ZodType<T>): Promise<ChatJsonResult<T>>;
}

const RECORD_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../recordings/llm");
const MAX_CONCURRENT = 3;
let inflight = 0;
const waiters: Array<() => void> = [];

export function readNemotronConfig(): NemotronConfig {
  return {
    token: process.env.NIGHTSHIFT_TOKEN,
    plannerModel: process.env.NEMOTRON_PLANNER_MODEL ?? "",
    workerModel: process.env.NEMOTRON_WORKER_MODEL ?? "",
    baseURL: (process.env.NIGHTSHIFT_BASE_URL ?? "http://127.0.0.1:8088/v1").replace(/\/$/, ""),
    enableThinking: process.env.NIGHTSHIFT_THINKING === "true",
  };
}

export function createNemotronClient(config: NemotronConfig = readNemotronConfig()): LlmClient {
  return new NightshiftLlmClient(config);
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
      .replace(/receipt-[A-Za-z0-9:_-]+/g, "<receipt>");
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
    const primary = role === "worker" ? this.config.workerModel : this.config.plannerModel;
    const fallback = this.config.workerModel;
    try {
      return await this.callWithModel(role, messages, schema, primary);
    } catch (error) {
      if (error instanceof EscalationError || error instanceof ReplayMissError) throw error;
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
      const recorded = JSON.parse(readFileSync(file, "utf8")) as { response: unknown; model: string; latencyMs: number };
      const data = schema.parse(parseContent(recorded.response));
      return { data, model: recorded.model, latencyMs: recorded.latencyMs, replayed: true };
    }

    const started = Date.now();
    const content = await withLimit(() => this.complete(role, model, messages));
    let parsed: T;
    try {
      parsed = schema.parse(parseJson(content));
    } catch {
      const retryContent = await withLimit(() => this.complete(role, model, messages));
      try {
        parsed = schema.parse(parseJson(retryContent));
      } catch {
        throw new EscalationError("model response failed schema validation after retry");
      }
    }
    const latencyMs = Date.now() - started;
    if (process.env.LLM_RECORD === "true") {
      mkdirSync(recordDir, { recursive: true });
      writeFileSync(
        file,
        `${JSON.stringify({ request: { role, model, messages }, response: { content }, model, latencyMs }, null, 2)}\n`,
      );
    }
    return { data: parsed, model, latencyMs, replayed: false };
  }

  private async complete(role: ChatRole, model: string, messages: ChatMessage[]): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    const body: Record<string, unknown> = {
      model,
      messages,
      response_format: { type: "json_object" },
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
      const json = (await response.json()) as {
        model?: string;
        choices?: { message?: { content?: string } }[];
      };
      return json.choices?.[0]?.message?.content ?? "";
    } finally {
      clearTimeout(timer);
    }
  }
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
