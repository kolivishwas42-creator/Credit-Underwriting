import type { ReactNode } from "react";
import { agentById } from "../../config/agents";
import { Icon } from "./Icon";
import { AgentTitle } from "./Typewriter";
import { SidebarToggle } from "./SidebarToggle";

export interface FrameItem {
  id: string;
  label: string;
  icon: string;
  active?: boolean;
  onSelect: () => void;
}

/**
 * THE COMMON AGENT FRAME (owner 2026-11-12): every agent has the same left sidebar -- its logo with its name typing,
 * what it does, the open case, and its sections as a menu -- and its own screen on the right. On a phone the sidebar
 * is a compact block on top with the menu as one row.
 */
export function AgentFrame({ agent, items = [], top, caseLabel, footer, children }: {
  agent: string;
  items?: FrameItem[];
  /** something the agent keeps at the top of its sidebar (e.g. Bank's case search) */
  top?: ReactNode;
  /** the case / application open now */
  caseLabel?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const info = agentById(agent);
  return (
    <div className="cu-frame">
      <aside className="cu-frame-side" aria-label={`${info?.title ?? agent} menu`}>
        <div className="cu-frame-brand">
          <h1 className="cu-frame-title"><AgentTitle id={agent} /></h1>
          {info?.description && <p className="cu-frame-desc">{info.description}</p>}
        </div>
        {top && <div className="cu-frame-top">{top}</div>}
        {caseLabel && (
          <div className="cu-frame-case">
            <small>Open now</small>
            <b>{caseLabel}</b>
          </div>
        )}
        {items.length > 0 && (
          <div className="cu-frame-nav" role="tablist" aria-orientation="vertical" aria-label="Sections">
            {items.map((it) => (
              <button key={it.id} type="button" role="tab" aria-selected={Boolean(it.active)}
                className={`cu-frame-item${it.active ? " is-on" : ""}`} onClick={it.onSelect}>
                <Icon name={it.icon} /><span>{it.label}</span>
              </button>
            ))}
          </div>
        )}
        {footer && <div className="cu-frame-foot">{footer}</div>}
      </aside>
      <div className="cu-frame-main">{children}</div>
      <SidebarToggle />
    </div>
  );
}
