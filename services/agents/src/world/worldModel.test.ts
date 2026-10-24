import { describe, expect, it } from "vitest";
import { GnaWorldModel, eventIdFor } from "./worldModel.js";

const base = {
  runId: "run-1",
  ts: "2026-01-15T00:00:00.000Z",
  actor: "planner" as const,
  type: "run_started" as const,
  entityId: "run:run-1",
  payload: { batch: "A" },
};

describe("GnaWorldModel", () => {
  it("appends duplicate events once", async () => {
    const world = new GnaWorldModel();
    const first = await world.append(base);
    const second = await world.append(base);
    expect(first.eventId).toBe(eventIdFor(base));
    expect(second.eventId).toBe(first.eventId);
    expect(await world.eventsForRun("run-1")).toHaveLength(1);
  });
});
