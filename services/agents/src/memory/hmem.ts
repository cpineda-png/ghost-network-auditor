// Wrap vendor/hmem/reference. See docs/meterless-adapters.md.
// Rulings: source user_correction, type factual, confidence 0.9.
// ConflictDetection is for contradicting rulings only, not
// directory-versus-roster. The newer ruling supersedes the older.
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
