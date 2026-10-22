import express from "express";
import type { GatewayHealth } from "contracts";
import { gatewayHealthSchema } from "contracts";

export type AppDeps = {
  fetchImpl?: typeof fetch;
  gatewayUrl?: string;
};

const TODO = { error: "TODO" };

export function createApp(deps: AppDeps = {}) {
  const app = express();
  app.use(express.json());

  const fetchImpl = deps.fetchImpl ?? fetch;
  const gatewayUrl = deps.gatewayUrl ?? process.env.GATEWAY_URL ?? "http://localhost:8081";

  app.get("/health", async (_req, res) => {
    res.json({
      ok: true,
      gateway: await readGatewayHealth(fetchImpl, gatewayUrl),
      llmReplay: process.env.LLM_REPLAY === "true",
    });
  });

  app.post("/runs", (_req, res) => {
    res.status(501).json(TODO);
  });
  app.get("/runs/:id/cards", (_req, res) => {
    res.status(501).json(TODO);
  });
  app.post("/rulings", (_req, res) => {
    res.status(501).json(TODO);
  });
  app.get("/memory/trust", (_req, res) => {
    res.status(501).json(TODO);
  });
  app.get("/runs/:id/report", (_req, res) => {
    res.status(501).json(TODO);
  });
  app.get("/runs/:id/diff.csv", (_req, res) => {
    res.status(501).json(TODO);
  });

  app.get("/runs/:id/events", (_req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.write("event: heartbeat\ndata: {}\n\n");
    res.end();
  });

  return app;
}

async function readGatewayHealth(
  fetchImpl: typeof fetch,
  gatewayUrl: string,
): Promise<GatewayHealth | "unreachable"> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetchImpl(`${gatewayUrl}/health`, { signal: controller.signal });
    if (!response.ok) {
      return "unreachable";
    }
    const body: unknown = await response.json();
    const parsed = gatewayHealthSchema.safeParse(body);
    return parsed.success ? parsed.data : "unreachable";
  } catch {
    return "unreachable";
  } finally {
    clearTimeout(timer);
  }
}
