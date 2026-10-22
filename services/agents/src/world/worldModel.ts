import type { WmEvent } from "contracts";

// Wrap vendor/world-model/reference. Keep this WmEvent log as input.
// Use the reference for stable IDs, idempotent append, and a
// per-listing projection. See docs/meterless-adapters.md.
export interface WorldModel {
  append(event: WmEvent): Promise<void>;
  eventsForRun(runId: string): Promise<WmEvent[]>;
}

export class InMemoryWorldModel implements WorldModel {
  private readonly events: WmEvent[] = [];

  async append(event: WmEvent): Promise<void> {
    this.events.push(event);
  }

  async eventsForRun(runId: string): Promise<WmEvent[]> {
    return this.events.filter((event) => event.runId === runId);
  }
}
