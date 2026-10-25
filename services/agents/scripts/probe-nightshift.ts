import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { answerContent, readMaxTokens } from "../src/llm/nemotron.js";

const APP_HEADER = { "meterless-app": "ghost-network-auditor" };

function loadDotEnv() {
  const path = resolve(process.cwd(), ".env");
  const rootPath = resolve(process.cwd(), "../../.env");
  for (const candidate of [path, rootPath]) {
    if (!existsSync(candidate)) continue;
    const text = readFileSync(candidate, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

let baseUrl = (process.env.NIGHTSHIFT_BASE_URL ?? "http://127.0.0.1:8088/v1").replace(/\/$/, "");
let token = process.env.NIGHTSHIFT_TOKEN ?? "";

export function looksSuper(id: string): boolean {
  return /super|ultra/i.test(id);
}

function preferredPlanner(listed: string[]): string | undefined {
  return listed.find((id) => /ultra/i.test(id)) ?? listed.find((id) => /super/i.test(id));
}
function looksLightning(id: string): boolean {
  return /lightning/i.test(id);
}

async function getJson(path: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { ...APP_HEADER, ...(init?.headers as Record<string, string> | undefined) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  return { status: response.status, body };
}

function pickModels(listed: string[]): { planner?: string; worker?: string } {
  const configuredPlanner = process.env.NEMOTRON_PLANNER_MODEL;
  const configuredWorker = process.env.NEMOTRON_WORKER_MODEL;
  const plannerId = preferredPlanner(listed);
  const lightningId = listed.find(looksLightning);
  return {
    planner: configuredPlanner || plannerId || listed[0],
    worker: configuredWorker || lightningId || listed[1] || listed[0],
  };
}

async function chatOnce(
  model: string,
  withThinking: boolean,
): Promise<{ ok: boolean; jsonOk: boolean; status: number; hasThinking: boolean; error?: string }> {
  const payload: Record<string, unknown> = {
    model,
    messages: [
      {
        role: "user",
        content: 'Reply with JSON only: {"ok":true}',
      },
    ],
    response_format: { type: "json_object" },
    max_tokens: readMaxTokens(),
  };
  if (withThinking) {
    payload.chat_template_kwargs = { enable_thinking: true, reasoning_budget: 256 };
  }
  const { status, body } = await getJson("/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const record = body as {
    error?: { message?: string };
    choices?: { message?: { content?: string; reasoning?: unknown; reasoning_content?: unknown } }[];
  };
  const message = record.choices?.[0]?.message;
  const content = answerContent(message);
  const hasThinking = Boolean(message?.reasoning ?? message?.reasoning_content);
  const ok = status >= 200 && status < 300;
  let jsonOk = false;
  if (ok && content.trim() !== "") {
    try {
      JSON.parse(content);
      jsonOk = true;
    } catch {
      jsonOk = false;
    }
  }
  return {
    ok,
    jsonOk,
    status,
    hasThinking,
    error: ok ? undefined : record.error?.message ?? `status ${status}`,
  };
}

export function probeOutcome(jsonOk: boolean, thinkingOk: boolean): { exitCode: number; warning: string | null } {
  if (!jsonOk) return { exitCode: 1, warning: null };
  if (!thinkingOk) {
    return {
      exitCode: 0,
      warning:
        "Probe warning: thinking kwargs were not clearly honored. Critic should omit chat_template_kwargs until Nightshift passes them through.",
    };
  }
  return { exitCode: 0, warning: null };
}

async function main() {
  loadDotEnv();
  baseUrl = (process.env.NIGHTSHIFT_BASE_URL ?? "http://127.0.0.1:8088/v1").replace(/\/$/, "");
  token = process.env.NIGHTSHIFT_TOKEN ?? "";
  console.log(`Nightshift base: ${baseUrl}`);
  let listed: string[] = [];
  try {
    const { status, body } = await getJson("/models");
    if (status < 200 || status >= 300) {
      console.log(`GET /models failed: HTTP ${status}`);
      console.log("Probe failed: Nightshift is unreachable or rejected /models.");
      process.exit(1);
    }
    const data = (body as { data?: { id: string }[] }).data ?? [];
    listed = data.map((m) => m.id);
    console.log(`Listed models (${listed.length}): ${listed.join(", ") || "(none)"}`);
  } catch (error) {
    console.log(`GET /models failed: ${error instanceof Error ? error.message : "unknown error"}`);
    console.log("Probe failed: Nightshift is unreachable.");
    process.exit(1);
  }

  const picked = pickModels(listed);
  if (!picked.planner || !picked.worker) {
    console.log("Probe failed: no models to pin for planner/worker.");
    process.exit(1);
  }

  const canPinPlanner = !process.env.NEMOTRON_PLANNER_MODEL || listed.includes(process.env.NEMOTRON_PLANNER_MODEL);
  const canPinWorker = !process.env.NEMOTRON_WORKER_MODEL || listed.includes(process.env.NEMOTRON_WORKER_MODEL);
  const distinctRoles = picked.planner !== picked.worker;
  console.log(`Planner model: ${picked.planner}`);
  console.log(`Worker model: ${picked.worker}`);
  console.log(`Ultra/Lightning pin per role: ${distinctRoles && canPinPlanner && canPinWorker ? "yes" : "uncertain"}`);
  console.log(`Planner looks Super: ${looksSuper(picked.planner)}`);
  console.log(`Worker looks Lightning: ${looksLightning(picked.worker)}`);

  const uniqueModels = [...new Set([picked.planner, picked.worker])];
  let jsonOk = true;
  let thinkingOk = true;
  for (const model of uniqueModels) {
    const plain = await chatOnce(model, false);
    const thinking = await chatOnce(model, true);
    console.log(
      `Model ${model}: json=${plain.jsonOk ? "ok" : "FAIL"} thinking=${thinking.ok ? "ok" : "FAIL"} thinking_field=${thinking.hasThinking}`,
    );
    if (!plain.jsonOk) jsonOk = false;
    if (!thinking.ok || !thinking.hasThinking) thinkingOk = false;
  }
  console.log(`chat_template_kwargs honored: ${thinkingOk ? "yes" : "no"}`);

  const outcome = probeOutcome(jsonOk, thinkingOk);
  if (outcome.exitCode !== 0) {
    console.log("Probe failed: a configured Nemotron model rejected a trivial JSON chat.");
    process.exit(outcome.exitCode);
  }
  if (outcome.warning) console.log(outcome.warning);
  console.log("Probe passed.");
}

function isMain(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
}

if (isMain()) {
  main();
}
