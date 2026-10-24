import type { Claim, Proposal } from "contracts";
import { THRESHOLDS, proposalSchema } from "contracts";
import type { LlmClient } from "../llm/nemotron.js";
import type { MeterlessHMem } from "../memory/hmem.js";
import { listingId } from "../world/worldModel.js";
import type { GnaWorldModel } from "../world/worldModel.js";

export type ArbiterRoute = "critic" | "retry" | "escalate";

export function routeConfidence(confidence: number, retriesUsed: number): ArbiterRoute {
  if (confidence >= THRESHOLDS.toCritic) return "critic";
  if (confidence >= THRESHOLDS.retryFloor && retriesUsed < THRESHOLDS.maxRetries) return "retry";
  return "escalate";
}

export type ArbiterResult = {
  route: ArbiterRoute;
  proposal: Proposal | null;
  memoryIds: string[];
  hits: number;
  model: string | null;
  latencyMs: number;
  replayed: boolean;
};

export async function arbitrate(input: {
  runId: string;
  claims: Claim[];
  retriesUsed: number;
  useMemory: boolean;
  hmem: MeterlessHMem;
  world: GnaWorldModel;
  llm: LlmClient;
}): Promise<ArbiterResult> {
  const sample = input.claims[0];
  if (!sample) {
    return { route: "escalate", proposal: null, memoryIds: [], hits: 0, model: null, latencyMs: 0, replayed: false };
  }
  const hits = input.useMemory
    ? await input.hmem.recall({
        listingId: sample.listingId,
        field: sample.field,
        specialty: input.claims.map((claim) => String(claim.value ?? "")).join(" "),
      })
    : [];
  const trust = input.useMemory ? await input.hmem.trust() : [];
  try {
    const result = await input.llm.chatJson(
      "planner",
      [
        {
          role: "system",
          content:
            "You are the arbiter. Choose one source value. Return JSON matching a Proposal: proposalId, listingId, field, proposedValue, winningSource, confidence, rationale, receiptIds, memoryIds. Cite memoryIds when a ruling drives the choice. Rationale under 60 words.",
        },
        {
          role: "user",
          content: JSON.stringify({ claims: input.claims, memories: hits, trust }),
        },
      ],
      proposalSchema,
    );
    const proposal = proposalSchema.parse(result.data);
    const route = routeConfidence(proposal.confidence, input.retriesUsed);
    if (route === "critic") {
      await input.world.append({
        runId: input.runId,
        ts: new Date().toISOString(),
        actor: "arbiter",
        type: "proposal_made",
        entityId: listingId(proposal.listingId),
        field: proposal.field,
        payload: {
          ...proposal,
          model: result.model,
          latencyMs: result.latencyMs,
          replayed: result.replayed,
          attempt: input.retriesUsed,
        },
      });
    }
    return {
      route,
      proposal,
      memoryIds: proposal.memoryIds,
      hits: hits.length,
      model: result.model,
      latencyMs: result.latencyMs,
      replayed: result.replayed,
    };
  } catch (error) {
    console.log(`arbiter rules-only: escalating ${error instanceof Error ? error.message : "model down"}`);
    return { route: "escalate", proposal: null, memoryIds: [], hits: hits.length, model: null, latencyMs: 0, replayed: false };
  }
}
