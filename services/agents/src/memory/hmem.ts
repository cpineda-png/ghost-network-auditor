import type { Ruling, Source, TrustRow } from "contracts";
import { FEEDBACK_DELTAS, HMEM, MemoryStoreService, type FeedbackKind } from "../../vendor/hmem/reference/src/index.ts";

export type MemoryHit = {
  memoryId: string;
  content: string;
  score: number;
  listingId?: string;
};

export type ListingContext = {
  listingId: string;
  field?: string;
  specialty?: string;
};

type StoredRuling = Ruling & { sourceRow?: never };

export class MeterlessHMem {
  readonly engine: HMEM;

  constructor(engine: HMEM = new HMEM({ actor: "gna" })) {
    this.engine = engine;
  }

  async recordRuling(ruling: Ruling): Promise<{ memoryId: string }> {
    const payload: StoredRuling = { ...ruling };
    const record = this.engine.store.add({
      content: JSON.stringify(payload),
      source: "user_correction",
      type: "factual",
      confidence: 0.9,
      layer: "long_term",
      tags: [ruling.listingId, ruling.field, `source:${ruling.source}`],
      goalRunId: ruling.runId,
      provenance: {
        origin: "user_correction",
        learnedAt: Date.now(),
        label: `ruling ${ruling.listingId} ${ruling.field}`,
      },
    });
    this.engine.conflicts.scan();
    return { memoryId: record.id };
  }

  async recall(listingContext: ListingContext): Promise<MemoryHit[]> {
    const query = [listingContext.listingId, listingContext.field, listingContext.specialty]
      .filter(Boolean)
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
