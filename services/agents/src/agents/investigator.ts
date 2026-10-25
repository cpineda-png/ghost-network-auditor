import { z } from "zod";
import type { Claim, Field, QueryResponse } from "contracts";
import { claimSchema } from "contracts";
import type { Gateway } from "../gateway/types.js";
import type { LlmClient } from "../llm/nemotron.js";
import { addressValue, normalize } from "../normalize.js";
import type { GnaWorldModel } from "../world/worldModel.js";
import { listingId } from "../world/worldModel.js";
import { CHUNK_SIZE, chunkRows } from "./planner.js";

const summarySchema = z.object({ summary: z.string() });

type InvestigatorActor = "investigator.contact" | "investigator.status" | "investigator.specialty";

export type Investigation = {
  claims: Claim[];
  conflicts: { listingId: string; field: Field }[];
  summary: string | null;
};

export type ChunkSources = {
  roster: QueryResponse | null;
  claims: QueryResponse | null;
};

type DirectoryRow = {
  listing_id: string;
  npi: string;
  address_line1: string;
  zip: string;
  phone: string;
  specialty: string;
  network_status: string;
  accepting_new_patients: unknown;
};

type InvestigateInput = {
  runId: string;
  rows: unknown[];
  directoryReceiptId: string;
  gateway: Gateway;
  world: GnaWorldModel;
  now?: Date;
  sources?: ChunkSources;
};

export function monthWindow(now = new Date()): { fromMonth: string; toMonth: string } {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const start = new Date(end);
  start.setUTCMonth(start.getUTCMonth() - 13);
  const format = (date: Date) =>
    `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  return { fromMonth: format(start), toMonth: format(end) };
}

export function npisFromRows(rows: unknown[]): string[] {
  return [...new Set(rows.flatMap(readDirectoryRow).map((row) => row.npi))];
}

export async function loadChunkSources(input: {
  gateway: Gateway;
  npis: string[];
  runId: string;
  now?: Date;
}): Promise<ChunkSources> {
  const npis = [...new Set(input.npis.map((npi) => npi.trim()).filter((npi) => npi !== ""))];
  if (npis.length === 0) return { roster: null, claims: null };
  if (npis.length > CHUNK_SIZE) {
    throw new Error(`roster and claims queries accept at most ${CHUNK_SIZE} npis`);
  }
  const catalog = await input.gateway.catalog();
  const templateIds = new Set(catalog.templates.map((template) => template.templateId));
  const { fromMonth, toMonth } = monthWindow(input.now);
  const roster = templateIds.has("roster_by_npis")
    ? await input.gateway.query("roster_by_npis", { npis }, input.runId)
    : null;
  const claims = templateIds.has("claims_by_npis")
    ? await input.gateway.query("claims_by_npis", { npis, fromMonth, toMonth }, input.runId)
    : null;
  return { roster, claims };
}

export async function investigateContact(
  input: InvestigateInput & { llm: LlmClient },
): Promise<Investigation> {
  if (input.sources) return investigateContactChunk(input, input.sources);
  return investigateInChunks(input, investigateContactChunk);
}

export async function investigateStatus(input: InvestigateInput): Promise<Investigation> {
  if (input.sources) return investigateStatusChunk(input, input.sources);
  return investigateInChunks(input, investigateStatusChunk);
}

async function investigateInChunks(
  input: InvestigateInput & { llm?: LlmClient },
  investigate: (input: InvestigateInput & { llm?: LlmClient }, sources: ChunkSources) => Promise<Investigation>,
): Promise<Investigation> {
  const chunks = chunkRows(input.rows.flatMap(readDirectoryRow), CHUNK_SIZE);
  if (chunks.length === 0) return investigate(input, { roster: null, claims: null });
  const claims: Claim[] = [];
  const conflicts: Investigation["conflicts"] = [];
  let summary: string | null = null;
  for (const chunk of chunks) {
    const sources = await loadChunkSources({
      gateway: input.gateway,
      npis: chunk.map((row) => row.npi),
      runId: input.runId,
      now: input.now,
    });
    const part = await investigate({ ...input, rows: chunk }, sources);
    claims.push(...part.claims);
    conflicts.push(...part.conflicts);
    summary = part.summary;
  }
  return { claims, conflicts, summary };
}

async function investigateContactChunk(
  input: InvestigateInput & { llm?: LlmClient },
  sources: ChunkSources,
): Promise<Investigation> {
  const listings = input.rows.flatMap(readDirectoryRow);
  const npis = [...new Set(listings.map((row) => row.npi))];
  const catalog = await input.gateway.catalog();
  const templateIds = new Set(catalog.templates.map((template) => template.templateId));
  if (templateIds.has("nppes_by_npis") && npis.length > 0 && npis.length <= CHUNK_SIZE) {
    await input.gateway.query("nppes_by_npis", { npis }, input.runId);
  }

  const rosterByNpi = indexLatest(sources.roster?.rows ?? [], "npi");
  const claimsByNpi = indexLatest(sources.claims?.rows ?? [], "npi");
  const built: Claim[] = [];

  for (const listing of listings) {
    const address = addressValue(listing.address_line1, listing.zip);
    built.push(claim(listing.listing_id, "address", "directory", address, [input.directoryReceiptId]));
    if (listing.phone !== "") {
      built.push(claim(listing.listing_id, "phone", "directory", listing.phone, [input.directoryReceiptId]));
    }
    const rosterRow = rosterByNpi.get(listing.npi);
    if (rosterRow && sources.roster) {
      const rosterAddress = addressValue(rosterRow.address_line1, rosterRow.zip);
      if (rosterAddress !== "") {
        built.push(claim(listing.listing_id, "address", "roster", rosterAddress, [sources.roster.receipt.receiptId]));
      }
      const rosterPhone = text(rosterRow.phone);
      if (rosterPhone !== "") {
        built.push(claim(listing.listing_id, "phone", "roster", rosterPhone, [sources.roster.receipt.receiptId]));
      }
    }
    const claimRow = claimsByNpi.get(listing.npi);
    if (claimRow && sources.claims) {
      const serviceAddress = addressValue(claimRow.service_address_line1, claimRow.service_zip);
      if (serviceAddress !== "") {
        built.push(
          claim(listing.listing_id, "address", "claims", serviceAddress, [sources.claims.receipt.receiptId]),
        );
      }
    }
  }

  return settle(input, built, () => "investigator.contact", true);
}

async function investigateStatusChunk(input: InvestigateInput, sources: ChunkSources): Promise<Investigation> {
  const listings = input.rows.flatMap(readDirectoryRow);
  const rosterByNpi = rowsByKey(sources.roster?.rows ?? [], "npi");
  const claimsByNpi = rowsByKey(sources.claims?.rows ?? [], "npi");
  const built: Claim[] = [];

  for (const listing of listings) {
    const networkStatus = listing.network_status.trim();
    if (networkStatus !== "") {
      built.push(claim(listing.listing_id, "status", "directory", networkStatus, [input.directoryReceiptId]));
    }
    const rosterRow = pickRoster(rosterByNpi.get(listing.npi) ?? []);
    if (rosterRow && sources.roster) {
      const status = rosterStatusValue(rosterRow);
      if (status !== null) {
        built.push(claim(listing.listing_id, "status", "roster", status, [sources.roster.receipt.receiptId]));
      }
      const specialty = text(rosterRow.specialty).trim();
      if (specialty !== "") {
        built.push(claim(listing.listing_id, "specialty", "roster", specialty, [sources.roster.receipt.receiptId]));
      }
    }
    const claimRows = claimsByNpi.get(listing.npi) ?? [];
    if (sources.claims && claimRows.length === 0) {
      built.push(claim(listing.listing_id, "status", "claims", "terminated", [sources.claims.receipt.receiptId]));
    }
    const accepting = directoryAccepting(listing.accepting_new_patients);
    if (accepting !== null) {
      built.push(claim(listing.listing_id, "accepting", "directory", accepting, [input.directoryReceiptId]));
    }
    if (sources.claims && claimRows.length > 0) {
      const patients = sumNewPatients(claimRows);
      built.push(
        claim(listing.listing_id, "accepting", "claims", patients === 0 ? false : true, [sources.claims.receipt.receiptId]),
      );
    }
    const specialty = listing.specialty.trim();
    if (specialty !== "") {
      built.push(claim(listing.listing_id, "specialty", "directory", specialty, [input.directoryReceiptId]));
    }
  }

  return settle(
    input,
    built,
    (field) => (field === "specialty" ? "investigator.specialty" : "investigator.status"),
    false,
  );
}

async function settle(
  input: InvestigateInput & { llm?: LlmClient },
  built: Claim[],
  actorFor: (field: Field) => InvestigatorActor,
  summarize: boolean,
): Promise<Investigation> {
  for (const item of built) {
    claimSchema.parse(item);
    await input.world.append({
      runId: input.runId,
      ts: new Date().toISOString(),
      actor: actorFor(item.field),
      type: "claim_added",
      entityId: listingId(item.listingId),
      field: item.field,
      payload: { ...item },
    });
  }

  const conflicts: Investigation["conflicts"] = [];
  for (const [key, group] of groupClaims(built)) {
    const [bareId, field] = key.split("|") as [string, Field];
    const values = new Set(group.map((item) => comparable(field, item.value)));
    if (values.size < 2) continue;
    conflicts.push({ listingId: bareId, field });
    await input.world.append({
      runId: input.runId,
      ts: new Date().toISOString(),
      actor: actorFor(field),
      type: "conflict_found",
      entityId: listingId(bareId),
      field,
      payload: { values: [...values] },
    });
  }

  if (!summarize || !input.llm) return { claims: built, conflicts, summary: null };
  return { claims: built, conflicts, summary: await contactSummary(input.llm, built, conflicts) };
}

async function contactSummary(
  llm: LlmClient,
  built: Claim[],
  conflicts: Investigation["conflicts"],
): Promise<string | null> {
  try {
    const result = await llm.chatJson(
      "worker",
      [
        {
          role: "system",
          content: [
            "Summarize these contact conflicts in one sentence. Do not invent values. JSON only, no prose.",
            'Return {"summary":"One sentence."}.',
            "summary is a string.",
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify({ claims: built, conflicts }),
        },
      ],
      summarySchema,
    );
    return summarySchema.parse(result.data).summary;
  } catch (error) {
    console.log(`investigator summary escalated: ${error instanceof Error ? error.message : "invalid json"}`);
    return null;
  }
}

function claim(
  listingId: string,
  field: Field,
  source: Claim["source"],
  value: Claim["value"],
  receiptIds: string[],
): Claim {
  return { listingId, field, source, value, receiptIds, confidence: 1 };
}

function rosterStatusValue(row: Record<string, unknown>): string | null {
  if (normalize("status", row.status) === "pending") return null;
  if (text(row.term_date).trim() !== "") return "terminated";
  const status = text(row.status).trim();
  if (status === "") return null;
  return status;
}

function pickRoster(rows: Record<string, unknown>[]): Record<string, unknown> | undefined {
  const known = rows.filter((row) => normalize("status", row.status) !== "pending");
  const pool = known.length > 0 ? known : rows;
  return (
    pool.find((row) => text(row.term_date).trim() !== "" || canonicalStatus(row.status) === "terminated") ?? pool[0]
  );
}

function directoryAccepting(value: unknown): Claim["value"] | null {
  if (typeof value === "boolean") return value;
  if (value === null || value === undefined) return null;
  const token = String(value).trim();
  if (token === "") return null;
  return token;
}

function sumNewPatients(rows: Record<string, unknown>[]): number {
  return rows.reduce((sum, row) => {
    const parsed = Number(row.new_patient_count);
    return sum + (Number.isFinite(parsed) ? parsed : 0);
  }, 0);
}

function comparable(field: Field, value: Claim["value"]): string {
  if (field === "status") return canonicalStatus(value);
  return normalize(field, value);
}

function canonicalStatus(value: unknown): string {
  const normalized = normalize("status", value);
  if (normalized === "in" || normalized === "active") return "active";
  if (normalized === "out" || normalized === "terminated") return "terminated";
  return normalized;
}

function groupClaims(claims: Claim[]): Map<string, Claim[]> {
  const groups = new Map<string, Claim[]>();
  for (const item of claims) {
    const key = `${item.listingId}|${item.field}`;
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  return groups;
}

function readDirectoryRow(row: unknown): DirectoryRow[] {
  if (!row || typeof row !== "object") return [];
  const record = row as Record<string, unknown>;
  if (typeof record.listing_id !== "string" || typeof record.npi !== "string") return [];
  return [
    {
      listing_id: record.listing_id,
      npi: record.npi,
      address_line1: text(record.address_line1),
      zip: text(record.zip),
      phone: text(record.phone),
      specialty: text(record.specialty),
      network_status: text(record.network_status),
      accepting_new_patients: record.accepting_new_patients,
    },
  ];
}

function rowsByKey(rows: unknown[], key: string): Map<string, Record<string, unknown>[]> {
  const map = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const id = text(record[key]);
    if (id === "") continue;
    const list = map.get(id) ?? [];
    list.push(record);
    map.set(id, list);
  }
  return map;
}

function indexLatest(rows: unknown[], key: string): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const id = text(record[key]);
    if (id === "") continue;
    const current = map.get(id);
    if (!current || text(record.month) >= text(current.month)) map.set(id, record);
  }
  return map;
}

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}
