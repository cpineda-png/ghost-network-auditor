import { randomUUID } from "node:crypto";
import express from "express";
import type { GatewayHealth, RunRequest } from "contracts";
import { gatewayHealthSchema, rulingSchema, runRequestSchema } from "contracts";
import { executeRun, failedOutcome, RunBook } from "./agents/run.js";
import { createGateway } from "./gateway/client.js";
import type { Gateway } from "./gateway/types.js";
import { createNemotronClient, readNemotronConfig, type LlmClient } from "./llm/nemotron.js";
import { MeterlessHMem } from "./memory/hmem.js";
import { GnaWorldModel } from "./world/worldModel.js";

export type AppDeps = {
  fetchImpl?: typeof fetch;
  gatewayUrl?: string;
  gateway?: Gateway;
  hmem?: MeterlessHMem;
  world?: GnaWorldModel;
  llm?: LlmClient;
  runs?: RunBook;
};

export function createApp(deps: AppDeps = {}) {
  const app = express();
  app.use(express.json());

  const fetchImpl = deps.fetchImpl ?? fetch;
  const gatewayUrl = deps.gatewayUrl ?? process.env.GATEWAY_URL ?? "http://localhost:8081";
  const gateway = deps.gateway ?? createGateway({ fetchImpl, baseUrl: gatewayUrl });
  const hmem = deps.hmem ?? new MeterlessHMem();
  const world = deps.world ?? new GnaWorldModel();
  const llm = deps.llm ?? createNemotronClient();
  const runs = deps.runs ?? new RunBook();

  app.get("/health", async (_req, res) => {
    const [gatewayHealth, nightshift] = await Promise.all([
      readGatewayHealth(fetchImpl, gatewayUrl),
      readNightshift(fetchImpl, readNemotronConfig().baseURL),
    ]);
    res.json({
      ok: true,
      gateway: gatewayHealth,
      llmReplay: process.env.LLM_REPLAY === "true",
      nightshift,
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
    const task = executeRun({ request, runId, gateway, world, hmem, llm }).catch(async (error) => {
      const message = error instanceof Error ? error.message : "run failed";
      console.log(`run failed: ${message}`);
      try {
        await world.append({
          runId,
          ts: new Date().toISOString(),
          actor: "planner",
          type: "run_finished",
          entityId: `run:${runId}`,
          payload: { error: message },
        });
      } catch (appendError) {
        console.log(`run_finished failed: ${appendError instanceof Error ? appendError.message : "append failed"}`);
      }
      return failedOutcome(runId, request.useMemory, message);
    });
    runs.track(runId, task);
  });

  app.get("/runs/:id/cards", (req, res) => {
    const outcome = runs.get(req.params.id);
    if (!outcome) {
      res.status(404).json({ error: "run not ready" });
      return;
    }
    res.json(outcome.cards);
  });
  app.post("/rulings", async (req, res) => {
    const parsed = rulingSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid Ruling" });
      return;
    }
    const stored = await hmem.recordRuling(parsed.data);
    await world.append({
      runId: parsed.data.runId,
      ts: new Date().toISOString(),
      actor: "human",
      type: "ruling_recorded",
      entityId: parsed.data.listingId,
      field: parsed.data.field,
      payload: { memoryId: stored.memoryId },
    });
    res.json(stored);
  });
  app.get("/memory/trust", async (_req, res) => {
    res.json(await hmem.trust());
  });
  app.get("/runs/:id/report", (req, res) => {
    const outcome = runs.get(req.params.id);
    if (!outcome) {
      res.status(404).json({ error: "run not ready" });
      return;
    }
    res.json(outcome.report);
  });
  app.get("/runs/:id/diff.csv", (req, res) => {
    const outcome = runs.get(req.params.id);
    if (!outcome) {
      res.status(404).json({ error: "run not ready" });
      return;
    }
    res.type("text/csv").send(outcome.diff);
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

async function readNightshift(fetchImpl: typeof fetch, baseURL: string): Promise<"up" | "down"> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetchImpl(`${baseURL}/models`, { signal: controller.signal });
    return response.ok ? "up" : "down";
  } catch {
    return "down";
  } finally {
    clearTimeout(timer);
  }
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
