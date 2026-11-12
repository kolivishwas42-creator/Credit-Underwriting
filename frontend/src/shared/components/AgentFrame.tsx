import { useState, type ReactNode } from "react";
import { agentById } from "../../config/agents";
import { RULES_SOURCES, RULES_WORDS } from "../../config/rulesSettings";
import { Icon } from "./Icon";
import { RulesSettings, hasRulesSettings } from "./RulesSettings";
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
  // RULES SETTINGS (owner 2026-11-12): one more menu entry on every agent whose rules are configurable
  // (config/rulesSettings.ts). The agent's own screen stays mounted underneath -- nothing typed into it is lost --
  // and comes back on "Back" or any other menu item.
  const [rulesOpen, setRulesOpen] = useState(false);
  const menu: FrameItem[] = [
    ...items.map((it) => ({ ...it, active: !rulesOpen && it.active, onSelect: () => { setRulesOpen(false); it.onSelect(); } })),
    ...(hasRulesSettings(agent) && RULES_SOURCES[agent]?.entry !== "panel"
      ? [{ id: "rules-settings", label: RULES_WORDS.menu, icon: "sliders", active: rulesOpen, onSelect: () => setRulesOpen((o) => !o) }]
      : []),
  ];
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
        {menu.length > 0 && (
          <div className="cu-frame-nav" role="tablist" aria-orientation="vertical" aria-label="Sections">
            {menu.map((it) => (
              <button key={it.id} type="button" role="tab" aria-selected={Boolean(it.active)}
                className={`cu-frame-item${it.active ? " is-on" : ""}`} onClick={it.onSelect}>
                <Icon name={it.icon} /><span>{it.label}</span>
              </button>
            ))}
          </div>
        )}
        {footer && <div className="cu-frame-foot">{footer}</div>}
      </aside>
      <div className="cu-frame-main">
        {rulesOpen && <RulesSettings agent={agent} onBack={() => setRulesOpen(false)} />}
        {/* display: contents keeps the agent's own layout exactly as before while it is shown */}
        <div className="cu-frame-screen" style={{ display: rulesOpen ? "none" : "contents" }}>{children}</div>
      </div>
      <SidebarToggle />
    </div>
  );
}
