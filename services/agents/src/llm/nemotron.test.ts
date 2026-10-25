import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { EscalationError, ReplayMissError, createNemotronClient, readMaxTokens, replayKey } from "./nemotron.js";

const schema = z.object({ ok: z.boolean() });

function client(fetchImpl: typeof fetch, recordDir: string) {
  return createNemotronClient({
    token: "test",
    plannerModel: "super",
    workerModel: "lightning",
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
    const llm = client(fetchImpl, mkdtempSync(join(tmpdir(), "llm-")));
    await expect(llm.chatJson("planner", [{ role: "user", content: "hi" }], schema)).rejects.toBeInstanceOf(
      EscalationError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
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
