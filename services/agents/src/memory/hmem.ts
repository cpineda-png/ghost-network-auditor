export type MemoryRecord = {
  id: string;
  payload: unknown;
};

export interface HMem {
  put(record: MemoryRecord): Promise<void>;
  get(id: string): Promise<MemoryRecord | undefined>;
  list(): Promise<MemoryRecord[]>;
}

export class InMemoryHMem implements HMem {
  private readonly records = new Map<string, MemoryRecord>();

  async put(record: MemoryRecord): Promise<void> {
    this.records.set(record.id, record);
  }

  async get(id: string): Promise<MemoryRecord | undefined> {
    return this.records.get(id);
  }

  async list(): Promise<MemoryRecord[]> {
    return [...this.records.values()];
  }
}
