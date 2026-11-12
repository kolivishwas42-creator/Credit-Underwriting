import { useLayoutEffect } from "react";
import { AGENTS, GROUP_NOTES, GROUPS } from "../../config/agents";
import { Icon } from "./Icon";

/**
 * The landing view: the underwriting journey as a board — one column per stage (Application → Verification →
 * Property → Risk), its agents as cards. Fits one screen; clicking a card opens the agent.
 */
export function Home({ onOpen }: { onOpen: (id: string) => void }) {
  useLayoutEffect(() => { document.title = "Credit Underwriting"; }, []);
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
