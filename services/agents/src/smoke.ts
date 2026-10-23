import { pathToFileURL } from "node:url";
import { plan } from "./agents/planner.js";
import { MockGateway } from "./gateway/mock.js";
import type { Gateway } from "./gateway/types.js";
import { createNemotronClient, type LlmClient } from "./llm/nemotron.js";
import { MeterlessHMem } from "./memory/hmem.js";
import { GnaWorldModel } from "./world/worldModel.js";

export async function runSmoke(overrides: { gateway?: Gateway; llm?: LlmClient } = {}) {
  const gateway = overrides.gateway ?? new MockGateway();
  const world = new GnaWorldModel();
  const hmem = new MeterlessHMem();
  const llm = overrides.llm ?? createNemotronClient();
  const planned = await plan({
    request: { scope: { batch: "A", county: "Sangamon", specialty: "family medicine" }, useMemory: true },
    runId: "smoke-run",
    gateway,
    world,
    llm,
  });
  const ruling = await hmem.recordRuling({
    runId: planned.runId,
    listingId: "listing:plan:L-00001",
    field: "phone",
    value: "217-555-00001",
    source: "directory",
    analyst: "smoke",
  });
  await world.append({
    runId: planned.runId,
    ts: new Date().toISOString(),
    actor: "human",
    type: "ruling_recorded",
    entityId: "listing:plan:L-00001",
    field: "phone",
    payload: { memoryId: ruling.memoryId },
  });
  const lines = [
    `ZETARIS receipt=${planned.receiptId} rows=${planned.rows} mode=${planned.mode}`,
    `HMEM write memoryId=${ruling.memoryId}`,
    `NEMOTRON call model=${planned.model} tasks=${planned.tasks} replayed=${planned.replayed}`,
  ];
  for (const line of lines) console.log(line);
  return lines;
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
  runSmoke().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
