import { useEffect, useState } from "react";

export type ThemeName = "dark" | "light";

export const THEME_STORAGE_KEY = "gna-theme";

export function readStoredTheme(): ThemeName | null {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    if (value === "light" || value === "dark") return value;
  } catch {
    // Storage can throw in private mode.
  }
  return null;
}

export function storeTheme(theme: ThemeName): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Keep the on-page choice even when storage is blocked.
  }
}

export function systemTheme(): ThemeName {
  try {
    const media = window.matchMedia?.("(prefers-color-scheme: light)");
    return media?.matches ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function applyTheme(theme: ThemeName): void {
  document.documentElement.dataset.theme = theme;
}

export function clearThemeOverride(): void {
  delete document.documentElement.dataset.theme;
}

function watchSystemTheme(onChange: (theme: ThemeName) => void): () => void {
  try {
    const media = window.matchMedia?.("(prefers-color-scheme: light)");
    if (!media) return () => {};
    const sync = () => onChange(media.matches ? "light" : "dark");
    sync();
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", sync);
      return () => media.removeEventListener("change", sync);
    }
    return () => {};
  } catch {
    return () => {};
  }
}

/** Apply a stored choice before paint. With no choice, CSS follows the OS. */
export function initTheme(): void {
  const stored = readStoredTheme();
  if (stored) applyTheme(stored);
}

export function useTheme(): { theme: ThemeName; toggleTheme: () => void } {
  const [theme, setTheme] = useState<ThemeName>(() => readStoredTheme() ?? systemTheme());

  useEffect(() => {
    const stored = readStoredTheme();
    if (stored) {
      applyTheme(stored);
      setTheme(stored);
      return;
    }
    clearThemeOverride();
    return watchSystemTheme(setTheme);
  }, []);

  function toggleTheme() {
    setTheme((current) => {
      const next: ThemeName = current === "dark" ? "light" : "dark";
      storeTheme(next);
      applyTheme(next);
      return next;
    });
  }

  return { theme, toggleTheme };
}
