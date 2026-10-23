import { randomUUID } from "node:crypto";
import express from "express";
import type { GatewayHealth, RunRequest } from "contracts";
import { gatewayHealthSchema, runRequestSchema } from "contracts";
import { plan } from "./agents/planner.js";
import { createGateway } from "./gateway/client.js";
import type { Gateway } from "./gateway/types.js";
import { createNemotronClient, type LlmClient } from "./llm/nemotron.js";
import { MeterlessHMem } from "./memory/hmem.js";
import { GnaWorldModel } from "./world/worldModel.js";

export type AppDeps = {
  fetchImpl?: typeof fetch;
  gatewayUrl?: string;
  gateway?: Gateway;
  hmem?: MeterlessHMem;
  world?: GnaWorldModel;
  llm?: LlmClient;
};

const TODO = { error: "TODO" };

export function createApp(deps: AppDeps = {}) {
  const app = express();
  app.use(express.json());

  const fetchImpl = deps.fetchImpl ?? fetch;
  const gatewayUrl = deps.gatewayUrl ?? process.env.GATEWAY_URL ?? "http://localhost:8081";
  const gateway = deps.gateway ?? createGateway({ fetchImpl, baseUrl: gatewayUrl });
  const hmem = deps.hmem ?? new MeterlessHMem();
  const world = deps.world ?? new GnaWorldModel();
  const llm = deps.llm ?? createNemotronClient();
  void hmem;

  app.get("/health", async (_req, res) => {
    res.json({
      ok: true,
      gateway: await readGatewayHealth(fetchImpl, gatewayUrl),
      llmReplay: process.env.LLM_REPLAY === "true",
    });
  });

  app.post("/runs", (req, res) => {
    const parsed = runRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid RunRequest" });
      return;
    }
    const runId = randomUUID();
    const request: RunRequest = { ...parsed.data, useMemory: parsed.data.useMemory ?? true };
    res.json({ runId });
    void plan({ request, runId, gateway, world, llm }).catch(async (error) => {
      await world.append({
        runId,
        ts: new Date().toISOString(),
        actor: "planner",
        type: "escalated",
        entityId: `run:${runId}`,
        payload: { error: error instanceof Error ? error.message : "planner failed" },
      });
    });
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

  app.get("/runs/:id/events", async (req, res) => {
    const runId = req.params.id;
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    const backlog = await world.eventsForRun(runId);
    for (const event of backlog) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
    const unsubscribe = world.subscribe(runId, (event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });
    req.on("close", () => {
      unsubscribe();
      res.end();
    });
  });

  app.get("/receipts/:id", async (req, res) => {
    try {
      const receipt = await gateway.getReceipt(req.params.id);
      res.json(receipt);
    } catch (error) {
      res.status(404).json({ error: error instanceof Error ? error.message : "not found" });
    }
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
