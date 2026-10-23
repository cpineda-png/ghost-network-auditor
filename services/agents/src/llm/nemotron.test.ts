import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { EscalationError, ReplayMissError, createNemotronClient, replayKey } from "./nemotron.js";

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
  afterEach(() => {
    process.env.LLM_REPLAY = previousReplay;
    process.env.LLM_RECORD = previousRecord;
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
    expect(fetchImpl).not.toHaveBeenCalled();
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
