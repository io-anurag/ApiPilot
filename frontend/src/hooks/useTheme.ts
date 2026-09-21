import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "apipilot-theme";

// window.matchMedia is absent in this project's jsdom test environment (see the same guard in
// WorkflowStageTracker.tsx), so it's optional-chained rather than assumed present.
function getSystemTheme(): Theme {
  return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
}

function readStoredTheme(): Theme | null {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : null;
}

/**
 * Explicit light/dark selection, persisted across sessions and applied via `data-theme` on
 * <html> — both index.css's dark tokens and every Tailwind `dark:` utility (via its
 * `@custom-variant dark` override) key off that attribute alone, resolved here from a stored
 * choice or else the OS preference. index.html sets the same attribute synchronously before
 * first paint using this same read order, so the value computed here on mount always matches
 * what is already on the page — this effect exists to keep it in sync on later changes (e.g. the
 * OS preference changing while no explicit choice is stored).
 */
export function useTheme() {
  const [themeState, setThemeState] = useState<Theme>(() => readStoredTheme() ?? getSystemTheme());

  useEffect(() => {
    document.documentElement.dataset.theme = themeState;
  }, [themeState]);

  useEffect(() => {
    if (readStoredTheme() !== null) return;
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) return;
    const handleChange = () => setThemeState(getSystemTheme());
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    window.localStorage.setItem(STORAGE_KEY, next);
    setThemeState(next);
  }, []);

  return { theme: themeState, setTheme };
}
