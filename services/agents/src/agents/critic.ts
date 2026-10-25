import { z } from "zod";
import type { Critique, Proposal } from "contracts";
import type { Gateway } from "../gateway/types.js";
import type { ChatJsonResult, LlmClient } from "../llm/nemotron.js";
import { listingId } from "../world/worldModel.js";
import type { GnaWorldModel } from "../world/worldModel.js";

const criticModelSchema = z.object({
  verdict: z.enum(["pass", "revise", "reject"]),
  reasons: z.array(z.string()),
  failedReceiptIds: z.array(z.string()).optional(),
});

let loggedThinking = false;

export function noteCriticThinking(): void {
  if (loggedThinking) return;
  loggedThinking = true;
  if (process.env.NIGHTSHIFT_THINKING !== "true") {
    console.log("critic thinking skipped");
  }
}

export type CriticResult = {
  critique: Critique;
  model: string | null;
  latencyMs: number;
  replayed: boolean;
};

export async function criticize(input: {
  runId: string;
  proposal: Proposal;
  round: number;
  gateway: Gateway;
  world: GnaWorldModel;
  llm: LlmClient;
}): Promise<CriticResult> {
  noteCriticThinking();
  const failed: string[] = [];
  const rows: unknown[] = [];
  for (const receiptId of input.proposal.receiptIds) {
    const replay = await input.gateway.replay(receiptId);
    rows.push(...replay.rows);
    if (!replay.match) failed.push(receiptId);
  }
  if (failed.length > 0) {
    return finish(input, {
      proposalId: input.proposal.proposalId,
      verdict: "reject",
      reasons: ["receipt replay mismatch"],
      failedReceiptIds: failed,
    }, null);
  }

  try {
    const result = await input.llm.chatJson(
      "critic",
      [
        {
          role: "system",
          content:
            "You are the critic. Decide whether the replayed rows support the proposed value. Return JSON {verdict: pass|revise|reject, reasons, failedReceiptIds}.",
        },
        {
          role: "user",
          content: JSON.stringify({ proposal: input.proposal, rows, round: input.round }),
        },
      ],
      criticModelSchema,
    );
    const parsed = criticModelSchema.parse(result.data);
    return finish(
      input,
      {
        proposalId: input.proposal.proposalId,
        verdict: parsed.verdict,
        reasons: parsed.reasons,
        failedReceiptIds: parsed.failedReceiptIds ?? [],
      },
      result,
    );
  } catch (error) {
    console.log(`critic rules-only: escalating ${error instanceof Error ? error.message : "model down"}`);
    return finish(input, {
      proposalId: input.proposal.proposalId,
      verdict: "reject",
      reasons: ["model unavailable"],
      failedReceiptIds: [],
    }, null);
  }
}

async function finish(
  input: { runId: string; proposal: Proposal; world: GnaWorldModel },
  critique: Critique,
  result: ChatJsonResult<unknown> | null,
): Promise<CriticResult> {
  await input.world.append({
    runId: input.runId,
    ts: new Date().toISOString(),
    actor: "critic",
    type: "critique",
    entityId: listingId(input.proposal.listingId),
    field: input.proposal.field,
    payload: {
      ...critique,
      model: result?.model ?? null,
      latencyMs: result?.latencyMs ?? 0,
      replayed: result?.replayed ?? false,
      meterlessReceiptId: result?.meterlessReceiptId ?? null,
      routedModel: result?.routedModel ?? null,
    },
  });
  return {
    critique,
    model: result?.model ?? null,
    latencyMs: result?.latencyMs ?? 0,
    replayed: result?.replayed ?? false,
  };
}
