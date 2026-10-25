import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { Claim, Proposal } from "contracts";
import { proposalSchema } from "contracts";
import { MockGateway } from "../gateway/mock.js";
import type { ChatRole, LlmClient } from "../llm/nemotron.js";
import { MeterlessHMem } from "../memory/hmem.js";
import { addressValue, normalize } from "../normalize.js";
import { GnaWorldModel } from "../world/worldModel.js";
import { arbitrate, routeConfidence } from "./arbiter.js";
import { criticize } from "./critic.js";
import { investigateContact } from "./investigator.js";
import { decideRisk } from "./risk.js";
import { DIFF_HEADER, executeRun, fieldGroupsByListing, renderDiff } from "./run.js";

describe("normalize", () => {
  it("matches the eval address and phone rules", () => {
    expect(normalize("address", "123 Main St Suite 4")).toBe("123 main st suite 4");
    expect(normalize("address", "123 Main St Ste. 4")).toBe("123 main st suite 4");
    expect(normalize("address", "123 Main St #4")).toBe("123 main st suite 4");
    expect(normalize("phone", "(718) 555-0100")).toBe("7185550100");
    expect(normalize("address", "  ")).toBe("");
    expect(normalize("address", addressValue("100 Harbor Sample Ave", "11201"))).toBe("100 harbor sample ave 11201");
  });
});

describe("contact investigator", () => {
  it("emits a conflict when normalized addresses disagree and skips a missing NPPES template", async () => {
    const gateway = new MockGateway();
    const directory = await gateway.query("directory_batch", { batch: "A", limit: 1, offset: 0 }, "inv");
    const queries: string[] = [];
    const original = gateway.query.bind(gateway);
    vi.spyOn(gateway, "query").mockImplementation(async (templateId, params, runId) => {
      queries.push(templateId);
      return original(templateId, params, runId);
    });
    const world = new GnaWorldModel();
    const result = await investigateContact({
      runId: "inv",
      rows: directory.rows,
      directoryReceiptId: directory.receipt.receiptId,
      gateway,
      world,
      llm: summaryLlm(),
    });
    expect(queries).toEqual(["roster_by_npis", "claims_by_npis"]);
    expect(result.claims.some((claim) => claim.field === "phone" && claim.source === "claims")).toBe(false);
    const events = await world.eventsForRun("inv");
    expect(events.some((event) => event.type === "conflict_found" && event.field === "address")).toBe(true);
    const phones = result.claims.filter((claim) => claim.listingId === "L-00001" && claim.field === "phone");
    expect(new Set(phones.map((claim) => normalize("phone", claim.value))).size).toBe(1);
  });
});

describe("arbiter routing", () => {
  it("sends 0.72 to the critic, 0.6 to retry, and 0.4 to escalation", () => {
    expect(routeConfidence(0.72, 0)).toBe("critic");
    expect(routeConfidence(0.6, 0)).toBe("retry");
    expect(routeConfidence(0.4, 0)).toBe("escalate");
  });

  it("raises confidence when a Sunrise ruling is recalled", async () => {
    const hmem = new MeterlessHMem();
    const ruling = await hmem.recordRuling({
      runId: "prior",
      listingId: "L-00001",
      field: "address",
      value: "100 Harbor Sample Ave 11201",
      source: "roster",
      analyst: "avery",
      note: "Sunrise moved to 100 Harbor Sample Ave",
    });
    const claims = sampleClaims();
    const seen: string[] = [];
    const llm: LlmClient = {
      async chatJson(_role, messages) {
        const text = messages.map((message) => message.content).join("\n");
        seen.push(text);
        const recalled = text.includes(ruling.memoryId);
        return {
          data: proposal(recalled ? 0.92 : 0.55, recalled ? [ruling.memoryId] : []),
          model: "super",
          latencyMs: 1,
          replayed: true,
        };
      },
    };
    const withMemory = await arbitrate({
      runId: "mem",
      claims,
      retriesUsed: 0,
      useMemory: true,
      hmem,
      world: new GnaWorldModel(),
      llm,
    });
    const without = await arbitrate({
      runId: "nomem",
      claims,
      retriesUsed: 0,
      useMemory: false,
      hmem: new MeterlessHMem(),
      world: new GnaWorldModel(),
      llm,
    });
    expect(withMemory.hits).toBeGreaterThan(0);
    expect(withMemory.proposal?.confidence).toBe(0.92);
    expect(withMemory.memoryIds).toEqual([ruling.memoryId]);
    expect(without.proposal?.confidence).toBe(0.55);
  });
});

describe("critic and risk", () => {
  it("rejects a tampered receipt before calling the model", async () => {
    const gateway = new MockGateway();
    const query = await gateway.query("roster_by_npis", { npis: ["8000000009"] }, "crit");
    gateway.tamper(query.receipt.receiptId);
    const llm: LlmClient = { chatJson: vi.fn() };
    const result = await criticize({
      runId: "crit",
      proposal: proposalSchema.parse(proposal(0.8, [], query.receipt.receiptId)),
      round: 0,
      gateway,
      world: new GnaWorldModel(),
      llm,
    });
    expect(result.critique.verdict).toBe("reject");
    expect(result.critique.failedReceiptIds).toEqual([query.receipt.receiptId]);
    expect(llm.chatJson).not.toHaveBeenCalled();
  });

  it("revises once and then passes", async () => {
    const gateway = new MockGateway();
    const directory = await gateway.query("directory_batch", { batch: "A", limit: 1, offset: 0 }, "revise-run");
    let criticCalls = 0;
    const llm: LlmClient = {
      async chatJson(role, messages) {
        if (role === "critic") {
          criticCalls += 1;
          return {
            data: {
              verdict: criticCalls === 1 ? "revise" : "pass",
              reasons: criticCalls === 1 ? ["check the moved address"] : ["rows support the value"],
              failedReceiptIds: [],
            },
            model: "super",
            latencyMs: 1,
            replayed: true,
          };
        }
        if (messages[0]?.content.includes("Risk-rank")) {
          return {
            data: { rankings: [{ chunkIndex: 0, risk: 0.2, templates: ["roster_by_npis"] }], rationale: "contact" },
            model: "super",
            latencyMs: 1,
            replayed: true,
          };
        }
        if (role === "worker") {
          return { data: { summary: "Address sources disagree." }, model: "lightning", latencyMs: 1, replayed: true };
        }
        const body = JSON.parse(messages[1]?.content ?? "{}") as { claims: Claim[] };
        const roster = body.claims.find((claim) => claim.source === "roster") ?? body.claims[0]!;
        return {
          data: proposal(0.84, [], roster.receiptIds[0], roster),
          model: "super",
          latencyMs: 1,
          replayed: true,
        };
      },
    };
    const world = new GnaWorldModel();
    const outcome = await executeRun({
      request: { scope: { batch: "A" }, useMemory: false },
      runId: "revise-run",
      gateway,
      world,
      hmem: new MeterlessHMem(),
      llm,
    });
    const events = await world.eventsForRun("revise-run");
    expect(events.filter((event) => event.type === "critique" && event.payload.verdict === "revise")).toHaveLength(1);
    expect(criticCalls).toBeGreaterThan(1);
    const reviseCards = outcome.cards.filter((card) => card.critique?.verdict === "pass");
    expect(reviseCards.length).toBeGreaterThan(0);
    expect(outcome.cards.some((card) => card.status === "applied")).toBe(true);
  });

  it("never applies accepting or status", () => {
    expect(decideRisk({ field: "accepting", conflict: true, verdict: "pass", confidence: 0.99 })).toBe("escalated");
    expect(decideRisk({ field: "status", conflict: true, verdict: "pass", confidence: 0.99 })).toBe("escalated");
    expect(decideRisk({ field: "phone", conflict: true, verdict: "pass", confidence: 0.72 })).toBe("applied");
  });
});

describe("listing progress", () => {
  it("keeps status, accepting, and specialty on the listing", () => {
    const fields = ["address", "phone", "status", "accepting", "specialty"] as const;
    const claims: Claim[] = fields.map((field) => ({
      listingId: "L-1",
      field,
      source: "directory",
      value: "x",
      receiptIds: ["r"],
      confidence: 1,
    }));
    claims.push({
      listingId: "L-2",
      field: "address",
      source: "directory",
      value: "y",
      receiptIds: ["r"],
      confidence: 1,
    });
    const listings = fieldGroupsByListing(claims);
    expect(listings).toHaveLength(2);
    expect(listings[0]?.map((group) => group[0]?.field)).toEqual([
      "address",
      "phone",
      "status",
      "accepting",
      "specialty",
    ]);
    expect(listings[1]?.map((group) => group[0]?.field)).toEqual(["address"]);
  });
});

describe("diff", () => {
  it("starts with the eval header", () => {
    const csv = renderDiff("run", [], []);
    expect(csv.split("\n")[0]).toBe(DIFF_HEADER);
  });

  it("writes the street line without the zip used for conflict comparison", () => {
    const csv = renderDiff(
      "run",
      [
        {
          runId: "run",
          listingId: "L-00001",
          field: "address",
          sources: [],
          winner: { value: "100 Harbor Sample Ave 11201", source: "roster" },
          confidence: 0.86,
          rationale: "Roster and claims agree.",
          critique: { verdict: "pass", reasons: ["rows support the value"] },
          status: "applied",
          memoryIds: [],
        },
      ],
      [{ listing_id: "L-00001", address_line1: "900 Old Pier St", zip: "11201", phone: "718-555-0100" }],
    );
    const row = csv.trim().split("\n")[1];
    expect(row).toContain("900 Old Pier St,100 Harbor Sample Ave,roster,applied");
    expect(row).not.toContain("11201");
  });
});

describe("checkpoint", () => {
  it("runs 10 listings with one critic revise", async () => {
    const gateway = new MockGateway();
    const world = new GnaWorldModel();
    let criticCalls = 0;
    const llm: LlmClient = {
      async chatJson(role: ChatRole, messages) {
        if (role === "worker") {
          return { data: { summary: "Contact sources disagree." }, model: "lightning", latencyMs: 1, replayed: true };
        }
        if (role === "critic") {
          criticCalls += 1;
          const verdict = criticCalls === 1 ? "revise" : "pass";
          return {
            data: {
              verdict,
              reasons: verdict === "revise" ? ["confirm Sunrise"] : ["rows support the value"],
              failedReceiptIds: [],
            },
            model: "super",
            latencyMs: 1,
            replayed: true,
          };
        }
        if (messages[0]?.content.includes("Risk-rank")) {
          return {
            data: {
              rankings: [{ chunkIndex: 0, risk: 0.4, templates: ["roster_by_npis", "claims_by_npis"] }],
              rationale: "contact family",
            },
            model: "super",
            latencyMs: 1,
            replayed: true,
          };
        }
        const body = JSON.parse(messages[1]?.content ?? "{}") as { claims: Claim[]; memories: { memoryId: string }[] };
        const roster = body.claims.find((claim) => claim.source === "roster") ?? body.claims[0]!;
        return {
          data: proposal(0.86, body.memories?.map((hit) => hit.memoryId) ?? [], roster.receiptIds[0], roster),
          model: "super",
          latencyMs: 1,
          replayed: true,
        };
      },
    };
    const outcome = await executeRun({
      request: { scope: { batch: "A" }, useMemory: true },
      runId: "checkpoint",
      gateway,
      world,
      hmem: new MeterlessHMem(),
      llm,
    });
    const events = await world.eventsForRun("checkpoint");
    const counts = new Map<string, number>();
    for (const event of events) counts.set(event.type, (counts.get(event.type) ?? 0) + 1);
    mkdirSync(new URL("../../.data/", import.meta.url), { recursive: true });
    writeFileSync(new URL("../../.data/checkpoint-diff.csv", import.meta.url), outcome.diff);
    expect(outcome.report.listings).toBe(10);
    expect(counts.get("critique")).toBeGreaterThan(0);
    expect(events.filter((event) => event.type === "critique" && event.payload.verdict === "revise")).toHaveLength(1);
    expect(outcome.cards.length).toBeGreaterThan(0);
    console.log(`CHECKPOINT events=${JSON.stringify(Object.fromEntries(counts))} cards=${outcome.cards.length} escalated=${outcome.report.escalated}`);
  });
});

function summaryLlm(): LlmClient {
  return {
    async chatJson() {
      return { data: { summary: "Address sources disagree." }, model: "lightning", latencyMs: 1, replayed: true };
    },
  };
}

function sampleClaims(): Claim[] {
  return [
    {
      listingId: "L-00001",
      field: "address",
      source: "directory",
      value: "900 Old Pier St 11201",
      receiptIds: ["receipt-directory"],
      confidence: 1,
    },
    {
      listingId: "L-00001",
      field: "address",
      source: "roster",
      value: "100 Harbor Sample Ave 11201",
      receiptIds: ["receipt-roster"],
      confidence: 1,
    },
  ];
}

function proposal(confidence: number, memoryIds: string[], receiptId = "receipt-roster", claim?: Claim): Proposal {
  return {
    proposalId: `p-${claim?.listingId ?? "L-00001"}-${claim?.field ?? "address"}`,
    listingId: claim?.listingId ?? "L-00001",
    field: claim?.field ?? "address",
    proposedValue: claim?.value ?? "100 Harbor Sample Ave 11201",
    winningSource: claim?.source ?? "roster",
    confidence,
    rationale: "Roster and claims agree.",
    receiptIds: [receiptId],
    memoryIds,
  };
}
