import { useCallback, useState } from "react";

export const THEME_STORAGE_KEY = "kokoro-theme";

export type ThemePreference = "system" | "light" | "dark";

function getLocalStorage(): Storage | null {
  try {
    if (typeof globalThis.localStorage === "undefined") return null;
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function isThemePreference(value: string | null): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function readStoredThemePreference(): ThemePreference {
  const storage = getLocalStorage();
  if (!storage) return "system";

  try {
    const storedValue = storage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(storedValue) ? storedValue : "system";
  } catch {
    return "system";
  }
}

function persistThemePreference(preference: ThemePreference): void {
  const storage = getLocalStorage();
  if (!storage) return;

  try {
    storage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // A blocked or full localStorage should not prevent the theme from updating in memory.
  }
}

export function applyThemePreference(
  preference: ThemePreference,
  documentElement?: HTMLElement | null,
): void {
  const element =
    documentElement ?? (typeof document === "undefined" ? null : document.documentElement);
  if (!element) return;

  element.classList.toggle("dark", preference === "dark");
  element.classList.toggle("light", preference === "light");
}

export function initializeTheme(): ThemePreference {
  const preference = readStoredThemePreference();
  applyThemePreference(preference);
  return preference;
}

export function useTheme(): [ThemePreference, (preference: ThemePreference) => void] {
  const [preference, setPreference] = useState<ThemePreference>(() => readStoredThemePreference());

  const updatePreference = useCallback((nextPreference: ThemePreference): void => {
    persistThemePreference(nextPreference);
    applyThemePreference(nextPreference);
    setPreference(nextPreference);
  }, []);

  return [preference, updatePreference];
}
