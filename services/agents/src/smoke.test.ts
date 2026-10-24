import { describe, expect, it, vi } from "vitest";
import { MockGateway } from "./gateway/mock.js";
import type { LlmClient } from "./llm/nemotron.js";
import { runSmoke } from "./smoke.js";

describe("smoke", () => {
  it("prints four lines with MockGateway and a replayed planner call", async () => {
    const llm: LlmClient = {
      chatJson: vi.fn().mockResolvedValue({
        data: {
          rankings: [{ chunkIndex: 0, risk: 0.4, templates: ["roster_by_npis", "claims_by_npis"] }],
          rationale: "batch A needs roster and claims",
        },
        model: "nemotron-super",
        latencyMs: 5,
        replayed: true,
      }),
    };
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line: string) => {
      logs.push(String(line));
    });
    try {
      const lines = await runSmoke({ gateway: new MockGateway(), llm });
      expect(lines).toHaveLength(4);
      expect(lines[0]).toMatch(/^ZETARIS receipt=.+ rows=10 mode=replayed$/);
      expect(lines[1]).toMatch(/^HMEM write memoryId=.+$/);
      expect(lines[2]).toMatch(/^NEMOTRON call model=nemotron-super tasks=3 replayed=true$/);
      expect(lines[3]).toBe("GATEWAY url=mock");
      expect(logs).toEqual(lines);
    } finally {
      spy.mockRestore();
    }
  });
});
