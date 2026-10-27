import { describe, expect, it, vi } from "vitest";
import { MemoryStoreService } from "../../vendor/hmem/reference/src/index.ts";
import { MeterlessHMem } from "./hmem.js";

const ruling = {
  runId: "run-1",
  listingId: "listing:plan:L-00042",
  field: "phone" as const,
  value: "217-555-0100",
  source: "directory" as const,
  analyst: "avery",
};

describe("MeterlessHMem", () => {
  it("recordRuling goes through MemoryStoreService with user_correction/factual/0.9", async () => {
    const add = vi.spyOn(MemoryStoreService.prototype, "add");
    const hmem = new MeterlessHMem();
    const result = await hmem.recordRuling(ruling);
    expect(result.memoryId).toMatch(/^mem-/);
    expect(add).toHaveBeenCalled();
    const input = add.mock.calls[0]?.[0];
    expect(input).toMatchObject({
      source: "user_correction",
      type: "factual",
      confidence: 0.9,
    });
    expect(hmem.engine.store.get(result.memoryId)?.source).toBe("user_correction");
  });

  it("counts helpful feedback for a ruling with no rejected sources", async () => {
    const hmem = new MeterlessHMem();
    await hmem.recordRuling(ruling);
    const rows = await hmem.trust();
    expect(rows).toEqual([
      expect.objectContaining({ source: "directory", field: "phone", helpful: 1, wrong: 0 }),
    ]);
  });

  it("recalls a batch A ruling for another listing in the same group", async () => {
    const hmem = new MeterlessHMem();
    const stored = await hmem.recordRuling(
      {
        runId: "batch-a",
        listingId: "L-00001",
        field: "address",
        value: "100 Harbor Sample Ave",
        source: "claims",
        analyst: "avery",
      },
      {
        npi: "8000000009",
        groupName: "Sunrise Behavioral Group",
        sources: [
          { source: "directory", value: "900 Old Pier St" },
          { source: "roster", value: "900 Old Pier St" },
          { source: "claims", value: "100 Harbor Sample Ave" },
        ],
      },
    );
    const memory = hmem.engine.store.get(stored.memoryId);
    expect(memory?.content).toContain("Sunrise Behavioral Group");
    expect(memory?.content).toContain("8000000009");
    expect(memory?.content).toContain("roster:900 Old Pier St");
    expect(memory?.tags).toEqual(expect.arrayContaining([
      "L-00001",
      "address",
      "source:claims",
      "8000000009",
      "Sunrise Behavioral Group",
      "roster:900 Old Pier St",
      "directory:900 Old Pier St",
    ]));
    const hits = await hmem.recall({
      listingId: "L-00471",
      field: "address",
      groupName: "Sunrise Behavioral Group",
      values: ["900 Old Pier St", "100 Harbor Sample Ave"],
    });
    expect(hits.map((hit) => hit.memoryId)).toContain(stored.memoryId);
    const trust = await hmem.trust();
    expect(trust).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "claims", field: "address", helpful: 1 }),
      expect.objectContaining({ source: "roster", field: "address", wrong: 1 }),
      expect.objectContaining({ source: "directory", field: "address", wrong: 1 }),
    ]));
  });
});
