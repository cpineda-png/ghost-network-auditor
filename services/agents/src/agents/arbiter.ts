import { z } from "zod";
import type { Claim, Proposal } from "contracts";
import { THRESHOLDS, proposalSchema } from "contracts";
import type { LlmClient } from "../llm/nemotron.js";
import type { MeterlessHMem } from "../memory/hmem.js";
import { listingId } from "../world/worldModel.js";
import type { GnaWorldModel } from "../world/worldModel.js";
import { coerceUnitScore } from "./unitScore.js";

export const arbiterOutputSchema = z.preprocess((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = { ...(value as Record<string, unknown>) };
  record.confidence = coerceUnitScore(record.confidence);
  return record;
}, proposalSchema);

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
          content: [
            "You are the arbiter. Choose one source value. JSON only, no prose.",
            "Return a Proposal with these fields:",
            "proposalId: string.",
            "listingId: string.",
            "field: one of address, phone, status, specialty, accepting.",
            "proposedValue: string, boolean, or null.",
            "winningSource: one of directory, roster, claims, nppes.",
            "confidence: number from 0 to 1, not a word.",
            "rationale: string, at most 60 words.",
            "receiptIds: array of strings. Must have at least one id, and must come only from the claims given.",
            "memoryIds: array of strings. Cite memory ids when a ruling drives the choice.",
            'Example: {"proposalId":"p1","listingId":"L-00001","field":"phone","proposedValue":"718-555-0100","winningSource":"roster","confidence":0.85,"rationale":"Roster matches the listing.","receiptIds":["receipt-1"],"memoryIds":[]}.',
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify({ claims: input.claims, memories: hits, trust }),
        },
      ],
      arbiterOutputSchema,
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
          meterlessReceiptId: result.meterlessReceiptId,
          routedModel: result.routedModel,
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
