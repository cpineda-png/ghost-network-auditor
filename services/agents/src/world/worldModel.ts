import type { WmEvent } from "contracts";

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
