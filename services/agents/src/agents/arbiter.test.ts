import { describe, expect, it } from "vitest";
import { arbiterOutputSchema } from "./arbiter.js";

describe("arbiter output", () => {
  it("maps a high confidence label to 0.85", () => {
    const parsed = arbiterOutputSchema.parse({
      proposalId: "p1",
      listingId: "L-00001",
      field: "phone",
      proposedValue: "718-555-0100",
      winningSource: "roster",
      confidence: "high",
      rationale: "Roster matches the listing.",
      receiptIds: ["receipt-1"],
      memoryIds: [],
    });
    expect(parsed.confidence).toBe(0.85);
  });
});
