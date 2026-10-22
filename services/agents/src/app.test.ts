import { afterEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import { createServer } from "node:http";
import { claimSchema } from "contracts";
import { createApp } from "./app.js";

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
