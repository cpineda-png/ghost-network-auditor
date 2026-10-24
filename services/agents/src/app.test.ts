import { afterEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import { createServer } from "node:http";
import { claimSchema } from "contracts";
import { createApp } from "./app.js";
import { MockGateway } from "./gateway/mock.js";
import type { LlmClient } from "./llm/nemotron.js";
import { GnaWorldModel } from "./world/worldModel.js";

function listen(app: ReturnType<typeof createApp>): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer(app);
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise((done, fail) => {
            server.close((err) => (err ? fail(err) : done()));
          }),
      });
    });
    server.on("error", reject);
  });
}

describe("GET /health", () => {
  const previous = process.env.LLM_REPLAY;
  afterEach(() => {
    process.env.LLM_REPLAY = previous;
  });

  it("includes the gateway body when reachable", async () => {
    process.env.LLM_REPLAY = "true";
    const gateway = { zetaris: "not_configured", mode: "sample" };
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(gateway), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const app = createApp({ fetchImpl, gatewayUrl: "http://gateway" });
    const server = await listen(app);
    try {
      const response = await fetch(`${server.url}/health`);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        ok: true,
        gateway,
        llmReplay: true,
      });
    } finally {
      await server.close();
    }
  });

  it("reports unreachable when the gateway cannot be reached", async () => {
    process.env.LLM_REPLAY = "false";
    const fetchImpl = vi.fn().mockRejectedValue(new Error("connection refused"));
    const app = createApp({ fetchImpl, gatewayUrl: "http://gateway" });
    const server = await listen(app);
    try {
      const response = await fetch(`${server.url}/health`);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        ok: true,
        gateway: "unreachable",
        llmReplay: false,
      });
    } finally {
      await server.close();
    }
  });
});

describe("GET /runs/:id/events", () => {
  it("sends backlog before live events", async () => {
    const world = new GnaWorldModel();
    await world.append({
      runId: "run-sse",
      ts: "2026-01-15T00:00:00.000Z",
      actor: "planner",
      type: "run_started",
      entityId: "run:run-sse",
      payload: { order: 1 },
    });
    const llm: LlmClient = {
      chatJson: vi.fn(),
    };
    const app = createApp({ world, gateway: new MockGateway(), llm, fetchImpl: vi.fn() });
    const server = await listen(app);
    const abort = new AbortController();
    try {
      const response = await fetch(`${server.url}/runs/run-sse/events`, { signal: abort.signal });
      expect(response.status).toBe(200);
      const reader = response.body?.getReader();
      if (!reader) throw new Error("no body");
      const decoder = new TextDecoder();
      let buffer = "";
      const frames: string[] = [];
      const readFrame = async () => {
        while (!buffer.includes("\n\n")) {
          const chunk = await reader.read();
          buffer += decoder.decode(chunk.value ?? new Uint8Array(), { stream: true });
        }
        const split = buffer.indexOf("\n\n");
        const frame = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        frames.push(frame);
        return frame;
      };
      const first = await readFrame();
      expect(first).toContain("run_started");
      await world.append({
        runId: "run-sse",
        ts: "2026-01-15T00:00:01.000Z",
        actor: "planner",
        type: "task_created",
        entityId: "chunk:0:contact",
        payload: { order: 2, family: "contact" },
      });
      const second = await readFrame();
      expect(second).toContain("task_created");
      expect(frames[0]).toContain("run_started");
    } finally {
      abort.abort();
      await server.close();
    }
  });
});

describe("POST /runs", () => {
  it("returns runId and starts the planner", async () => {
    const llm: LlmClient = {
      chatJson: vi.fn().mockResolvedValue({
        data: { rankings: [{ chunkIndex: 0, risk: 0.1, templates: ["directory_batch"] }], rationale: "ok" },
        model: "super",
        latencyMs: 1,
        replayed: true,
      }),
    };
    const app = createApp({ gateway: new MockGateway(), llm, fetchImpl: vi.fn() });
    const server = await listen(app);
    try {
      const response = await fetch(`${server.url}/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: { batch: "A" } }),
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as { runId: string };
      expect(body.runId).toBeTruthy();
    } finally {
      await server.close();
    }
  });
});

describe("contracts", () => {
  it("rejects a claim with empty receiptIds", () => {
    const result = claimSchema.safeParse({
      listingId: "listing:plan:L-00042",
      field: "phone",
      source: "directory",
      value: "555-0100",
      receiptIds: [],
      confidence: 0.9,
    });
    expect(result.success).toBe(false);
  });
});
