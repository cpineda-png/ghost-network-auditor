import { pathToFileURL } from "node:url";
import { plan } from "./agents/planner.js";
import { createGateway, GatewayError } from "./gateway/client.js";
import { MockGateway } from "./gateway/mock.js";
import type { Gateway } from "./gateway/types.js";
import { createNemotronClient, type LlmClient } from "./llm/nemotron.js";
import { MeterlessHMem } from "./memory/hmem.js";
import { GnaWorldModel } from "./world/worldModel.js";

export async function runSmoke(overrides: { gateway?: Gateway; llm?: LlmClient } = {}) {
  const gateway = overrides.gateway ?? createGateway();
  const world = new GnaWorldModel();
  const hmem = new MeterlessHMem();
  const llm = overrides.llm ?? createNemotronClient();
  const planned = await plan({
    request: { scope: { batch: "A" }, useMemory: true },
    runId: "smoke-run",
    gateway,
    world,
    llm,
  });
  const listing = planned.firstListing;
  if (!listing) {
    throw new Error("directory_batch returned no listing");
  }
  const ruling = await hmem.recordRuling({
    runId: planned.runId,
    listingId: listing.listing_id,
    field: "phone",
    value: listing.phone,
    source: "directory",
    analyst: "smoke",
  });
  await world.append({
    runId: planned.runId,
    ts: new Date().toISOString(),
    actor: "human",
    type: "ruling_recorded",
    entityId: listing.listing_id,
    field: "phone",
    payload: { memoryId: ruling.memoryId },
  });
  const lines = [
    `ZETARIS receipt=${planned.receiptId} rows=${planned.rows} mode=${planned.mode}`,
    `HMEM write memoryId=${ruling.memoryId}`,
    `NEMOTRON call model=${planned.model} tasks=${planned.tasks} replayed=${planned.replayed}`,
    `GATEWAY url=${gatewayLabel(gateway)}`,
  ];
  for (const line of lines) console.log(line);
  return lines;
}

function gatewayLabel(gateway: Gateway): string {
  if (gateway instanceof MockGateway) return "mock";
  return (process.env.GATEWAY_URL ?? "http://localhost:8081").replace(/\/$/, "");
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
    if (error instanceof GatewayError && (error.status === 502 || error.status === 503)) {
      const detail = error.failure?.error ?? error.message;
      const sqlState = error.failure?.sqlState ?? null;
      console.error(`error=${detail} sqlState=${sqlState}`);
      process.exit(1);
    }
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
