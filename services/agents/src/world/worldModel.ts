import { EventEmitter } from "node:events";
import type { WmEvent } from "contracts";
import {
  WorldModel as MeterlessWorldModel,
  canonicalJson,
  externalId,
  sha256Hex,
} from "../../vendor/world-model/reference/src/index.ts";

export function listingId(id: string): string {
  if (id.startsWith("listing:plan:")) return id;
  return externalId("listing", "plan", id);
}

export function eventIdFor(event: Omit<WmEvent, "eventId"> & { eventId?: string }): string {
  const { eventId: _ignored, ...rest } = event;
  return sha256Hex(canonicalJson(rest));
}

export class GnaWorldModel {
  private readonly log: WmEvent[] = [];
  private readonly seen = new Set<string>();
  private readonly emitter = new EventEmitter();
  readonly engine: MeterlessWorldModel;

  constructor(engine?: MeterlessWorldModel) {
    this.engine = engine ?? new MeterlessWorldModel({ namespace: "gna" });
  }

  async append(event: Omit<WmEvent, "eventId"> & { eventId?: string }): Promise<WmEvent> {
    const eventId = event.eventId ?? eventIdFor(event);
    if (this.seen.has(eventId)) {
      return this.log.find((item) => item.eventId === eventId)!;
    }
    const stored: WmEvent = { ...event, eventId, entityId: listingOrEntity(event.entityId) };
    this.seen.add(eventId);
    this.log.push(stored);
    await this.engine.upsertEntity({
      type: "listing",
      externalKey: { system: "plan", id: stored.entityId },
      name: stored.entityId,
      attrs: { runId: stored.runId, type: stored.type, ...(stored.field ? { field: stored.field } : {}) },
      source: { kind: "agent", by: stored.actor, at: stored.ts, runId: stored.runId },
    });
    this.emitter.emit(stored.runId, stored);
    this.emitter.emit("*", stored);
    return stored;
  }

  async eventsForRun(runId: string): Promise<WmEvent[]> {
    return this.log.filter((event) => event.runId === runId);
  }

  projectionForListing(id: string): WmEvent[] {
    const entityId = listingId(id);
    return this.log.filter((event) => event.entityId === entityId || event.entityId === id);
  }

  subscribe(runId: string, listener: (event: WmEvent) => void): () => void {
    this.emitter.on(runId, listener);
    return () => this.emitter.off(runId, listener);
  }
}

function listingOrEntity(entityId: string): string {
  if (entityId.startsWith("listing:") || entityId.startsWith("run:") || entityId.startsWith("chunk:")) {
    return entityId;
  }
  return listingId(entityId);
}
