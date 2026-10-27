import { afterEach, describe, expect, it, vi } from "vitest";
import { applyTheme, readStoredTheme, storeTheme, systemTheme, THEME_STORAGE_KEY } from "./theme";

describe("theme", () => {
  afterEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("stores and reads a theme choice", () => {
    storeTheme("light");
    expect(readStoredTheme()).toBe("light");
  });

  it("ignores a stored value that is not a theme", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "blue");
    expect(readStoredTheme()).toBeNull();
  });

  it("does not throw when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => storeTheme("dark")).not.toThrow();
    expect(readStoredTheme()).toBeNull();
  });

  it("sets the theme attribute", () => {
    applyTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("defaults to dark when the system preference cannot be read", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(systemTheme()).toBe("dark");
  });
});
