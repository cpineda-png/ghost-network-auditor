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
});
