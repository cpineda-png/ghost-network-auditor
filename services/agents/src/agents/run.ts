import type { Claim, EvidenceCard, Field, RunReport, RunRequest } from "contracts";
import { THRESHOLDS } from "contracts";
import type { Gateway } from "../gateway/types.js";
import type { LlmClient } from "../llm/nemotron.js";
import type { MeterlessHMem } from "../memory/hmem.js";
import { listingId, type GnaWorldModel } from "../world/worldModel.js";
import { arbitrate } from "./arbiter.js";
import { criticize } from "./critic.js";
import { investigateContact } from "./investigator.js";
import { plan } from "./planner.js";
import { decideRisk } from "./risk.js";

export const DIFF_HEADER =
  "run_id,listing_id,field,old_value,new_value,winning_source,status,confidence,receipt_ids,memory_ids";

export type RunOutcome = {
  cards: EvidenceCard[];
  report: RunReport;
  diff: string;
};

export class RunBook {
  private readonly outcomes = new Map<string, RunOutcome>();
  private readonly pending = new Map<string, Promise<RunOutcome>>();

  track(runId: string, task: Promise<RunOutcome>): void {
    const settled = task.then((outcome) => {
      this.outcomes.set(runId, outcome);
      return outcome;
    });
    this.pending.set(runId, settled);
  }

  get(runId: string): RunOutcome | undefined {
    return this.outcomes.get(runId);
  }

  whenDone(runId: string): Promise<RunOutcome> {
    const pending = this.pending.get(runId);
    if (!pending) return Promise.reject(new Error(`run ${runId} was not started`));
    return pending;
  }
}

export async function executeRun(input: {
  request: RunRequest;
  runId: string;
  gateway: Gateway;
  world: GnaWorldModel;
  hmem: MeterlessHMem;
  llm: LlmClient;
}): Promise<RunOutcome> {
  const useMemory = input.request.useMemory ?? true;
  const modelCounts = new Map<string, number>();
  const llm = countModels(input.llm, modelCounts);
  const planned = await plan({ ...input, llm });
  const investigation = await investigateContact({
    runId: input.runId,
    rows: planned.directoryRows,
    directoryReceiptId: planned.receiptId,
    gateway: input.gateway,
    world: input.world,
    llm,
  });

  let retried = 0;
  let memoryHits = 0;
  const cards: EvidenceCard[] = [];
  const groups = groupByField(investigation.claims);
  for (const claims of groups.values()) {
    const field = claims[0]?.field;
    const listing = claims[0]?.listingId;
    if (!field || !listing) continue;
    if (field !== "address" && field !== "phone") continue;
    const conflict = investigation.conflicts.some((item) => item.listingId === listing && item.field === field);
    if (!conflict) {
      cards.push(unchangedCard(input.runId, claims));
      continue;
    }
    const resolved = await resolveConflict({
      ...input,
      llm,
      claims,
      useMemory,
      onRetry: () => {
        retried += 1;
      },
      onMemory: (count) => {
        memoryHits += count;
      },
    });
    cards.push(resolved);
  }

  await input.world.append({
    runId: input.runId,
    ts: new Date().toISOString(),
    actor: "planner",
    type: "run_finished",
    entityId: `run:${input.runId}`,
    payload: { cards: cards.length },
  });

  const report: RunReport = {
    runId: input.runId,
    useMemory,
    listings: new Set(cards.map((card) => card.listingId)).size,
    applied: cards.filter((card) => card.status === "applied").length,
    escalated: cards.filter((card) => card.status === "escalated").length,
    retried,
    ghosts: cards.filter((card) => card.status === "escalated" && (card.field === "status" || card.field === "accepting")).length,
    memoryHits,
    models: [...modelCounts.entries()].map(([model, calls]) => ({ model, calls })),
  };
  const diff = renderDiff(input.runId, cards, planned.directoryRows);
  return { cards, report, diff };
}

async function resolveConflict(input: {
  runId: string;
  claims: Claim[];
  useMemory: boolean;
  gateway: Gateway;
  world: GnaWorldModel;
  hmem: MeterlessHMem;
  llm: LlmClient;
  onRetry: () => void;
  onMemory: (count: number) => void;
}): Promise<EvidenceCard> {
  let retriesUsed = 0;
  let revisions = 0;
  let lastCritique: EvidenceCard["critique"] = null;
  while (true) {
    const arbiter = await arbitrate({
      runId: input.runId,
      claims: input.claims,
      retriesUsed,
      useMemory: input.useMemory,
      hmem: input.hmem,
      world: input.world,
      llm: input.llm,
    });
    input.onMemory(arbiter.hits);
    if (arbiter.route === "retry") {
      retriesUsed += 1;
      input.onRetry();
      await input.world.append({
        runId: input.runId,
        ts: new Date().toISOString(),
        actor: "arbiter",
        type: "retry_requested",
        entityId: listingId(input.claims[0]!.listingId),
        field: input.claims[0]!.field,
        payload: { retriesUsed, confidence: arbiter.proposal?.confidence ?? null },
      });
      continue;
    }
    if (arbiter.route === "escalate" || !arbiter.proposal) {
      await emitEscalated(input, arbiter.proposal?.rationale ?? "rules-only escalation");
      return escalatedCard(input.runId, input.claims, arbiter.proposal, lastCritique);
    }
    const critique = await criticize({
      runId: input.runId,
      proposal: arbiter.proposal,
      round: revisions,
      gateway: input.gateway,
      world: input.world,
      llm: input.llm,
    });
    lastCritique = { verdict: critique.critique.verdict, reasons: critique.critique.reasons };
    if (critique.critique.verdict === "revise" && revisions < THRESHOLDS.maxRevisions) {
      revisions += 1;
      continue;
    }
    const status = decideRisk({
      field: arbiter.proposal.field,
      conflict: true,
      verdict: critique.critique.verdict === "revise" ? "reject" : critique.critique.verdict,
      confidence: arbiter.proposal.confidence,
    });
    if (status === "applied") {
      await input.world.append({
        runId: input.runId,
        ts: new Date().toISOString(),
        actor: "risk",
        type: "applied",
        entityId: listingId(arbiter.proposal.listingId),
        field: arbiter.proposal.field,
        payload: {
          value: arbiter.proposal.proposedValue,
          source: arbiter.proposal.winningSource,
          confidence: arbiter.proposal.confidence,
        },
      });
      return {
        runId: input.runId,
        listingId: arbiter.proposal.listingId,
        field: arbiter.proposal.field,
        sources: sourcesOf(input.claims),
        winner: { value: arbiter.proposal.proposedValue, source: arbiter.proposal.winningSource },
        confidence: arbiter.proposal.confidence,
        rationale: arbiter.proposal.rationale,
        critique: lastCritique,
        status: "applied",
        memoryIds: arbiter.proposal.memoryIds,
      };
    }
    await emitEscalated(input, critique.critique.reasons.join("; ") || "risk escalated");
    return escalatedCard(input.runId, input.claims, arbiter.proposal, lastCritique);
  }
}

function unchangedCard(runId: string, claims: Claim[]): EvidenceCard {
  return {
    runId,
    listingId: claims[0]!.listingId,
    field: claims[0]!.field,
    sources: sourcesOf(claims),
    winner: null,
    confidence: null,
    rationale: "Sources agree.",
    critique: null,
    status: "unchanged",
    memoryIds: [],
  };
}

function escalatedCard(
  runId: string,
  claims: Claim[],
  proposal: { proposedValue: Claim["value"]; winningSource: Claim["source"]; confidence: number; rationale: string; memoryIds: string[] } | null,
  critique: EvidenceCard["critique"],
): EvidenceCard {
  return {
    runId,
    listingId: claims[0]!.listingId,
    field: claims[0]!.field,
    sources: sourcesOf(claims),
    winner: null,
    confidence: proposal?.confidence ?? null,
    rationale: proposal?.rationale ?? "Escalated without a proposal.",
    critique,
    status: "escalated",
    memoryIds: proposal?.memoryIds ?? [],
  };
}

async function emitEscalated(
  input: { runId: string; claims: Claim[]; world: GnaWorldModel },
  reason: string,
): Promise<void> {
  await input.world.append({
    runId: input.runId,
    ts: new Date().toISOString(),
    actor: "risk",
    type: "escalated",
    entityId: listingId(input.claims[0]!.listingId),
    field: input.claims[0]!.field,
    payload: { reason },
  });
}

function sourcesOf(claims: Claim[]): EvidenceCard["sources"] {
  return claims.map((claim) => ({ source: claim.source, value: claim.value, receiptIds: claim.receiptIds }));
}

function groupByField(claims: Claim[]): Map<string, Claim[]> {
  const groups = new Map<string, Claim[]>();
  for (const claim of claims) {
    const key = `${claim.listingId}|${claim.field}`;
    const list = groups.get(key) ?? [];
    list.push(claim);
    groups.set(key, list);
  }
  return groups;
}

export function renderDiff(runId: string, cards: EvidenceCard[], rows: unknown[]): string {
  const directory = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    if (typeof record.listing_id === "string") directory.set(record.listing_id, record);
  }
  const lines = [DIFF_HEADER];
  for (const card of cards) {
    const row = directory.get(card.listingId);
    const oldValue = oldDirectoryValue(card.field, row);
    const appliedValue = card.status === "applied" && card.winner ? String(card.winner.value ?? "") : "";
    const newValue = diffFieldValue(card.field, appliedValue);
    const winning = card.status === "escalated" || !card.winner ? "" : card.winner.source;
    const confidence = card.status === "escalated" && card.critique === null && card.confidence === null
      ? ""
      : card.confidence === null
        ? ""
        : String(card.confidence);
    lines.push(
      [
        runId,
        card.listingId,
        card.field,
        oldValue,
        newValue,
        winning,
        card.status,
        card.status === "escalated" && card.rationale === "Escalated without a proposal." ? "" : confidence,
        card.sources.flatMap((source) => source.receiptIds).join(";"),
        card.memoryIds.join(";"),
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

function oldDirectoryValue(field: Field, row: Record<string, unknown> | undefined): string {
  if (!row) return "";
  if (field === "address") return row.address_line1 === undefined ? "" : String(row.address_line1);
  if (field === "phone") return row.phone === undefined ? "" : String(row.phone);
  return "";
}

function diffFieldValue(field: string, value: string): string {
  if (field !== "address") return value;
  return value.replace(/\s+\d{5}(?:-\d{4})?$/, "");
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

function countModels(inner: LlmClient, counts: Map<string, number>): LlmClient {
  return {
    async chatJson(role, messages, schema) {
      const result = await inner.chatJson(role, messages, schema);
      counts.set(result.model, (counts.get(result.model) ?? 0) + 1);
      return result;
    },
  };
}
