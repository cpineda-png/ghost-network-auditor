import { afterEach, describe, expect, it, vi } from "vitest";
import { catalogResponseSchema, queryResponseSchema } from "contracts";
import { GatewayError, HttpGateway } from "./client.js";
import { MockGateway } from "./mock.js";
import { makeQueryResponse } from "./receipt.js";

const valid = makeQueryResponse(
  "directory_batch",
  { batch: "A", county: "Sangamon", specialty: "family medicine", limit: 10 },
  "run-1",
  ["listing_id"],
  [{ listing_id: "L-00001" }],
);

describe("HttpGateway", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("validates a query response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(valid), { status: 200, headers: { "content-type": "application/json" } }),
    );
    const client = new HttpGateway({ fetchImpl, baseUrl: "http://gateway" });
    await expect(client.query("directory_batch", valid.receipt.params, "run-1")).resolves.toEqual(valid);
  });

  it("rejects a body that fails the contract schema", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ nope: true }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    const client = new HttpGateway({ fetchImpl, baseUrl: "http://gateway" });
    await expect(client.query("directory_batch", {}, "run-1")).rejects.toThrow();
  });

  it("retries 500s at 1s, 2s, 4s then succeeds", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fetchImpl = vi.fn().mockImplementation(async () => {
      calls += 1;
      if (calls < 4) {
        return new Response("error", { status: 500 });
      }
      return new Response(JSON.stringify(valid), { status: 200, headers: { "content-type": "application/json" } });
    });
    const client = new HttpGateway({ fetchImpl, baseUrl: "http://gateway" });
    const pending = client.query("directory_batch", valid.receipt.params, "run-1");
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toEqual(valid);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("surfaces error and sqlState from a 502 without retrying", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: "table missing", templateId: "directory_batch", sqlState: "42S02" }),
        { status: 502, headers: { "content-type": "application/json" } },
      ),
    );
    const client = new HttpGateway({ fetchImpl, baseUrl: "http://gateway" });
    await expect(client.query("directory_batch", { batch: "A" }, "run-1")).rejects.toMatchObject({
      status: 502,
      failure: { error: "table missing", sqlState: "42S02" },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("surfaces the message from a 503 without retrying", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "Zetaris query failed and no sample is recorded" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new HttpGateway({ fetchImpl, baseUrl: "http://gateway" });
    const error = await client.query("directory_batch", { batch: "A" }, "run-1").then(
      () => {
        throw new Error("expected a 503");
      },
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(GatewayError);
    expect(error).toMatchObject({
      status: 503,
      failure: { error: "Zetaris query failed and no sample is recorded", sqlState: null },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("MockGateway", () => {
  it("returns a contract-valid directory_batch fixture", async () => {
    const gateway = new MockGateway();
    const result = await gateway.query("directory_batch", { batch: "A", county: "Sangamon", specialty: "family medicine", limit: 10 }, "run-x");
    expect(queryResponseSchema.parse(result).rows).toHaveLength(10);
    expect(result.receipt.templateId).toBe("directory_batch");
    const catalog = catalogResponseSchema.parse(await gateway.catalog());
    expect(catalog.templates.map((t) => t.templateId)).toContain("roster_by_npis");
  });
});
