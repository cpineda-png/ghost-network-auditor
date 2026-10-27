import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  EscalationError,
  ReplayMissError,
  alignReceiptIds,
  applyReceiptIds,
  createNemotronClient,
  readMaxTokens,
  replayKey,
} from "./nemotron.js";

const schema = z.object({ ok: z.boolean() });

function client(
  fetchImpl: typeof fetch,
  recordDir: string,
  models: { plannerModel?: string; workerModel?: string; token?: string } = {},
) {
  return createNemotronClient({
    token: models.token ?? "test",
    plannerModel: models.plannerModel ?? "super",
    workerModel: models.workerModel ?? "lightning",
    baseURL: "http://nightshift/v1",
    fetchImpl,
    recordDir,
  });
}

describe("chatJson", () => {
  const previousReplay = process.env.LLM_REPLAY;
  const previousRecord = process.env.LLM_RECORD;
  const previousMaxTokens = process.env.NIGHTSHIFT_MAX_TOKENS;
  afterEach(() => {
    process.env.LLM_REPLAY = previousReplay;
    process.env.LLM_RECORD = previousRecord;
    if (previousMaxTokens === undefined) delete process.env.NIGHTSHIFT_MAX_TOKENS;
    else process.env.NIGHTSHIFT_MAX_TOKENS = previousMaxTokens;
  });

  it("retries invalid JSON once then escalates", async () => {
    process.env.LLM_REPLAY = "false";
    process.env.LLM_RECORD = "false";
    const fetchImpl = vi.fn().mockImplementation(async () => {
      return new Response(JSON.stringify({ choices: [{ message: { content: "not-json" } }] }), { status: 200 });
    });
    const llm = client(fetchImpl, mkdtempSync(join(tmpdir(), "llm-")), { workerModel: "super" });
    await expect(llm.chatJson("planner", [{ role: "user", content: "hi" }], schema)).rejects.toThrow(
      /model response failed schema validation after retry \(invalid json\) not-json/,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("names zod paths and the model content, and leaves the token out", async () => {
    process.env.LLM_REPLAY = "false";
    process.env.LLM_RECORD = "false";
    const token = "nightshift-token-do-not-leak";
    const tail = "TAIL-MARKER-NOT-IN-SNIPPET";
    const content = `{"rankings":[{"risk":"low","note":"${"x".repeat(280)}"}],"tail":"${tail}"}`;
    const fetchImpl = vi.fn().mockImplementation(async () => {
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const shape = z.object({ rankings: z.array(z.object({ risk: z.number() })) });
    const llm = client(fetchImpl, mkdtempSync(join(tmpdir(), "llm-")), { workerModel: "super", token });
    let caught: unknown;
    try {
      await llm.chatJson("planner", [{ role: "user", content: "hi" }], shape);
    } catch (error) {
      caught = error;
    }
    const logged = [...log.mock.calls, ...err.mock.calls].flat().join(" ");
    log.mockRestore();
    err.mockRestore();
    expect(caught).toBeInstanceOf(EscalationError);
    const message = caught instanceof Error ? caught.message : "";
    expect(message).toContain("rankings.0.risk: expected number");
    expect(message).toContain(content.slice(0, 300));
    expect(message).not.toContain(tail);
    expect(message).not.toContain(token);
    expect(message).not.toContain("Bearer");
    expect(logged).not.toContain(token);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("falls back to the worker model when the planner model fails schema validation", async () => {
    process.env.LLM_REPLAY = "false";
    process.env.LLM_RECORD = "false";
    const fetchImpl = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { model: string };
      const content = body.model === "lightning" ? "{\"ok\":true}" : "{\"ok\":\"no\"}";
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    });
    const llm = client(fetchImpl, mkdtempSync(join(tmpdir(), "llm-")));
    const result = await llm.chatJson("planner", [{ role: "user", content: "hi" }], schema);
    expect(result.data).toEqual({ ok: true });
    expect(result.model).toBe("lightning");
    const models = fetchImpl.mock.calls.map((call) => {
      const init = call[1] as RequestInit;
      return (JSON.parse(String(init.body)) as { model: string }).model;
    });
    expect(models).toEqual(["super", "super", "lightning"]);
  });

  it("replay mode makes no network call", async () => {
    const dir = mkdtempSync(join(tmpdir(), "llm-"));
    const key = replayKey("planner", "super", [{ role: "user", content: "hi" }]);
    writeFileSync(
      join(dir, `${key}.json`),
      JSON.stringify({ request: {}, response: { content: "{\"ok\":true}" }, model: "super", latencyMs: 3 }),
    );
    process.env.LLM_REPLAY = "true";
    const fetchImpl = vi.fn();
    const llm = client(fetchImpl, dir);
    const result = await llm.chatJson("planner", [{ role: "user", content: "hi" }], schema);
    expect(result.data).toEqual({ ok: true });
    expect(result.replayed).toBe(true);
    expect(result.meterlessReceiptId).toBeNull();
    expect(result.routedModel).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reads message.content, ignores reasoning, and records the Meterless route", async () => {
    process.env.LLM_REPLAY = "false";
    process.env.LLM_RECORD = "true";
    delete process.env.NIGHTSHIFT_MAX_TOKENS;
    const dir = mkdtempSync(join(tmpdir(), "llm-"));
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "{\"ok\":true}",
                reasoning: "think {\"ok\":false}",
                reasoning_content: "{\"ok\":false}",
              },
            },
          ],
          meterless: { receipt_id: "mtr-9", winning_route: { model: "nvidia/nemotron-super" } },
        }),
        { status: 200 },
      ),
    );
    const llm = client(fetchImpl, dir);
    const result = await llm.chatJson("planner", [{ role: "user", content: "hi" }], schema);
    expect(result).toMatchObject({
      data: { ok: true },
      model: "super",
      replayed: false,
      meterlessReceiptId: "mtr-9",
      routedModel: "nvidia/nemotron-super",
    });
    const request = JSON.parse(String((fetchImpl.mock.calls[0]?.[1] as RequestInit).body));
    expect(request.max_tokens).toBe(1500);
    const key = replayKey("planner", "super", [{ role: "user", content: "hi" }]);
    const recorded = JSON.parse(readFileSync(join(dir, `${key}.json`), "utf8")) as {
      model: string;
      latencyMs: number;
      replayed: boolean;
      meterlessReceiptId: string;
      routedModel: string;
      response: { content: string };
    };
    expect(recorded).toMatchObject({
      model: "super",
      replayed: false,
      meterlessReceiptId: "mtr-9",
      routedModel: "nvidia/nemotron-super",
      response: { content: "{\"ok\":true}" },
    });
    expect(recorded.latencyMs).toEqual(expect.any(Number));
    expect(JSON.stringify(recorded)).not.toContain("think");

    process.env.LLM_REPLAY = "true";
    const replayed = await llm.chatJson("planner", [{ role: "user", content: "hi" }], schema);
    expect(replayed).toMatchObject({
      data: { ok: true },
      model: "super",
      replayed: true,
      meterlessReceiptId: "mtr-9",
      routedModel: "nvidia/nemotron-super",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("keeps max_tokens at least 1500 and honors a larger env override", () => {
    expect(readMaxTokens("20")).toBe(1500);
    expect(readMaxTokens("4000")).toBe(4000);
    expect(readMaxTokens(undefined)).toBeGreaterThanOrEqual(1500);
  });

  it("uses the same replay key when runId differs", () => {
    const a = replayKey("planner", "super", [{ role: "user", content: JSON.stringify({ runId: "run-a", n: 1 }) }]);
    const b = replayKey("planner", "super", [{ role: "user", content: JSON.stringify({ runId: "run-b", n: 1 }) }]);
    expect(a).toBe(b);
  });

  it("uses the same replay key when only gateway receipt ids differ", () => {
    const arbiter = (receipt: string, runId: string, value = "terminated") => [
      {
        role: "user" as const,
        content: JSON.stringify({
          runId,
          claims: [{ listingId: "L-00100", field: "status", source: "roster", value, receiptIds: [receipt] }],
        }),
      },
    ];
    const model = "nvidia/nemotron-3-ultra-550b-a55b";
    const sameReceipt = replayKey("planner", model, arbiter("rcpt_5920298dffa56057", "run-a"));
    const otherReceipt = replayKey("planner", model, arbiter("rcpt_aaaaaaaaaaaaaaaa", "run-b"));
    const otherValue = replayKey("planner", model, arbiter("rcpt_aaaaaaaaaaaaaaaa", "run-b", "in"));
    expect(sameReceipt).toBe(otherReceipt);
    expect(otherValue).not.toBe(sameReceipt);
  });

  it("rewrites a recorded receipt id onto the current run", async () => {
    process.env.LLM_REPLAY = "true";
    const oldId = "rcpt_1111111111111111";
    const newId = "rcpt_2222222222222222";
    const recordedMessages = [
      { role: "user" as const, content: JSON.stringify({ claims: [{ receiptIds: [oldId] }] }) },
    ];
    const currentMessages = [
      { role: "user" as const, content: JSON.stringify({ claims: [{ receiptIds: [newId] }] }) },
    ];
    const dir = mkdtempSync(join(tmpdir(), "llm-"));
    const key = replayKey("planner", "super", currentMessages);
    writeFileSync(
      join(dir, `${key}.json`),
      JSON.stringify({
        request: { role: "planner", model: "super", messages: recordedMessages },
        response: { content: JSON.stringify({ receiptIds: [oldId] }) },
        model: "super",
        latencyMs: 1,
      }),
    );
    const llm = client(vi.fn(), dir);
    const shape = z.object({ receiptIds: z.array(z.string()) });
    const replayed = await llm.chatJson("planner", currentMessages, shape);
    expect(replayed.data.receiptIds).toEqual([newId]);
    expect(replayed.replayed).toBe(true);
  });

  it("leaves recorded receipt ids in place when the messages do not align", () => {
    const oldId = "rcpt_1111111111111111";
    const map = alignReceiptIds(
      [{ content: `${oldId} rcpt_3333333333333333` }],
      [{ content: "rcpt_2222222222222222" }],
    );
    expect(map.size).toBe(0);
    expect(applyReceiptIds(oldId, map)).toBe(oldId);
  });

  it("throws ReplayMissError naming the key", async () => {
    process.env.LLM_REPLAY = "true";
    const dir = mkdtempSync(join(tmpdir(), "llm-"));
    const fetchImpl = vi.fn();
    const llm = client(fetchImpl, dir);
    const key = replayKey("planner", "super", [{ role: "user", content: "missing" }]);
    await expect(llm.chatJson("planner", [{ role: "user", content: "missing" }], schema)).rejects.toMatchObject({
      name: "ReplayMissError",
      key,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(ReplayMissError).toBeDefined();
  });
});
