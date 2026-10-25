import { describe, expect, it } from "vitest";
import { probeOutcome } from "./probe-nightshift.js";

describe("probe outcome", () => {
  it("exits 0 with a warning when JSON works and the thinking test fails", () => {
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
