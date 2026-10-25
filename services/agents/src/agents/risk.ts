import type { Field } from "contracts";

export type RiskStatus = "applied" | "escalated" | "unchanged";

export function decideRisk(input: {
  field: Field;
  conflict: boolean;
  verdict: "pass" | "revise" | "reject" | null;
  confidence: number | null;
}): RiskStatus {
  if (input.field === "status" || input.field === "accepting") return "escalated";
  if (!input.conflict) return "unchanged";
  if (
    input.verdict === "pass" &&
    (input.field === "address" || input.field === "phone" || input.field === "specialty") &&
    (input.confidence ?? 0) >= 0.7
  ) {
    return "applied";
  }
  return "escalated";
}
