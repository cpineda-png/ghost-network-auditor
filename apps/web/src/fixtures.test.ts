import { describe, expect, it } from "vitest";
import { fixtureReceipts, fixtureRuns, fixtureTrust } from "./fixtures";
import {
  evidenceCardSchema,
  receiptSchema,
  runReportSchema,
  trustRowSchema,
  wmEventSchema,
} from "./types";

const templateIds = new Set([
  "directory_batch",
  "roster_by_npi",
  "claims_by_npi",
  "claims_locations_by_npi",
  "nppes_individual_by_npi",
  "nppes_org_by_npi",
]);

const eventTypes = [
  "run_started",
  "task_created",
  "claim_added",
  "conflict_found",
  "proposal_made",
  "critique",
  "retry_requested",
  "escalated",
  "ruling_recorded",
  "applied",
  "run_finished",
] as const;

const llmActors = new Set([
  "planner",
  "investigator.contact",
  "investigator.status",
  "investigator.specialty",
  "arbiter",
  "critic",
]);

describe("fixtures", () => {
  const coldEvents = wmEventSchema.array().parse(fixtureRuns["run-cold"].events);
  const warmEvents = wmEventSchema.array().parse(fixtureRuns["run-warm"].events);
  const coldCards = evidenceCardSchema.array().parse(fixtureRuns["run-cold"].cards);
  const warmCards = evidenceCardSchema.array().parse(fixtureRuns["run-warm"].cards);
  const coldReport = runReportSchema.parse(fixtureRuns["run-cold"].report);
  const warmReport = runReportSchema.parse(fixtureRuns["run-warm"].report);
  const receipts = receiptSchema.array().parse(fixtureReceipts);
  const trust = trustRowSchema.array().parse(fixtureTrust);

  it("parses cold and warm runs, receipts, and trust rows", () => {
    expect(coldEvents.length).toBeGreaterThanOrEqual(35);
    expect(coldEvents.length).toBeLessThanOrEqual(45);
    expect(warmEvents.length).toBeGreaterThan(0);
    expect(receipts.length).toBeGreaterThan(0);
    expect(receipts.every((receipt) => templateIds.has(receipt.templateId))).toBe(true);
    expect(new Set(receipts.map((receipt) => receipt.templateId))).toEqual(templateIds);
    expect(trust.length).toBeGreaterThan(0);
    expect(coldReport.listings).toBe(10);
    expect(warmReport.listings).toBe(10);
  });

  it("covers every world model event type in the cold run", () => {
    for (const type of eventTypes) {
      expect(coldEvents.some((event) => event.type === type)).toBe(true);
    }
    expect(coldEvents.filter((event) => event.type === "retry_requested")).toHaveLength(1);
    expect(coldEvents.filter((event) => event.type === "escalated")).toHaveLength(3);
  });

  it("records a critic revise followed by a pass on the same listing", () => {
    const revise = coldEvents.find((event) => event.type === "critique" && event.payload.verdict === "revise");
    expect(revise).toBeTruthy();
    const laterPass = coldEvents.find(
      (event) =>
        event.type === "critique" &&
        event.payload.verdict === "pass" &&
        event.entityId === revise?.entityId &&
        event.ts > (revise?.ts ?? ""),
    );
    expect(laterPass).toBeTruthy();
  });

  it("puts model, latency, and replayed on every LLM-driven cold event", () => {
    for (const event of coldEvents) {
      if (!llmActors.has(event.actor)) continue;
      expect(event.payload).toEqual(
        expect.objectContaining({
          model: expect.any(String),
          latencyMs: expect.any(Number),
          replayed: expect.any(Boolean),
        }),
      );
    }
  });

  it("applies the Sunrise claims address over the stale directory address", () => {
    const card = coldCards.find((item) => item.listingId === "listing:plan:L-00001" && item.field === "address");
    expect(card?.status).toBe("applied");
    expect(card?.winner).toEqual({ value: "400 Harbor Ave, Springfield", source: "claims" });
    expect(card?.rationale).toMatch(/Sunrise Behavioral Group/);
    expect(card?.sources.find((source) => source.source === "directory")?.value).toBe(
      "100 Old Mill Rd, Springfield",
    );
  });

  it("escalates the ghost listing", () => {
    const card = coldCards.find((item) => item.listingId === "listing:plan:L-00002");
    expect(card?.status).toBe("escalated");
    expect(card?.rationale).toMatch(/no claims in 14 months/);
    expect(card?.rationale).toMatch(/terminated/);
    expect(coldReport.ghosts).toBe(1);
  });

  it("applies the warm Sunrise conflict by citing memory and escalates less", () => {
    const card = warmCards.find((item) => item.listingId === "listing:plan:L-00001" && item.field === "address");
    expect(card?.status).toBe("applied");
    expect(card?.memoryIds).toContain("mem-sunrise-address");
    expect(warmReport.useMemory).toBe(true);
    expect(warmReport.memoryHits).toBeGreaterThanOrEqual(1);
    expect(warmReport.escalated).toBeLessThan(coldReport.escalated);
  });
});
