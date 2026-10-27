import { afterEach, describe, expect, it } from "vitest";
import { monthWindow } from "./investigator.js";

describe("monthWindow", () => {
  const previous = process.env.DATA_AS_OF_MONTH;

  afterEach(() => {
    if (previous === undefined) delete process.env.DATA_AS_OF_MONTH;
    else process.env.DATA_AS_OF_MONTH = previous;
  });

  it("defaults to 2025-09 through 2026-10", () => {
    delete process.env.DATA_AS_OF_MONTH;
    expect(monthWindow()).toEqual({ fromMonth: "2025-09", toMonth: "2026-10" });
  });

  it("uses an explicit date when a test passes one", () => {
    process.env.DATA_AS_OF_MONTH = "2026-10";
    expect(monthWindow(new Date(Date.UTC(2024, 5, 2)))).toEqual({
      fromMonth: "2023-05",
      toMonth: "2024-06",
    });
  });
});
