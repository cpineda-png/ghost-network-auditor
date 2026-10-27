import type { Ruling, Source, TrustRow } from "contracts";
import { FEEDBACK_DELTAS, HMEM, MemoryStoreService, type FeedbackKind } from "../../vendor/hmem/reference/src/index.ts";
import { sameValue } from "../normalize.js";

export type MemoryHit = {
  memoryId: string;
  content: string;
  score: number;
  listingId?: string;
};

export type ListingContext = {
  listingId: string;
  field?: string;
  groupName?: string;
  values?: string[];
  specialty?: string;
};

export type RulingContext = {
  npi?: string;
  groupName?: string;
  sources?: { source: Source; value: string | boolean | null }[];
};

type StoredRuling = Ruling & {
  npi?: string;
  group_name?: string;
  rejected?: string[];
};

const sources: readonly Source[] = ["directory", "roster", "claims", "nppes"];

export class MeterlessHMem {
  readonly engine: HMEM;

  constructor(engine: HMEM = new HMEM({ actor: "gna" })) {
    this.engine = engine;
  }

  async recordRuling(ruling: Ruling, context?: RulingContext): Promise<{ memoryId: string }> {
    const rejected = rejectedLabels(ruling, context);
    const payload: StoredRuling = {
      ...ruling,
      ...(context?.npi ? { npi: context.npi } : {}),
      ...(context?.groupName ? { group_name: context.groupName } : {}),
      ...(rejected.length > 0 ? { rejected } : {}),
    };
    const record = this.engine.store.add({
      content: JSON.stringify(payload),
      source: "user_correction",
      type: "factual",
      confidence: 0.9,
      layer: "long_term",
      tags: rulingTags(ruling, context, rejected),
      goalRunId: ruling.runId,
      provenance: {
        origin: "user_correction",
        learnedAt: Date.now(),
        label: `ruling ${ruling.listingId} ${ruling.field}`,
      },
    });
    this.engine.conflicts.scan();
    if (ruling.source !== "other") this.engine.feedback(record.id, "helpful");
    for (const label of rejected) {
      const source = sourceOfLabel(label);
      if (!source) continue;
      const companion = this.engine.store.add({
        content: JSON.stringify({
          runId: ruling.runId,
          listingId: ruling.listingId,
          field: ruling.field,
          value: null,
          source,
          analyst: ruling.analyst,
        } satisfies Ruling),
        source: "user_correction",
        type: "factual",
        confidence: 0.9,
        layer: "long_term",
        tags: ["trust-only", `source:${source}`],
        goalRunId: ruling.runId,
        provenance: {
          origin: "user_correction",
          learnedAt: Date.now(),
          label: `trust ${source} ${ruling.field}`,
        },
      });
      this.engine.feedback(companion.id, "wrong");
    }
    return { memoryId: record.id };
  }

  async recall(listingContext: ListingContext): Promise<MemoryHit[]> {
    const values = listingContext.values ?? (listingContext.specialty ? [listingContext.specialty] : []);
    const query = [listingContext.groupName, ...values, listingContext.field, listingContext.listingId]
      .filter((part): part is string => typeof part === "string" && part !== "")
      .join(" ");
    const result = this.engine.retrieval.query(query, { topN: 5, threshold: 0.35 });
    return result.memories.map((hit) => ({
      memoryId: hit.memory.id,
      content: hit.memory.content,
      score: hit.relevance,
      listingId: listingContext.listingId,
    }));
  }

  async trust(): Promise<TrustRow[]> {
    const counts = new Map<string, TrustRow>();
    for (const memory of this.engine.store.all()) {
      const parsed = parseRuling(memory.content);
      if (!parsed || parsed.source === "other") continue;
      const key = `${parsed.source}:${parsed.field}`;
      if (!counts.has(key)) {
        counts.set(key, {
          source: parsed.source,
          field: parsed.field,
          helpful: 0,
          notHelpful: 0,
          wrong: 0,
          score: 0,
        });
      }
      const row = counts.get(key)!;
      for (const entry of this.engine.ledger.history(memory.id)) {
        if (entry.action !== "feedback") continue;
        const kind = entry.details?.kind as FeedbackKind | undefined;
        if (kind === "helpful") row.helpful += 1;
        if (kind === "not_helpful") row.notHelpful += 1;
        if (kind === "wrong") row.wrong += 1;
      }
      row.score =
        row.helpful * FEEDBACK_DELTAS.helpful +
        row.notHelpful * FEEDBACK_DELTAS.not_helpful +
        row.wrong * FEEDBACK_DELTAS.wrong;
    }
    return [...counts.values()];
  }
}

function rulingTags(ruling: Ruling, context: RulingContext | undefined, rejected: string[]): string[] {
  return [
    ruling.listingId,
    ruling.field,
    `source:${ruling.source}`,
    ...(context?.npi ? [context.npi] : []),
    ...(context?.groupName ? [context.groupName] : []),
    ...rejected,
  ];
}

function rejectedLabels(ruling: Ruling, context?: RulingContext): string[] {
  if (!context?.sources) return [];
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const source of context.sources) {
    if (sameValue(ruling.field, source.value, ruling.value)) continue;
    const text = source.value === null || source.value === undefined ? "" : String(source.value);
    const label = `${source.source}:${text}`;
    if (seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  return labels;
}

function sourceOfLabel(label: string): Source | undefined {
  const source = label.slice(0, label.indexOf(":"));
  return sources.find((item) => item === source);
}

function parseRuling(content: string): Ruling | undefined {
  try {
    const value: unknown = JSON.parse(content);
    if (!value || typeof value !== "object") return undefined;
    const record = value as Partial<Ruling>;
    if (!record.listingId || !record.field || !record.source) return undefined;
    return record as Ruling;
  } catch {
    return undefined;
  }
}

export { MemoryStoreService };
