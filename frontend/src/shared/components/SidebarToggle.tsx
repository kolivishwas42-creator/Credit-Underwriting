import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useSidebarCollapsed } from "../hooks/useSidebarCollapsed";

/**
 * The collapse / expand button of an agent's left sidebar (owner 2026-11-12: every agent's sidebar collapses, so the
 * screen can take the whole width). One button for every agent, in a slim vertical rail of its own down the left of the
 * agent area, there open or collapsed, so it covers nothing and the page never moves. The collapsing itself is CSS (shell.css), keyed on the data-side-collapsed attribute this sets on <html>.
 * The rail is drawn into the shell's main area, outside the agent's own scrolling page; CSS keeps the agent clear of it.
 */
export function SidebarToggle() {
  const [collapsed, toggle] = useSidebarCollapsed();
  const [host, setHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => { setHost(document.querySelector<HTMLElement>("#cu-shell .cu-main")); }, []);
  if (!host) return null;
  const label = collapsed ? "Show sidebar" : "Hide sidebar";
  return createPortal(
    <div className="cu-side-bar">
      <button type="button" className={`cu-side-toggle${collapsed ? " is-collapsed" : ""}`}
        aria-label={label} title={label} aria-expanded={!collapsed} onClick={toggle}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
      </button>
    </div>,
    host,
  );
}
