const UNIT_SCORE_LABELS: Record<string, number> = {
  low: 0.25,
  medium: 0.5,
  high: 0.85,
};

export function coerceUnitScore(value: unknown): unknown {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  const label = UNIT_SCORE_LABELS[trimmed.toLowerCase()];
  if (label !== undefined) return label;
  if (trimmed === "") return value;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : value;
}
