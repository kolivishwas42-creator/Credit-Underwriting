// Light / dark: "light" / "dark" = the person's choice on this browser (localStorage "los-copilot-theme"); nothing
// saved = follow the system setting. applySavedTheme() runs before the first render, so a saved theme never flashes.
import { useCallback, useState } from "react";

import { THEME_KEY } from "../../shared/theme";
export { THEME_KEY };
export type Theme = "light" | "dark";

export function applySavedTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") document.documentElement.dataset.theme = saved;
  } catch { /* private window: follow the system */ }
}

function current(): Theme {
  const root = document.documentElement;
  if (root.dataset.theme === "dark" || root.dataset.theme === "light") return root.dataset.theme;
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** The theme as React state; toggle() flips it, writes data-theme on <html> and remembers it. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(current);
  const toggle = useCallback(() => {
    const next: Theme = current() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(THEME_KEY, next); } catch { /* not saved */ }
    setTheme(next);
  }, []);
  return { theme, toggle };
}
