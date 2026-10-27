import type { Field } from "contracts";
import { sameValue } from "../normalize.js";

export type RiskStatus = "applied" | "escalated" | "unchanged";

export function decideRisk(input: {
  field: Field;
  conflict: boolean;
  verdict: "pass" | "revise" | "reject" | null;
  confidence: number | null;
  proposedValue?: unknown;
  directoryValue?: unknown;
  memoryIds?: string[];
}): RiskStatus {
  if (input.field === "status" || input.field === "accepting") return "escalated";
  if (!input.conflict) return "unchanged";
  if (
    input.directoryValue !== undefined &&
    sameValue(input.field, input.proposedValue, input.directoryValue)
  ) {
    return "escalated";
  }
  const citedMemory = (input.memoryIds?.length ?? 0) > 0;
  const contactField = input.field === "address" || input.field === "phone" || input.field === "specialty";
  const strong = input.verdict === "pass" && contactField && (input.confidence ?? 0) >= 0.7;
  if (strong && citedMemory) return "applied";
  if (strong) return "applied";
  return "escalated";
}
