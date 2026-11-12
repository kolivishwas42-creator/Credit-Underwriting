// Light / dark for the whole console: "light" | "dark" = the person's choice on this browser; "system" = follow the
// operating system (no data-theme on <html>). Every agent reads the same <html data-theme>.
export type ThemeChoice = "system" | "light" | "dark";
export const THEME_KEY = "los-console-theme";

export function savedTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === "system") delete root.dataset.theme;
  else root.dataset.theme = choice;
  try {
    if (choice === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, choice);
  } catch { /* not saved: still applies for this visit */ }
}

export const nextTheme = (c: ThemeChoice): ThemeChoice => (c === "system" ? "light" : c === "light" ? "dark" : "system");
