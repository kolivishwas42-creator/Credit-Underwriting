import { useEffect, useState } from "react";
import { AGENTS, GROUPS } from "../../config/agents";
import { RULES_SOURCES, RULES_WORDS as W } from "../../config/rulesSettings";
import { Icon } from "./Icon";
import { RulesSettings } from "./RulesSettings";

const PICK_KEY = "cu_rules_agent";

/**
 * RULES SETTINGS, ITS OWN PLACE (owner 2026-11-13: "pura alag rakhna, agents ke saath nahi; overview me sidebar me
 * tab"): every agent's rules in one view, apart from the agents' screens -- the agents (by stage) on the left, the
 * one picked on the right. Each change is saved in the database (the agent's rule store / its rules table) and is in
 * force for the next check.
 */
export function RulesConsole() {
  const agents = AGENTS.filter((a) => RULES_SOURCES[a.id]);
  const [picked, setPicked] = useState<string>(() => {
    try { const saved = localStorage.getItem(PICK_KEY); if (saved && RULES_SOURCES[saved]) return saved; } catch { /* storage blocked */ }
    return agents[0]?.id ?? "";
  });
  useEffect(() => { try { localStorage.setItem(PICK_KEY, picked); } catch { /* storage blocked */ } }, [picked]);
  const current = agents.find((a) => a.id === picked);

  return (
    <div className="cu-rules-console">
      <nav className="cu-rules-agents" aria-label={W.agentsTitle}>
        <div className="cu-rules-agents-head">{W.agentsTitle}</div>
        {GROUPS.map((group) => {
          const inGroup = agents.filter((a) => a.group === group);
          if (!inGroup.length) return null;
          return (
            <div key={group} className="cu-rules-agents-group">
              <div className="cu-rules-agents-label">{group}</div>
              {inGroup.map((a) => (
                <button key={a.id} type="button" className={`cu-rules-agent${a.id === picked ? " is-on" : ""}`}
                  aria-current={a.id === picked ? "page" : undefined} onClick={() => setPicked(a.id)}>
                  <span className="cu-rules-agent-icon" aria-hidden="true"><Icon name={a.icon} /></span>
                  <span>{a.label}</span>
                </button>
              ))}
            </div>
          );
        })}
      </nav>
      <div className="cu-rules-main">
        {current && (
          <div className="cu-rules-crumb">
            <span className="cu-rules-crumb-icon" aria-hidden="true"><Icon name={current.icon} /></span>
            <div>
              <b>{current.title}</b>
              <span>{W.savedInDb}</span>
            </div>
          </div>
        )}
        {current && <RulesSettings key={current.id} agent={current.id} />}
      </div>
    </div>
  );
}
