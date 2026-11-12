import { useSyncExternalStore } from "react";

const KEY = "cu.sidebar.collapsed";

/** the choice is one for every agent and is remembered; storage can be blocked, so it is only a convenience */
function read(): boolean {
  try { return window.localStorage.getItem(KEY) === "1"; } catch { return false; }
}

let collapsed = typeof window !== "undefined" && read();
const listeners = new Set<() => void>();

/** shell.css hangs the collapsed layout of every agent off this attribute */
function apply() {
  if (typeof document === "undefined") return;
  if (collapsed) document.documentElement.setAttribute("data-side-collapsed", "true");
  else document.documentElement.removeAttribute("data-side-collapsed");
}
apply();

function set(next: boolean) {
  collapsed = next;
  try { window.localStorage.setItem(KEY, next ? "1" : "0"); } catch { /* not remembered */ }
  apply();
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** [collapsed, toggle] for the agents' left sidebars */
export function useSidebarCollapsed(): [boolean, () => void] {
  const now = useSyncExternalStore(subscribe, () => collapsed, () => false);
  return [now, () => set(!collapsed)];
}
