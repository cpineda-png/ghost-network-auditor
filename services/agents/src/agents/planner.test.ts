import { describe, expect, it, vi } from "vitest";
import { MockGateway } from "../gateway/mock.js";
import type { LlmClient } from "../llm/nemotron.js";
import { GnaWorldModel } from "../world/worldModel.js";
import { CHUNK_SIZE, PLANNER_FAMILIES, chunkRows, plan, plannerOutputSchema } from "./planner.js";

describe("planner chunks", () => {
  it("splits rows into chunks of 10 and one task per family", async () => {
    const rows = Array.from({ length: 21 }, (_, i) => ({ listing_id: `L-${i}` }));
    const chunks = chunkRows(rows, CHUNK_SIZE);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(10);
    expect(chunks[2]).toHaveLength(1);

    const gateway = new MockGateway();
    await gateway.query("directory_batch", { batch: "A", county: "", specialty: "", limit: 21 }, "prep");
    const llm: LlmClient = {
      chatJson: vi.fn().mockResolvedValue({
        data: plannerOutputSchema.parse({
          rankings: [{ chunkIndex: 0, risk: 0.2, templates: ["roster_by_npi"] }],
          rationale: "low risk",
        }),
        model: "super",
        latencyMs: 1,
        replayed: true,
      }),
    };
    const world = new GnaWorldModel();
    const originalQuery = gateway.query.bind(gateway);
    vi.spyOn(gateway, "query").mockImplementation(async (templateId, params, runId) => {
      return originalQuery(templateId, { ...params, limit: 21 }, runId);
    });
    const result = await plan({
      request: { scope: { batch: "A" } },
      runId: "run-plan",
      gateway,
      world,
      llm,
    });
    const created = (await world.eventsForRun("run-plan")).filter((event) => event.type === "task_created");
    expect(result.rows).toBe(21);
    expect(created.filter((event) => String(event.payload.family ?? "").length > 0)).toHaveLength(
      3 * PLANNER_FAMILIES.length,
    );
  });
});
