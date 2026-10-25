import { z } from "zod";
import type { Claim, Field } from "contracts";
import { claimSchema } from "contracts";
import type { Gateway } from "../gateway/types.js";
import type { LlmClient } from "../llm/nemotron.js";
import { addressValue, normalize } from "../normalize.js";
import type { GnaWorldModel } from "../world/worldModel.js";
import { listingId } from "../world/worldModel.js";

const summarySchema = z.object({ summary: z.string() });

export type ContactField = Extract<Field, "address" | "phone">;

export type Investigation = {
  claims: Claim[];
  conflicts: { listingId: string; field: ContactField }[];
  summary: string | null;
};

type DirectoryRow = {
  listing_id: string;
  npi: string;
  address_line1: string;
  zip: string;
  phone: string;
};

export function monthWindow(now = new Date()): { fromMonth: string; toMonth: string } {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const start = new Date(end);
  start.setUTCMonth(start.getUTCMonth() - 13);
  const format = (date: Date) =>
    `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  return { fromMonth: format(start), toMonth: format(end) };
}

export async function investigateContact(input: {
  runId: string;
  rows: unknown[];
  directoryReceiptId: string;
  gateway: Gateway;
  world: GnaWorldModel;
  llm: LlmClient;
  now?: Date;
}): Promise<Investigation> {
  const listings = input.rows.flatMap(readDirectoryRow);
  const npis = [...new Set(listings.map((row) => row.npi))];
  const catalog = await input.gateway.catalog();
  const templateIds = new Set(catalog.templates.map((template) => template.templateId));
  const { fromMonth, toMonth } = monthWindow(input.now);

  const roster = templateIds.has("roster_by_npis")
    ? await input.gateway.query("roster_by_npis", { npis }, input.runId)
    : null;
  const claims = templateIds.has("claims_by_npis")
    ? await input.gateway.query("claims_by_npis", { npis, fromMonth, toMonth }, input.runId)
    : null;
  if (templateIds.has("nppes_by_npis")) {
    await input.gateway.query("nppes_by_npis", { npis }, input.runId);
  }

  const rosterByNpi = indexLatest(roster?.rows ?? [], "npi");
  const claimsByNpi = indexLatest(claims?.rows ?? [], "npi");
  const built: Claim[] = [];

  for (const listing of listings) {
    const address = addressValue(listing.address_line1, listing.zip);
    built.push(
      claim(listing.listing_id, "address", "directory", address, [input.directoryReceiptId]),
    );
    if (listing.phone !== "") {
      built.push(claim(listing.listing_id, "phone", "directory", listing.phone, [input.directoryReceiptId]));
    }
    const rosterRow = rosterByNpi.get(listing.npi);
    if (rosterRow && roster) {
      const rosterAddress = addressValue(rosterRow.address_line1, rosterRow.zip);
      if (rosterAddress !== "") {
        built.push(claim(listing.listing_id, "address", "roster", rosterAddress, [roster.receipt.receiptId]));
      }
      const rosterPhone = text(rosterRow.phone);
      if (rosterPhone !== "") {
        built.push(claim(listing.listing_id, "phone", "roster", rosterPhone, [roster.receipt.receiptId]));
      }
    }
    const claimRow = claimsByNpi.get(listing.npi);
    if (claimRow && claims) {
      const serviceAddress = addressValue(claimRow.service_address_line1, claimRow.service_zip);
      if (serviceAddress !== "") {
        built.push(claim(listing.listing_id, "address", "claims", serviceAddress, [claims.receipt.receiptId]));
      }
    }
  }

  for (const item of built) {
    claimSchema.parse(item);
    await input.world.append({
      runId: input.runId,
      ts: new Date().toISOString(),
      actor: "investigator.contact",
      type: "claim_added",
      entityId: listingId(item.listingId),
      field: item.field,
      payload: { ...item },
    });
  }

  const conflicts: Investigation["conflicts"] = [];
  for (const [key, group] of groupClaims(built)) {
    const [bareId, field] = key.split("|") as [string, ContactField];
    const values = new Set(group.map((item) => normalize(field, item.value)));
    if (values.size < 2) continue;
    conflicts.push({ listingId: bareId, field });
    await input.world.append({
      runId: input.runId,
      ts: new Date().toISOString(),
      actor: "investigator.contact",
      type: "conflict_found",
      entityId: listingId(bareId),
      field,
      payload: { values: [...values] },
    });
  }

  let summary: string | null = null;
  try {
    const result = await input.llm.chatJson(
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
    summary = summarySchema.parse(result.data).summary;
  } catch (error) {
    console.log(`investigator summary escalated: ${error instanceof Error ? error.message : "invalid json"}`);
  }

  return { claims: built, conflicts, summary };
}

function claim(
  listingId: string,
  field: ContactField,
  source: Claim["source"],
  value: string,
  receiptIds: string[],
): Claim {
  return { listingId, field, source, value, receiptIds, confidence: 1 };
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
    },
  ];
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
