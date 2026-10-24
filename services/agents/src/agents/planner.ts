import { z } from "zod";
import { templateIdSchema, type RunRequest, type TemplateId } from "contracts";
import type { Gateway } from "../gateway/types.js";
import type { LlmClient } from "../llm/nemotron.js";
import { listingId, type GnaWorldModel } from "../world/worldModel.js";

export const PLANNER_FAMILIES = ["contact", "status", "specialty"] as const;
export const CHUNK_SIZE = 10;

export const plannerOutputSchema = z.object({
  rankings: z.array(
    z.object({
      chunkIndex: z.number().int(),
      risk: z.number(),
      templates: z.array(templateIdSchema),
    }),
  ),
  rationale: z.string(),
});

export type PlannerOutput = z.infer<typeof plannerOutputSchema>;

export type PlanResult = {
  runId: string;
  receiptId: string;
  rows: number;
  mode: "live" | "replayed";
  tasks: number;
  model: string;
  latencyMs: number;
  replayed: boolean;
  rankings: PlannerOutput;
};

export function chunkRows<T>(rows: T[], size = CHUNK_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size));
  }
  return chunks;
}

export async function plan(input: {
  request: RunRequest;
  runId: string;
  gateway: Gateway;
  world: GnaWorldModel;
  llm: LlmClient;
}): Promise<PlanResult> {
  const { request, runId, gateway, world, llm } = input;
  const useMemory = request.useMemory ?? true;
  await world.append({
    runId,
    ts: new Date().toISOString(),
    actor: "planner",
    type: "run_started",
    entityId: `run:${runId}`,
    payload: { scope: request.scope, useMemory },
  });

  const query = await gateway.query(
    "directory_batch",
    {
      county: request.scope.county,
      specialty: request.scope.specialty,
      batch: request.scope.batch,
      limit: 10,
      offset: 0,
    },
    runId,
  );

  const chunks = chunkRows(query.rows);
  let tasks = 0;
  for (const [chunkIndex, chunk] of chunks.entries()) {
    for (const family of PLANNER_FAMILIES) {
      tasks += 1;
      const first = chunk[0] as { listing_id?: string } | undefined;
      await world.append({
        runId,
        ts: new Date().toISOString(),
        actor: "planner",
        type: "task_created",
        entityId: `chunk:${chunkIndex}:${family}`,
        payload: {
          family,
          chunkIndex,
          listingIds: chunk.map((row) => listingId(String((row as { listing_id?: string }).listing_id ?? ""))),
          firstListing: first?.listing_id,
        },
      });
    }
  }

  const catalog = await gateway.catalog();
  const llmResult = await llm.chatJson(
    "planner",
    plannerMessages(
      runId,
      query.receipt.receiptId,
      chunks,
      catalog.templates.map((template) => template.templateId),
    ),
    plannerOutputSchema,
  );

  await world.append({
    runId,
    ts: new Date().toISOString(),
    actor: "planner",
    type: "task_created",
    entityId: `run:${runId}`,
    payload: {
      model: llmResult.model,
      latencyMs: llmResult.latencyMs,
      replayed: llmResult.replayed,
      rationale: llmResult.data.rationale,
    },
  });

  return {
    runId,
    receiptId: query.receipt.receiptId,
    rows: query.rows.length,
    mode: query.receipt.mode,
    tasks,
    model: llmResult.model,
    latencyMs: llmResult.latencyMs,
    replayed: llmResult.replayed,
    rankings: llmResult.data,
  };
}

function plannerMessages(runId: string, receiptId: string, chunks: unknown[][], templateIds: TemplateId[]) {
  return [
    {
      role: "system" as const,
      content: "Risk-rank directory chunks and pick gateway templates. Return JSON {rankings:[{chunkIndex,risk,templates}], rationale}.",
    },
    {
      role: "user" as const,
      content: JSON.stringify({
        runId,
        receiptId,
        chunkCount: chunks.length,
        chunkSizes: chunks.map((chunk) => chunk.length),
        templates: templateIds,
      }),
    },
  ];
}
