import type { EvidenceCard, Field } from "./types";

export function formatValue(value: string | boolean | null): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  return value;
}

export function typedRulingValue(field: Field, typed: string): string | boolean {
  if (field === "accepting") {
    const normalized = typed.toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return typed;
}

export function isPossibleGhost(card: EvidenceCard): boolean {
  return card.status === "escalated" && (card.field === "status" || card.field === "accepting");
}

export function needsHuman(card: EvidenceCard): { ghost: boolean; notAccepting: boolean } {
  const ghost =
    card.sources.some((source) => source.source === "roster" && source.value === "terminated") &&
    card.sources.some(
      (source) => source.source === "directory" && (source.value === true || source.value === "accepting"),
    );
  const notAccepting = card.field === "accepting" && card.sources.some((source) => source.value === false);
  return { ghost, notAccepting };
}
