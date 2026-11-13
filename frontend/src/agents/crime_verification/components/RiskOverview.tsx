import { useState } from "react";
import type { Subject } from "../types/api";
import { tone } from "../utils/format";
import { t } from "../utils/text";
import { RiskGauge } from "./RiskGauge";

/** Gauges shown before "+N more" (owner 2026-11-12: "co-applicant aur aaye toh kaise handle karega") -- the riskiest
 *  come first, so whoever needs attention is always in view; the rest open on demand. */
export const GAUGES_SHOWN = 4;

/**
 * THE RISK INDICATOR UNDER THE AI SUMMARY (owner 2026-11-12: "crime me indicator wapas lana hai, AI summary ke niche"):
 * the gauge each person had on the screen before the agents were merged -- one card per person, the worst first,
 * level by colour, needle position AND word. A person without a result yet shows their status instead. Any number of
 * co-applicants: the first GAUGES_SHOWN are shown, the rest behind "+N more".
 */
export function RiskOverview({ people, labels, arcLabels, order, shownFirst = GAUGES_SHOWN }: {
  people: Subject[];
  labels: Record<string, string>;
  arcLabels?: Record<string, string>;
  /** risk levels, worst first (sorts the cards) */
  order: string[];
  shownFirst?: number;
}) {
  const [all, setAll] = useState(false);
  const rank = (s: Subject) => {
    const i = order.indexOf(s.result?.risk_level ?? "");
    return i < 0 ? order.length : i;
  };
  const list = [...people].sort((a, b) => rank(a) - rank(b));
  if (!list.length) return null;
  const shown = all ? list : list.slice(0, shownFirst);
  const hidden = list.length - shown.length;
  return (
    <section className={`risk-overview${list.length === 1 ? " is-one" : ""}`} aria-label={t("results.at_a_glance")}>
      <h3 className="risk-overview-title">{t("results.at_a_glance")}</h3>
      <ul>
        {shown.map((s) => {
          const r = s.result;
          const level = r?.risk_level ?? s.status;
          return (
            <li key={s.subject_id} className={`risk-ov-card tone-${tone(level)}`}>
              <div className="risk-ov-who">
                <span className="subject-role">{s.role_label}</span>
                <span className="subject-name">{s.full_name}</span>
              </div>
              {r ? (
                <>
                  <RiskGauge level={r.risk_level} label={labels[r.risk_level] ?? r.risk_label} labels={arcLabels ?? labels}
                             ariaLabel={t("result.overall_risk", { risk: labels[r.risk_level] ?? r.risk_label })} />
                  <p className="risk-ov-count">{t("results.cases_n", { n: r.total_cases })}</p>
                </>
              ) : (
                <p className={`risk-ov-status tone-${tone(level)}`}>{s.status_label}</p>
              )}
            </li>
          );
        })}
      </ul>
      {list.length > shownFirst && (
        <button type="button" className="risk-ov-more" aria-expanded={all} onClick={() => setAll((a) => !a)}>
          {all ? t("results.gauges_fewer") : t("results.gauges_more", { n: hidden })}
        </button>
      )}
    </section>
  );
}
