import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  catalogResponseSchema,
  queryErrorSchema,
  queryResponseSchema,
  receiptSchema,
  replayResponseSchema,
  type CatalogResponse,
  type QueryResponse,
  type Receipt,
} from "contracts";
import { ZodError } from "zod";
import { MockGateway } from "./mock.js";
import type { Gateway } from "./types.js";

const TIMEOUT_MS = 20_000;
const RETRY_DELAYS_MS = [1000, 2000, 4000];

export type GatewayClientOptions = {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  requestedBy?: string;
  recordDir?: string;
};

export type GatewayFailure = {
  error: string;
  sqlState: string | null;
};

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly failure?: GatewayFailure,
  ) {
    super(message);
    this.name = "GatewayError";
  }
}

export function createGateway(options: GatewayClientOptions = {}): Gateway {
  if (process.env.GATEWAY_MOCK === "true") {
    return new MockGateway();
  }
  return new HttpGateway(options);
}

export class HttpGateway implements Gateway {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly requestedBy: string;
  private readonly recordDir: string;

  constructor(options: GatewayClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.GATEWAY_URL ?? "http://localhost:8081").replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.requestedBy = options.requestedBy ?? "planner";
    this.recordDir =
      options.recordDir ??
      join(dirname(fileURLToPath(import.meta.url)), "../../recordings/gateway");
  }

  async query(templateId: string, params: Record<string, unknown>, runId: string): Promise<QueryResponse> {
    const body = await this.requestJson(
      "POST",
      "/query",
      { templateId, params, runId, requestedBy: this.requestedBy },
      queryResponseSchema,
    );
    if (process.env.GATEWAY_RECORD === "true") {
      await mkdir(this.recordDir, { recursive: true });
      await writeFile(join(this.recordDir, `${templateId}.json`), `${JSON.stringify(body, null, 2)}\n`);
    }
    return body;
  }

  getReceipt(id: string): Promise<Receipt> {
    return this.requestJson("GET", `/receipts/${encodeURIComponent(id)}`, undefined, receiptSchema);
  }

  catalog(): Promise<CatalogResponse> {
    return this.requestJson("GET", "/catalog", undefined, catalogResponseSchema);
  }

  replay(receiptId: string) {
    return this.requestJson("POST", `/replay/${encodeURIComponent(receiptId)}`, {}, replayResponseSchema);
  }

  private async requestJson<T>(
    method: string,
    path: string,
    payload: unknown,
    schema: { parse: (value: unknown) => T },
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
          method,
          headers: payload === undefined ? {} : { "content-type": "application/json" },
          body: payload === undefined ? undefined : JSON.stringify(payload),
          signal: controller.signal,
        });
        if (response.status === 502 || response.status === 503) {
          const failure = await readQueryFailure(response);
          throw new GatewayError(
            failure?.error ?? `gateway ${method} ${path} failed with ${response.status}`,
            response.status,
            failure,
          );
        }
        if (response.status === 429 || response.status >= 500) {
          lastError = new GatewayError(`gateway ${method} ${path} failed with ${response.status}`, response.status);
          if (attempt === RETRY_DELAYS_MS.length) throw lastError;
          await sleep(RETRY_DELAYS_MS[attempt] ?? 4000);
          continue;
        }
        if (!response.ok) {
          throw new GatewayError(`gateway ${method} ${path} failed with ${response.status}`, response.status);
        }
        const json: unknown = await response.json();
        return schema.parse(json);
      } catch (error) {
        if (error instanceof GatewayError && error.status !== undefined && isTerminalStatus(error.status)) {
          throw error;
        }
        if (error instanceof ZodError) {
          throw error;
        }
        lastError = error;
        if (attempt === RETRY_DELAYS_MS.length) throw lastError;
        await sleep(RETRY_DELAYS_MS[attempt] ?? 4000);
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError;
  }
}

function isTerminalStatus(status: number): boolean {
  return status === 502 || status === 503 || (status !== 429 && status < 500);
}

async function readQueryFailure(response: Response): Promise<GatewayFailure | undefined> {
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return undefined;
  }
  const parsed = queryErrorSchema.safeParse(json);
  if (parsed.success) {
    return { error: parsed.data.error, sqlState: parsed.data.sqlState };
  }
  if (json && typeof json === "object" && "message" in json && typeof json.message === "string") {
    return { error: json.message, sqlState: null };
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
