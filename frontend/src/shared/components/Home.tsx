import { useLayoutEffect } from "react";
import { AGENTS, GROUP_NOTES, GROUPS } from "../../config/agents";
import { RULES_SETTINGS_VISIBLE, RULES_WORDS } from "../../config/rulesSettings";
import { Icon } from "./Icon";
import { RulesConsole } from "./RulesConsole";

export type HomeView = "agents" | "rules";

/**
 * The landing view. A sidebar with its sections (owner 2026-11-13): AGENTS -- the underwriting journey as a board, one
 * column per stage, its agents as cards -- and RULES SETTINGS, every agent's rules in one place apart from the agents.
 */
export function Home({ onOpen, view = "agents", onView }: {
  onOpen: (id: string) => void; view?: HomeView; onView?: (v: HomeView) => void;
}) {
  useLayoutEffect(() => { document.title = view === "rules" ? `${RULES_WORDS.title} · Credit Underwriting` : "Credit Underwriting"; }, [view]);
  const tabs: { id: HomeView; label: string; icon: string }[] = [
    { id: "agents", label: RULES_WORDS.homeAgents, icon: "grid" },
    ...(RULES_SETTINGS_VISIBLE ? [{ id: "rules" as HomeView, label: RULES_WORDS.title, icon: "sliders" }] : []),
  ];
  const shown: HomeView = view === "rules" && RULES_SETTINGS_VISIBLE ? "rules" : "agents";
  return (
    <div className="cu-overview">
      <aside className="cu-overview-side" aria-label="Overview sections">
        <div className="cu-overview-side-head">Overview</div>
        <div role="tablist" aria-orientation="vertical">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={shown === t.id}
              className={`cu-overview-tab${shown === t.id ? " is-on" : ""}`} onClick={() => onView?.(t.id)}>
              <Icon name={t.icon} /><span>{t.label}</span>
            </button>
          ))}
        </div>
      </aside>
      <div className="cu-overview-main">
        {shown === "rules" ? <RulesConsole /> : <AgentsBoard onOpen={onOpen} />}
      </div>
    </div>
  );
}

function AgentsBoard({ onOpen }: { onOpen: (id: string) => void }) {
  return (
    <div className="cu-home">
      <div className="cu-home-head">
        <div>
          <div className="cu-eyebrow">Credit underwriting</div>
          <div className="cu-h1" role="heading" aria-level={1}>Agent console</div>
          <div className="cu-lede">{AGENTS.length} agents across the loan journey. Pick one from the tabs above or below.</div>
        </div>
      </div>

      <div className="cu-board">
        {GROUPS.map((group, gi) => (
          <div key={group} className="cu-stage" role="region" aria-label={group}>
            <div className="cu-stage-head">
              <span className="cu-step">{gi + 1}</span>
              <div><div className="cu-h2" role="heading" aria-level={2}>{group}</div><div className="cu-note">{GROUP_NOTES[group]}</div></div>
            </div>
            <div className="cu-stage-cards">
              {AGENTS.filter((a) => a.group === group).map((a) => (
                <button key={a.id} type="button" className="cu-card" onClick={() => onOpen(a.id)}>
                  <span className="cu-card-icon"><Icon name={a.icon} /></span>
                  <span className="cu-card-text"><b>{a.label}</b><span>{a.description}</span></span>
                  <span className="cu-card-go"><Icon name="arrow" /></span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
