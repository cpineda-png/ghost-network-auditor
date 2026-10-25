import { runRequestSchema } from "contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockGateway } from "../gateway/mock.js";
import type { LlmClient } from "../llm/nemotron.js";
import { GnaWorldModel } from "../world/worldModel.js";
import {
  CHUNK_SIZE,
  PLANNER_FAMILIES,
  chunkRows,
  directoryParams,
  plan,
  plannerOutputSchema,
  readRunLimit,
  readRunOffset,
  resolveRunWindow,
} from "./planner.js";

describe("planner output", () => {
  it("parses the live Ultra answer that sent risk as a label", () => {
    const parsed = plannerOutputSchema.parse({
      rankings: [
        {
          chunkIndex: 0,
          risk: "low",
          templates: ["directory_batch", "roster_by_npis", "claims_by_npis", "nppes_by_npis"],
        },
      ],
      rationale: "...",
    });
    expect(parsed.rankings[0]?.risk).toBe(0.25);
    expect(plannerOutputSchema.parse({
      rankings: [{ chunkIndex: 0, risk: "HIGH", templates: ["roster_by_npis"] }],
      rationale: "high",
    }).rankings[0]?.risk).toBe(0.85);
    expect(plannerOutputSchema.parse({
      rankings: [{ chunkIndex: 0, risk: "0.4", templates: ["roster_by_npis"] }],
      rationale: "numeric",
    }).rankings[0]?.risk).toBe(0.4);
  });
});

describe("planner chunks", () => {
  const previousLimit = process.env.RUN_LIMIT;
  const previousOffset = process.env.RUN_OFFSET;

  beforeEach(() => {
    delete process.env.RUN_LIMIT;
    delete process.env.RUN_OFFSET;
  });

  afterEach(() => {
    restoreEnv("RUN_LIMIT", previousLimit);
    restoreEnv("RUN_OFFSET", previousOffset);
  });

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
          rankings: [{ chunkIndex: 0, risk: 0.2, templates: ["roster_by_npis"] }],
          rationale: "low risk",
        }),
        model: "super",
        latencyMs: 1,
        replayed: true,
        meterlessReceiptId: "mtr-1",
        routedModel: "nvidia/nemotron-super",
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
    expect(result.firstListing).toEqual({ listing_id: "L-00001", phone: "718-555-0100" });
    expect(gateway.query).toHaveBeenCalledWith(
      "directory_batch",
      { batch: "A", limit: 10, offset: 0 },
      "run-plan",
    );
    expect(created.filter((event) => String(event.payload.family ?? "").length > 0)).toHaveLength(
      3 * PLANNER_FAMILIES.length,
    );
    const llmEvent = created.find((event) => event.payload.rationale === "low risk");
    expect(llmEvent?.payload).toMatchObject({
      model: "super",
      latencyMs: 1,
      replayed: true,
      meterlessReceiptId: "mtr-1",
      routedModel: "nvidia/nemotron-super",
    });
  });
});

describe("run size", () => {
  const previousLimit = process.env.RUN_LIMIT;
  const previousOffset = process.env.RUN_OFFSET;

  afterEach(() => {
    restoreEnv("RUN_LIMIT", previousLimit);
    restoreEnv("RUN_OFFSET", previousOffset);
  });

  it("defaults to 10", () => {
    delete process.env.RUN_LIMIT;
    delete process.env.RUN_OFFSET;
    expect(readRunLimit()).toBe(10);
    expect(readRunOffset()).toBe(0);
  });

  it("reads 50 from the environment", () => {
    process.env.RUN_LIMIT = "50";
    expect(readRunLimit()).toBe(50);
  });

  it("uses 10 when the environment is garbage", () => {
    process.env.RUN_LIMIT = "nope";
    expect(readRunLimit()).toBe(10);
  });

  it("clamps 999 to 300", () => {
    process.env.RUN_LIMIT = "999";
    expect(readRunLimit()).toBe(300);
  });
});

describe("run request window", () => {
  const previousLimit = process.env.RUN_LIMIT;
  const previousOffset = process.env.RUN_OFFSET;

  beforeEach(() => {
    delete process.env.RUN_LIMIT;
    delete process.env.RUN_OFFSET;
  });

  afterEach(() => {
    restoreEnv("RUN_LIMIT", previousLimit);
    restoreEnv("RUN_OFFSET", previousOffset);
  });

  it("accepts optional offset and limit on the contract", () => {
    expect(runRequestSchema.parse({
      scope: { batch: "B", offset: 160, limit: 30 },
      useMemory: false,
    })).toEqual({
      scope: { batch: "B", offset: 160, limit: 30 },
      useMemory: false,
    });
    expect(runRequestSchema.parse({ scope: { batch: "A" } })).toEqual({ scope: { batch: "A" } });
    expect(runRequestSchema.safeParse({ scope: { batch: "A", limit: 0 } }).success).toBe(false);
    expect(runRequestSchema.safeParse({ scope: { batch: "A", limit: 301 } }).success).toBe(false);
    expect(runRequestSchema.safeParse({ scope: { batch: "A", offset: -1 } }).success).toBe(false);
    expect(runRequestSchema.safeParse({ scope: { batch: "A", limit: 30.5 } }).success).toBe(false);
  });

  it("uses the scope window and falls back to the environment when it is absent", () => {
    process.env.RUN_LIMIT = "50";
    process.env.RUN_OFFSET = "7";
    expect(resolveRunWindow({})).toEqual({ limit: 50, offset: 7 });
    expect(directoryParams({ batch: "A" })).toEqual({ batch: "A", limit: 50, offset: 7 });
    expect(directoryParams({ batch: "B", county: "Sangamon", offset: 160, limit: 30 })).toEqual({
      batch: "B",
      county: "Sangamon",
      limit: 30,
      offset: 160,
    });
    expect(resolveRunWindow({ limit: 999, offset: -3 })).toEqual({ limit: 300, offset: 0 });
  });

  it("queries directory_batch with the scope window", async () => {
    process.env.RUN_LIMIT = "50";
    process.env.RUN_OFFSET = "7";
    const gateway = new MockGateway();
    const query = vi.spyOn(gateway, "query");
    const llm: LlmClient = {
      chatJson: vi.fn().mockResolvedValue({
        data: plannerOutputSchema.parse({
          rankings: [{ chunkIndex: 0, risk: 0.2, templates: ["roster_by_npis"] }],
          rationale: "window",
        }),
        model: "super",
        latencyMs: 1,
        replayed: true,
        meterlessReceiptId: "mtr-window",
        routedModel: "nvidia/nemotron-super",
      }),
    };
    await plan({
      request: { scope: { batch: "A", offset: 0, limit: 30 }, useMemory: false },
      runId: "run-window",
      gateway,
      world: new GnaWorldModel(),
      llm,
    });
    expect(query).toHaveBeenCalledWith(
      "directory_batch",
      { batch: "A", limit: 30, offset: 0 },
      "run-window",
    );
  });
});

function restoreEnv(name: "RUN_LIMIT" | "RUN_OFFSET", value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
