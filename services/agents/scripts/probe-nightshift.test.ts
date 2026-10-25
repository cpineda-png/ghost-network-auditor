import { describe, expect, it } from "vitest";
import { looksSuper, probeOutcome } from "./probe-nightshift.js";

describe("probe models", () => {
  it("treats Ultra and Super as the planner model", () => {
    expect(looksSuper("nvidia/nemotron-3-ultra-550b-a55b")).toBe(true);
    expect(looksSuper("nvidia/nemotron-3-super-120b")).toBe(true);
    expect(looksSuper("nvidia/nemotron-3.5-lightning-30b-a3b")).toBe(false);
  });
});

describe("probe outcome", () => {
  it("exits 0 when both configured models return json=ok, even if thinking fails", () => {
    const outcome = probeOutcome(true, false);
    expect(outcome.exitCode).toBe(0);
    expect(outcome.warning).toMatch(/^Probe warning:/);
  });

  it("exits 1 when the JSON chat fails", () => {
    expect(probeOutcome(false, true).exitCode).toBe(1);
    expect(probeOutcome(false, false)).toEqual({ exitCode: 1, warning: null });
  });

  it("exits 0 with no warning when JSON and thinking both succeed", () => {
    expect(probeOutcome(true, true)).toEqual({ exitCode: 0, warning: null });
  });
});
