// Light / dark. "light" / "dark" = the person's choice on this browser; nothing saved = follow the system setting.
import { useCallback, useEffect, useState } from "react";

import { THEME_KEY } from "../../shared/theme";
export { THEME_KEY };
const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Runs in main.tsx before the first render, so a saved theme never flashes the other one first. */
export function applySavedTheme(): void {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") document.documentElement.dataset.theme = saved;
  } catch { /* private window: follow the system */ }
}

export function isDark(): boolean {
  const chosen = document.documentElement.dataset.theme;
  return chosen === "dark" || (!chosen && window.matchMedia(DARK_QUERY).matches);
}

/** [dark, toggle]: the toggle saves the choice and repaints when the system setting changes */
export function useTheme(): [boolean, () => void] {
  const [dark, setDark] = useState(isDark);
  useEffect(() => {
    const mq = window.matchMedia(DARK_QUERY);
    const repaint = () => setDark(isDark());
    mq.addEventListener?.("change", repaint);
    return () => mq.removeEventListener?.("change", repaint);
  }, []);
  const toggle = useCallback(() => {
    const next = isDark() ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(THEME_KEY, next); } catch { /* not saved: still switches for this visit */ }
    setDark(next === "dark");
  }, []);
  return [dark, toggle];
}
