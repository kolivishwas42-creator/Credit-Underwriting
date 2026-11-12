import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  COMPARE_PAIRS, COMPARE_WORDS, DECISION_WORDS, KEY_NUMBER_MAX_CHARS, KEY_NUMBERS_MAX, LINK_MIN_SHARE, LINK_MIN_WORDS,
  LINK_STOP_WORDS, MORE_PASSED, NEXT_STEP_STARTS, ROUTINE_DETAIL, STRENGTHS_SHOWN, UPPER_WORDS,
} from "../../../config/result";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { usePagination } from "../../hooks/usePagination";
import { Icon } from "../Icon";
import { Pagination } from "../Pagination";
import type {
  ActionItem, BasicCardProps, CalcProps, CalcRow, Kpi, ResultPageProps, RuleRow, RulesProps, SummaryProps, Tone,
} from "./types";

/* THE COMMON RESULT LAYOUT, v2 (owner 2026-11-11): one compact header, the AI summary with Strengths | Concerns,
   then Calculations (left) | Rules as a grid of cards (right, 6 per page). Section names are fixed here so every
   agent says the same thing; agent-specific numbers move into Calculations ("Key figures", "Case details"). */

const TONE_WORD: Record<Tone, string> = { pass: "Pass", review: "Review", fail: "Fail", info: "Info", na: "N/A" };
const TONE_ICON: Record<Tone, string> = { pass: "check", review: "clock", fail: "x", info: "dash", na: "dash" };
const ORDER: Record<Tone, number> = { fail: 0, review: 1, info: 2, pass: 3, na: 4 };
const FACTS_SHOWN = 4;          // facts in the header; the rest go to Calculations -> Case details
const RULES_PER_PAGE = 6;       // rule cards per page ("limit rules")
const SUMMARY_SHOWN = 3;        // summary points before "Show all"
const SIDE_SHOWN = 4;           // strengths / concerns before "+n more"

/** A status chip: word + icon, never colour alone. */
export function ToneChip({ tone, label }: { tone: Tone; label?: string }) {
  return (
    <span className={`cu-chip is-${tone}`}>
      <Icon name={TONE_ICON[tone]} />{label ?? TONE_WORD[tone]}
    </span>
  );
}

/** Rules / Passed / Review / Failed — the same four counters on every agent, counted from the rules. */
export function ruleCounts(rules: RuleRow[]): Kpi[] {
  const n = (t: Tone) => rules.filter((r) => r.outcome === t).length;
  return [
    { label: "Rules", value: rules.length, tone: "info" },
    { label: "Passed", value: n("pass"), tone: "pass" },
    { label: "Review", value: n("review"), tone: "review" },
    { label: "Failed", value: n("fail"), tone: "fail" },
  ];
}

/* ---------------------------------------------------------------- 1. compact header */
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The decision in the console's one vocabulary (Positive / Refer / Negative / Pending), the agent's word under it. */
export function Verdict({ decision }: { decision: { label: string; tone: Tone } }) {
  const word = DECISION_WORDS[decision.tone];
  if (same(word, decision.label)) {
    return <span className={`cu-r-verdict is-${decision.tone}`}><span className={`cu-r-verdict-word cu-r-decision is-${decision.tone}`}>{word}</span></span>;
  }
  return (
    <span className={`cu-r-verdict is-${decision.tone}`}>
      <span className="cu-r-verdict-word">{word}</span>
      <span className={`cu-r-decision is-${decision.tone}`}>{decision.label}</span>
    </span>
  );
}
export function BasicCard({ eyebrow, title, subtitle, facts, decision, icon = "grid", counts }: BasicCardProps & { counts?: Kpi[] }) {
  const shown = (facts ?? []).slice(0, FACTS_SHOWN);
  return (
    <div className="cu-r-basic" role="region" aria-label="Summary card">
      <div className="cu-r-basic-top">
        <span className="cu-r-emblem" aria-hidden="true"><Icon name={icon} /></span>
        <div className="cu-r-basic-head">
          <span className="cu-r-eyebrow">{eyebrow}</span>
          <div className="cu-r-title" role="heading" aria-level={2}>{title}</div>
          {subtitle && <div className="cu-r-subtitle">{subtitle}</div>}
        </div>
        {decision && <Verdict decision={decision} />}
      </div>
      {(shown.length > 0 || (counts && counts.length > 0)) && (
        <div className="cu-r-basic-foot">
          {shown.length > 0 && (
            <dl className="cu-r-facts">
              {shown.map((f) => (
                <div key={f.label} className="cu-r-fact">
                  <dt>{f.label}</dt><dd className={f.mono ? "is-mono" : undefined}>{f.value ?? "—"}</dd>
                </div>
              ))}
            </dl>
          )}
          {counts && counts.length > 0 && (
            <div className="cu-r-kpis" aria-label="Rule counts">
              {counts.map((k) => (
                <span key={k.label} className={`cu-r-kpi is-${k.tone ?? "na"}`}><b>{k.value}</b>{k.label}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- 2. AI summary v3 (owner 2026-11-11: "creative")
   A score ring (passed / review / failed of the rules), the first point as the HEADLINE, the rest as an insight grid,
   then Concerns as small cards (what to act on) beside Strengths as chips (what is fine). */
const RING_R = 30;
const RING_C = 2 * Math.PI * RING_R;

function ScoreRing({ rules }: { rules: RuleRow[] }) {
  const n = (t: Tone) => rules.filter((r) => r.outcome === t).length;
  const pass = n("pass"), review = n("review"), fail = n("fail");
  const total = rules.length || 1;
  const pct = Math.round((pass / total) * 100);
  const tone: Tone = fail ? "fail" : review ? "review" : "pass";
  let offset = 0;
  const arcs = ([["pass", pass], ["review", review], ["fail", fail]] as [Tone, number][]).filter(([, v]) => v > 0).map(([k, v]) => {
    const len = (v / total) * RING_C;
    const arc = <circle key={k} className={`cu-r-ring-arc is-${k}`} r={RING_R} cx="36" cy="36"
      strokeDasharray={`${Math.max(len - 2, 0.1)} ${RING_C}`} strokeDashoffset={-offset} />;
    offset += len;
    return arc;
  });
  return (
    <div className={`cu-r-ring is-${tone}`} role="img" aria-label={`${pass} of ${rules.length} rules passed`}>
      <svg viewBox="0 0 72 72" aria-hidden="true">
        <circle className="cu-r-ring-track" r={RING_R} cx="36" cy="36" />
        <g transform="rotate(-90 36 36)">{arcs}</g>
      </svg>
      <span className="cu-r-ring-mid"><b>{pct}%</b><small>passed</small></span>
      <span className="cu-r-ring-legend">
        <i className="is-pass">{pass} passed</i>
        {review > 0 && <i className="is-review">{review} review</i>}
        {fail > 0 && <i className="is-fail">{fail} failed</i>}
      </span>
    </div>
  );
}

/** "R05 ›" beside a point: opens the rule the point came from. */
function PointLink({ point, rules, onRule }: { point: string; rules: RuleRow[]; onRule?: (id: string) => void }) {
  const rule = onRule ? ruleOfPoint(point, rules) : undefined;
  if (!rule || !onRule) return null;
  return (
    <button type="button" className={`cu-r-link is-${rule.outcome}`} onClick={() => onRule(rule.id)}
      title={`Open rule ${rule.id}: ${rule.name}`} aria-label={`Open rule ${rule.id}: ${rule.name}`}>
      {rule.id}<Icon name="chevron" />
    </button>
  );
}

function Concerns({ items, onRule }: { items: RuleRow[]; onRule?: (id: string) => void }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, SIDE_SHOWN);
  return (
    <div className="cu-r-side is-fail" role="group" aria-label="Concerns">
      <div className="cu-r-side-title"><Icon name="alert" />Concerns<span>{items.length}</span></div>
      {items.length === 0
        ? <div className="cu-r-side-empty"><Icon name="check" />Nothing to worry about.</div>
        : (
          <ul className="cu-r-concerns">
            {shown.map((r) => (
              <li key={r.id} className={`is-${r.outcome}`}>
                <button type="button" className="cu-r-side-btn" disabled={!onRule} onClick={() => onRule?.(r.id)}>
                  <b>{r.name}{r.outcome === "review" && <em>review</em>}</b>
                  {/* PROOF, like Strengths (owner 2026-11-12): the values compared, then the reason; a reason the
                      agent drew itself (not plain text) is kept as it is */}
                  {(() => {
                    const { proof, why } = concernProof(r);
                    return (<>
                      {proof && <span className="cu-r-proof">{proof}</span>}
                      {why ? <span>{why}</span> : (!proof && r.detail ? <span>{r.detail}</span> : null)}
                    </>);
                  })()}
                </button>
              </li>
            ))}
          </ul>
        )}
      {items.length > SIDE_SHOWN && (
        <button type="button" className="cu-r-more" onClick={() => setAll((a) => !a)} aria-expanded={all}>
          {all ? "Show fewer" : `+${items.length - SIDE_SHOWN} more`}
        </button>
      )}
    </div>
  );
}

const ROUTINE = new Set(ROUTINE_DETAIL);
const flat = (v: ReactNode) => (typeof v === "string" || typeof v === "number" ? String(v).trim() : "");

/** The proof of a passed rule, in one line: the two values it compared ("Actual 42% · Policy limit 60%"), else its
 *  reason line when that says more than "passed", else the first value with a number in it. "" = no proof. */
export function strengthProof(r: RuleRow): string {
  const pair = comparePair(r.values);
  if (pair && flat(pair[0].value) && flat(pair[1].value)) {
    return pair.map((v) => `${COMPARE_WORDS[v.label] ?? v.label} ${flat(v.value)}`).join(" · ");
  }
  const detail = flat(r.detail);
  const key = detail.toLowerCase().replace(/[.!]+$/, "");
  if (detail && !ROUTINE.has(key) && key !== r.name.trim().toLowerCase()) return detail;
  const fact = (r.values || []).find((v) => /\d/.test(flat(v.value)));
  return fact ? `${fact.label}: ${flat(fact.value)}` : "";
}

/** The proof of a concern: the values compared ("Actual 72% · Policy limit 60%", else the first value with a number)
 *  and, under it, the reason when it says more than the rule name. */
export function concernProof(r: RuleRow): { proof: string; why: string } {
  const pair = comparePair(r.values);
  let proof = pair && flat(pair[0].value) && flat(pair[1].value)
    ? pair.map((v) => `${COMPARE_WORDS[v.label] ?? v.label} ${flat(v.value)}`).join(" · ") : "";
  if (!proof) {
    const fact = (r.values || []).find((v) => /\d/.test(flat(v.value)));
    proof = fact ? `${fact.label}: ${flat(fact.value)}` : "";
  }
  const detail = flat(r.detail);
  const key = detail.toLowerCase().replace(/[.!]+$/, "");
  const why = detail && !ROUTINE.has(key) && key !== r.name.trim().toLowerCase() ? detail : "";
  return { proof, why };
}

/** Strengths worth reading: passes with proof, the ones with numbers first; the rest only counted. */
export function usefulStrengths(passed: RuleRow[]): { listed: { rule: RuleRow; proof: string }[]; rest: RuleRow[] } {
  const withProof = passed.map((rule) => ({ rule, proof: strengthProof(rule) })).filter((s) => s.proof);
  withProof.sort((a, b) => Number(/\d/.test(b.proof)) - Number(/\d/.test(a.proof)));      // stable: rule order kept
  const listed = withProof.slice(0, STRENGTHS_SHOWN);
  const ids = new Set(listed.map((s) => s.rule.id));
  return { listed, rest: passed.filter((r) => !ids.has(r.id)) };
}

function Strengths({ items, onRule }: { items: RuleRow[]; onRule?: (id: string) => void }) {
  const [all, setAll] = useState(false);
  const { listed, rest } = useMemo(() => usefulStrengths(items), [items]);
  return (
    <div className="cu-r-side is-pass" role="group" aria-label="Strengths">
      <div className="cu-r-side-title"><Icon name="check" />Strengths<span>{items.length}</span></div>
      {items.length === 0 && <div className="cu-r-side-empty">Nothing passed yet.</div>}
      {listed.length > 0 && (
        <ul className="cu-r-concerns cu-r-strengths">
          {listed.map(({ rule, proof }) => (
            <li key={rule.id} className="is-pass">
              <button type="button" className="cu-r-side-btn" disabled={!onRule} onClick={() => onRule?.(rule.id)}>
                <b>{rule.name}</b>
                <span>{proof}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {rest.length > 0 && (listed.length === 0 || all) && (
        <ul className="cu-r-chips">{rest.map((r) => (
          <li key={r.id}><button type="button" className="cu-r-chip-btn" disabled={!onRule} onClick={() => onRule?.(r.id)}
            title={r.name}><Icon name="check" />{r.name}</button></li>))}</ul>
      )}
      {rest.length > 0 && listed.length > 0 && (
        <button type="button" className="cu-r-more" onClick={() => setAll((a) => !a)} aria-expanded={all}>
          {all ? "Show fewer" : MORE_PASSED(rest.length)}
        </button>
      )}
    </div>
  );
}

const STOP = new Set(LINK_STOP_WORDS);
const words = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]+/g, " ").split(" ").filter((w) => w.length >= 3 && !STOP.has(w));

/** The rule an AI point talks about: its id named in the point, else most of the rule name's words in the point. */
export function ruleOfPoint(point: string, rules: RuleRow[]): RuleRow | undefined {
  const text = ` ${point.toLowerCase()} `;
  // the rule's WHOLE name in the point, the longest first (owner 2026-11-12 UI pass: "Co-Applicant 1 has low risk"
  // linked to "Applicant" -- short words are dropped below, so both names looked like "applicant")
  const whole = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
  const said = whole(point);
  const byName = [...rules].filter((r) => r.name.trim().length >= 3).sort((a, b) => b.name.length - a.name.length)
    .find((r) => said.includes(whole(r.name)));
  if (byName) return byName;
  // its id named in the point -- after the whole names, and never inside a hyphenated word: an id like "APPLICANT"
  // is also inside "co-applicant"
  const byId = rules.find((r) => r.id.length >= 2 && new RegExp(`[^a-z0-9-]${r.id.toLowerCase().replace(/[^a-z0-9]/g, "\\$&")}[^a-z0-9-]`).test(text));
  if (byId) return byId;
  const have = new Set(words(point));
  let best: { rule: RuleRow; score: number; hits: number } | undefined;
  for (const rule of rules) {
    const need = [...new Set(words(rule.name))];
    if (!need.length) continue;
    const hits = need.filter((w) => have.has(w)).length;
    const score = hits / need.length;
    if (hits < Math.min(LINK_MIN_WORDS, need.length) || score < LINK_MIN_SHARE) continue;
    const better = !best || score > best.score || (score === best.score && ORDER[rule.outcome] < ORDER[best.rule.outcome]);
    if (better) best = { rule, score, hits };
  }
  return best?.rule;
}

const UPPER = new Set(UPPER_WORDS);
const word = (w: string) => (UPPER.has(w.toLowerCase()) ? w.toUpperCase() : w);
/** "acknowledgement_number" -> "acknowledgement number", "pan" -> "PAN": no field names in a sentence */
export function plainWords(text: string): string {
  return text
    .replace(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g, (m) => m.split("_").map(word).join(" "))
    .replace(/\b[a-z]{2,6}\b/g, (m) => (UPPER.has(m) ? m.toUpperCase() : m));
}
const isNext = (p: string) => NEXT_STEP_STARTS.some((w) => p.trim().toLowerCase().startsWith(w));
const nextText = (p: string) => p.trim().replace(/^(next step|next action|recommended action|action)\s*[:\-–—]\s*/i, "");

/** The numbers worth seeing first: the ones that passed / failed a check, then the first short ones. */
export function keyNumbers(calcs: CalcRow[]): CalcRow[] {
  const short = calcs.filter((c) => c.value !== null && c.value !== undefined && typeof c.value !== "object"
    && String(c.value).trim() !== "" && String(c.value).trim() !== "—" && String(c.value).length <= KEY_NUMBER_MAX_CHARS
    && c.group !== "Case details");
  const zero = (c: CalcRow) => /^\s*0+(\.0+)?\s*$/.test(String(c.value));
  // a key NUMBER: has a digit, is not a bare 0, and each label once (per-person repeats are left to Calculations)
  const seen = new Set<string>();
  const useful = short.filter((c) => {
    const key = c.label.trim().toLowerCase();
    if (zero(c) || !/\d/.test(String(c.value)) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const money = useful.filter((c) => /[₹%]/.test(String(c.value)));
  const toned = useful.filter((c) => !money.includes(c) && (c.tone === "pass" || c.tone === "fail" || c.tone === "review"));
  const rest = useful.filter((c) => !money.includes(c) && !toned.includes(c));
  // the same number under a near-same label ("Match score" / "Overall match score") shows once
  const out: CalcRow[] = [];
  for (const c of [...money, ...toned, ...rest]) {
    const l = c.label.toLowerCase();
    const twin = out.some((o) => String(o.value) === String(c.value)
      && (o.label.toLowerCase().includes(l) || l.includes(o.label.toLowerCase())));
    if (!twin) out.push(c);
  }
  return out.slice(0, KEY_NUMBERS_MAX);
}

export function AiSummary({ points, source, loading, empty = "No summary yet.", rules = [], onRule, numbers = [], glance = [],
  glanceTitle = "At a glance" }:
  SummaryProps & { rules?: RuleRow[]; onRule?: (id: string) => void; numbers?: CalcRow[] }) {
  const [all, setAll] = useState(false);
  // our own numbers lead each point: drop a "1." / "2)" the writer put in the text
  const cleanAll = points.map((p) => plainWords(p).replace(/^\s*\d{1,2}[.)]\s+/, ""));
  // the next step is its own line under the points (the last such point)
  const nextAt = cleanAll.map(isNext).lastIndexOf(true);
  const next = nextAt >= 0 ? nextText(cleanAll[nextAt]) : null;
  const clean = nextAt >= 0 ? cleanAll.filter((_, i) => i !== nextAt) : cleanAll;
  const shown = all ? clean : clean.slice(0, SUMMARY_SHOWN);
  const concerns = rules.filter((r) => r.outcome === "fail" || r.outcome === "review").sort((a, b) => ORDER[a.outcome] - ORDER[b.outcome]);
  const strengths = rules.filter((r) => r.outcome === "pass");
  return (
    <div className="cu-r-card cu-r-summary" role="region" aria-label="AI summary" data-source={source || undefined}>
      <div className="cu-r-card-head">
        <span className="cu-r-card-icon is-ai is-live" aria-hidden="true"><Icon name="sparkle" /></span>
        <div className="cu-r-card-title" role="heading" aria-level={3}>AI summary</div>
      </div>
      <div className={`cu-r-brief${rules.length ? "" : " no-ring"}`}>
        {rules.length > 0 && <ScoreRing rules={rules} />}
        <div className="cu-r-summary-main">
          {loading
            ? <div className="cu-r-skel" aria-label="Writing the summary"><i /><i /><i /></div>
            : clean.length || next
              ? (
                <>
                  <ol className="cu-r-points">
                    {shown.map((p, i) => (
                      <li key={i} className={i === 0 ? "is-lead" : undefined}>
                        <span aria-hidden="true">{i + 1}</span><p>{p}</p>
                        <PointLink point={p} rules={rules} onRule={onRule} />
                      </li>
                    ))}
                  </ol>
                  {clean.length > SUMMARY_SHOWN && (
                    <button type="button" className="cu-r-more" aria-expanded={all} onClick={() => setAll((a) => !a)}>
                      {all ? "Show fewer" : `Show all (${clean.length})`}
                    </button>
                  )}
                  {next && (
                    <div className="cu-r-next" role="note" aria-label="Next step">
                      <span className="cu-r-next-icon" aria-hidden="true"><Icon name="arrow" /></span>
                      <span><b>Next step</b>{next}</span>
                    </div>
                  )}
                </>
              )
              : <div className="cu-r-empty">{empty}</div>}
        </div>
      </div>
      {/* AT A GLANCE (owner 2026-11-12): every person and their level, right under the summary -- colour AND word */}
      {glance.length > 0 && (
        <div className="cu-r-glance" role="group" aria-label={glanceTitle}>
          <span className="cu-r-glance-title">{glanceTitle}</span>
          <ul>
            {glance.map((g) => (
              <li key={g.id} className={`cu-r-glance-chip is-${g.tone}`}>
                <i aria-hidden="true" />
                <span className="cu-r-glance-who">{g.who}</span>
                <span className="cu-r-glance-name">{g.name}</span>
                <b>{g.level}</b>
              </li>
            ))}
          </ul>
        </div>
      )}
      {numbers.length > 0 && (
        <dl className="cu-r-keynums" aria-label="Key numbers">
          {numbers.map((n, i) => (
            <div key={`${n.label}-${i}`} className={`cu-r-keynum${n.tone ? ` is-${n.tone}` : ""}`}>
              <dt>{n.label}</dt><dd>{n.value}</dd>{n.hint && <small>{n.hint}</small>}
            </div>
          ))}
        </dl>
      )}
      {rules.length > 0 && (
        <div className="cu-r-proscons">
          <Concerns items={concerns} onRule={onRule} />
          <Strengths items={strengths} onRule={onRule} />
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- 3a. rules: a grid of cards, 6 per page */
const FILTERS: (Tone | "all")[] = ["all", "fail", "review", "pass"];

const filled = (v: unknown) => v !== null && v !== undefined && String(v).trim() !== "" && String(v).trim() !== "—";
/** 60000 -> 60,000 (Indian grouping); anything that is not a bare number stays as it is */
const grouped = (v: unknown) => (typeof v === "number" || /^\s*\d{4,}(\.\d+)?\s*$/.test(String(v))
  ? Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 }) : v);

/** The pair of values a rule compares (Value | Limit, Application | Vendor report …), if it has one. */
export function comparePair(values: RuleRow["values"]): [NonNullable<RuleRow["values"]>[number], NonNullable<RuleRow["values"]>[number]] | null {
  if (!values?.length) return null;
  for (const [l, r] of COMPARE_PAIRS) {
    const a = values.find((v) => same(v.label, l));
    const b = values.find((v) => same(v.label, r));
    if (a && b && (filled(a.value) || filled(b.value))) return [a, b];
  }
  return null;
}

/** the detail line says only what the pair shows ("60000 · limit 25000") */
const repeatsPair = (detail: ReactNode, pair: [{ value: ReactNode }, { value: ReactNode }]) => {
  if (typeof detail !== "string") return false;
  const d = detail.toLowerCase();
  return pair.every((p) => !filled(p.value) || d.includes(String(p.value).toLowerCase())) && detail.length <= 80;
};

function RuleCard({ rule, focused }: { rule: RuleRow; focused?: boolean }) {
  const [open, setOpen] = useState(false);
  const pair = comparePair(rule.values);
  const rest = (rule.values ?? []).filter((v) => !pair || (v !== pair[0] && v !== pair[1]));
  const table = rule.table?.rows.length ? rule.table : undefined;
  const more = rest.some((v) => filled(v.value)) || Boolean(table);
  return (
    <div className={`cu-r-rule is-${rule.outcome}${open ? " is-open" : ""}${focused ? " is-focus" : ""}`} data-rule-id={rule.id}>
      <button type="button" className="cu-r-rule-row" onClick={() => more && setOpen((o) => !o)}
        aria-expanded={more ? open : undefined} disabled={!more}>
        <span className="cu-r-rule-top">
          <span className="cu-r-rule-meta">
            <span className="cu-r-rule-id" title={rule.id}>{rule.id}</span>
            {rule.severity && <span className="cu-r-sev">{rule.severity}</span>}
          </span>
          <ToneChip tone={rule.outcome} label={rule.outcomeLabel} />
        </span>
        <span className="cu-r-rule-text">
          <b>{rule.name}</b>
          {rule.detail && !(pair && repeatsPair(rule.detail, pair)) && <span>{rule.detail}</span>}
        </span>
        {pair && (
          <span className="cu-r-compare">
            {pair.map((v, i) => (
              <span key={v.label} className={`cu-r-compare-cell${i === 0 ? ` is-${rule.outcome}` : ""}`}>
                <small>{COMPARE_WORDS[v.label] ?? v.label}</small>
                <b className={v.mono ? "is-mono" : undefined} title={typeof v.value === "string" ? v.value : undefined}>
                  {filled(v.value) ? (grouped(v.value) as ReactNode) : "—"}</b>
              </span>
            ))}
          </span>
        )}
        {more && <span className="cu-r-caret">{open ? "Hide values" : "Show values"}<Icon name="chevron" /></span>}
      </button>
      {open && table && (
        <table className="cu-r-rule-table">
          <thead><tr>{table.columns.map((c, i) => <th key={i} scope="col">{c}</th>)}</tr></thead>
          <tbody>{table.rows.map((row, ri) => (
            <tr key={ri}>{row.map((cell, ci) => (ci === 0 ? <th key={ci} scope="row">{cell}</th> : <td key={ci}>{cell}</td>))}</tr>
          ))}</tbody>
        </table>
      )}
      {open && more && (
        <dl className="cu-r-rule-values">
          {rest.map((v) => (
            <Fragment key={v.label}><dt>{v.label}</dt><dd className={v.mono ? "is-mono" : undefined}>{v.value ?? "—"}</dd></Fragment>
          ))}
        </dl>
      )}
    </div>
  );
}

export function RulesPanel({ rules, pageSize = RULES_PER_PAGE, empty = "No rules were run.", focus }:
  RulesProps & { focus?: { id: string; at: number } | null }) {
  const [filter, setFilter] = useState<Tone | "all">("all");
  const sorted = useMemo(() => [...rules].sort((a, b) => ORDER[a.outcome] - ORDER[b.outcome]), [rules]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rules.length };
    for (const r of rules) c[r.outcome] = (c[r.outcome] ?? 0) + 1;
    return c;
  }, [rules]);
  const shown = useMemo(() => (filter === "all" ? sorted : sorted.filter((r) => r.outcome === filter)), [sorted, filter]);
  const pager = usePagination(shown, Math.min(pageSize, RULES_PER_PAGE));
  const panel = useRef<HTMLDivElement>(null);
  const [lit, setLit] = useState<string | null>(null);
  // a summary point / strength / concern asked for a rule: all rules, its page, scrolled to and lit for a moment
  useEffect(() => { if (focus) setFilter("all"); }, [focus]);
  useEffect(() => {
    if (!focus || filter !== "all") return;
    const at = sorted.findIndex((r) => r.id === focus.id);
    if (at < 0) return;
    pager.setPage(Math.floor(at / pager.pageSize) + 1);
    setLit(focus.id);
    const scroll = window.setTimeout(() => panel.current?.querySelector(`[data-rule-id="${CSS.escape(focus.id)}"]`)
      ?.scrollIntoView?.({ behavior: "smooth", block: "center" }), 60);
    const off = window.setTimeout(() => setLit(null), 2200);
    return () => { window.clearTimeout(scroll); window.clearTimeout(off); };
  }, [focus, filter]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="cu-r-card cu-r-rules" role="region" aria-label="Rules" ref={panel}>
      <div className="cu-r-card-head">
        <span className="cu-r-card-icon" aria-hidden="true"><Icon name="list" /></span>
        <div className="cu-r-card-title" role="heading" aria-level={3}>Rules</div>
        {rules.length > 0 && (
          <div className="cu-r-filters" role="group" aria-label="Show rules">
            {FILTERS.filter((f) => f === "all" || counts[f]).map((f) => (
              <button key={f} type="button" className={`cu-r-filter${filter === f ? " is-on" : ""} is-${f}`}
                aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {f === "all" ? "All" : TONE_WORD[f]}<span>{counts[f] ?? 0}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {pager.rows.length
        ? <div className="cu-r-rule-grid">{pager.rows.map((r) => <RuleCard key={r.id} rule={r} focused={lit === r.id} />)}</div>
        : <div className="cu-r-empty">{empty}</div>}
      <Pagination pager={pager} noun="rules" fixedSize />
    </div>
  );
}

/* ---------------------------------------------------------------- 3b. calculations v3 (owner 2026-11-11)
   Simple and clean: "Key figures" as bold tiles, every other group as label · BOLD value rows, a coloured dot for a
   pass / review / fail value. Still 10 per page. */
function CalcRowView({ r }: { r: CalcRow }) {
  return (
    <div className={`cu-r-calc${r.tone ? ` is-${r.tone}` : ""}`}>
      <dt>{r.tone && r.tone !== "na" && r.tone !== "info" && <i className="cu-r-dot" aria-hidden="true" />}{r.label}{r.hint && <span>{r.hint}</span>}</dt>
      <dd className={r.mono ? "is-mono" : undefined}>{r.value ?? "—"}</dd>
    </div>
  );
}

type CalcGroup = { name?: string; rows: CalcRow[] };
const groupRows = (rows: CalcRow[]): CalcGroup[] => {
  const groups: CalcGroup[] = [];
  for (const r of rows) {
    const last = groups.at(-1);
    if (last && last.name === r.group) last.rows.push(r);
    else groups.push({ name: r.group, rows: [r] });
  }
  return groups;
};

/** what the full list measured as, per group: enough to price any run of rows without drawing it */
interface Measured { from: number; n: number; head: number; extra: number; tiles: boolean; rowH: number[]; pitch: number; cols: number }

/** the height of rows [a, b) drawn as a page */
function heightOf(m: Measured[], gap: number, a: number, b: number): number {
  let h = 0, blocks = 0;
  for (const g of m) {
    const lo = Math.max(a, g.from), hi = Math.min(b, g.from + g.n);
    if (hi <= lo) continue;
    const n = hi - lo;
    const body = g.tiles
      ? Math.ceil(n / g.cols) * g.pitch - (g.pitch - g.rowH[0])
      : g.rowH.slice(lo - g.from, hi - g.from).reduce((x, y) => x + y, 0);
    h += g.head + body + g.extra;
    blocks += 1;
  }
  return h + Math.max(0, blocks - 1) * gap;
}

/** the first row of each page: as many rows as fit `avail` px, at least one a page */
function pageStarts(m: Measured[], gap: number, total: number, avail: number): number[] {
  const starts: number[] = [];
  let a = 0;
  while (a < total) {
    starts.push(a);
    let b = a + 1;
    while (b < total && heightOf(m, gap, a, b + 1) <= avail) b += 1;
    a = b;
  }
  return starts;
}

const PAGER_ROOM = 52;       // px the pager takes under the rows (its height and its margin)
const WIDE = "(min-width: 1100px)";

/**
 * Calculations. Beside the rules (`fit`) the card is as tall as the rules list and nothing more: the rows that fit
 * the height are shown and the rest page; without that (stacked on a small screen, or alone) it is 10 rows a page.
 */
export function CalcPanel({ rows, pageSize = 10, empty = "Nothing calculated yet.", fit = false }: CalcProps) {
  const fixed = usePagination(rows, pageSize);
  const room = useRef<HTMLDivElement>(null);
  const [starts, setStarts] = useState<number[] | null>(null);
  const [at, setAt] = useState(0);

  useLayoutEffect(() => {
    const el = room.current;
    if (!fit || !el || typeof window === "undefined" || !window.matchMedia?.(WIDE).matches) { setStarts(null); return undefined; }
    // the full list is drawn once, off-screen and for a moment, only to read each row's height
    const measure = () => {
      const avail = el.clientHeight;
      if (!avail || !rows.length) { setStarts(null); return; }
      const tmp = document.createElement("div");
      tmp.className = "cu-r-calc-probe";
      tmp.setAttribute("aria-hidden", "true");
      el.appendChild(tmp);
      const root = createRoot(tmp);
      flushSync(() => root.render(<div className="cu-r-calc-body">{view(groupRows(rows))}</div>));
      const body = tmp.firstElementChild as HTMLElement;
      const gap = parseFloat(getComputedStyle(body).rowGap) || 0;
      const m: Measured[] = [];
      let from = 0;
      for (const block of Array.from(body.children) as HTMLElement[]) {
        const list = block.lastElementChild as HTMLElement;
        const items = Array.from(list.children) as HTMLElement[];
        const tiles = list.classList.contains("cu-r-tiles");
        const head = list.getBoundingClientRect().top - block.getBoundingClientRect().top;
        const rowH = items.map((i) => i.getBoundingClientRect().height);
        const lead = items[0]?.getBoundingClientRect();
        const cols = Math.max(1, items.filter((i) => lead && Math.abs(i.getBoundingClientRect().top - lead.top) < 1).length);
        const pitch = items[cols] && lead ? items[cols].getBoundingClientRect().top - lead.top : (rowH[0] ?? 0);
        const rowsH = tiles ? Math.ceil(items.length / cols) * pitch - (pitch - (rowH[0] ?? 0)) : rowH.reduce((x, y) => x + y, 0);
        m.push({ from, n: items.length, head, extra: Math.max(0, list.getBoundingClientRect().height - rowsH), tiles, rowH, pitch, cols });
        from += items.length;
      }
      root.unmount();
      tmp.remove();
      let s = pageStarts(m, gap, rows.length, avail);
      if (s.length > 1) s = pageStarts(m, gap, rows.length, avail - PAGER_ROOM);
      setStarts((old) => (old && old.length === s.length && old.every((v, i) => v === s[i]) ? old : s));
    };
    const first = window.requestAnimationFrame(measure);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    window.addEventListener("resize", measure);
    return () => { window.cancelAnimationFrame(first); ro?.disconnect(); window.removeEventListener("resize", measure); };
  }, [fit, rows]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setAt(0); }, [rows]);

  const paged = starts !== null;
  const page = paged ? Math.min(at, starts.length - 1) : 0;
  const lo = paged ? starts[page] : 0;
  const hi = paged ? (starts[page + 1] ?? rows.length) : 0;
  const shown = paged ? rows.slice(lo, hi) : fixed.rows;
  const pager = paged
    ? {
      rows: shown, page: page + 1, pageSize: starts.length > 1 ? hi - lo : rows.length, pageCount: starts.length, total: rows.length,
      from: lo + 1, to: hi, setPage: (p: number) => setAt(Math.min(Math.max(1, p), starts.length) - 1), setPageSize: () => undefined,
    }
    : fixed;

  const view = (gs: CalcGroup[]) => gs.map((g, gi) => (
    <div key={`${g.name ?? ""}-${gi}`} className="cu-r-calc-block">
      {g.name && <div className="cu-r-calc-group">{g.name}</div>}
      {g.name === "Key figures"
        ? (
          <dl className="cu-r-tiles">
            {g.rows.map((r, i) => (
              <div key={`${r.label}-${i}`} className={`cu-r-tile${r.tone ? ` is-${r.tone}` : ""}`}>
                <dd>{r.value ?? "—"}</dd><dt>{r.label}</dt>
              </div>
            ))}
          </dl>
        )
        : <dl className="cu-r-calc-list">{g.rows.map((r, i) => <CalcRowView key={`${r.label}-${i}`} r={r} />)}</dl>}
    </div>
  ));

  return (
    <div className={`cu-r-card cu-r-calcs${fit ? " is-fit" : ""}`} role="region" aria-label="Calculations">
      <div className="cu-r-card-head">
        <span className="cu-r-card-icon" aria-hidden="true"><Icon name="calc" /></span>
        <div className="cu-r-card-title" role="heading" aria-level={3}>Calculations</div>
        {rows.length > 0 && <span className="cu-r-count-pill">{rows.length}</span>}
      </div>
      <div className="cu-r-calc-room" ref={room}>
        {shown.length
          ? <div className="cu-r-calc-body">{view(groupRows(shown))}</div>
          : <div className="cu-r-empty">{empty}</div>}
        <Pagination pager={pager} noun="values" fixedSize />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- 4. actions */
export function ActionBar({ actions }: { actions: ActionItem[] }) {
  const [note, setNote] = useState<string | null>(null);
  if (!actions.length) return null;
  const press = (a: ActionItem) => {
    if (a.onClick) { a.onClick(); return; }
    setNote(`“${a.label}” is not connected yet.`);
    window.setTimeout(() => setNote(null), 2600);
  };
  return (
    <div className="cu-r-actions" role="toolbar" aria-label="Actions">
      <span className="cu-r-note" role="status" aria-live="polite">{note}</span>
      <div className="cu-r-buttons">
        {actions.map((a) => (
          <button key={a.id} type="button" className={`cu-r-btn is-${a.kind ?? "secondary"}`} disabled={a.disabled}
            onClick={() => press(a)}>
            {a.icon && <Icon name={a.icon} />}{a.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** What the header cannot show moves to Calculations: the agent's own counters ("Key figures") and the facts past the
 *  first four ("Case details"). Nothing the agent returns is lost; the header stays one compact band. */
/** a plain rule COUNT ("Checks run 7", "Passed 3", "Needs review 2", "Problems 2" …) — already in the header */
const COUNT_LABEL = /^(rules?|checks?|fields?)( (run|applicable|checked|evaluated))?$|^(passed|failed|review|needs review|problems?|mismatch(es)?|triggered|clear|matched|mismatches)$/i;
const isCount = (label: string, value: unknown) =>
  COUNT_LABEL.test(label.trim()) && /^\s*\d+\s*$/.test(String(value ?? ""));

function withOverflow(calcs: CalcRow[], basic: BasicCardProps, countsInHeader: boolean): CalcRow[] {
  const extraFacts = (basic.facts ?? []).slice(FACTS_SHOWN)
    .map((f) => ({ group: "Case details", label: f.label, value: f.value, mono: f.mono }));
  const key = (countsInHeader ? basic.kpis ?? [] : []).map((k) => ({ group: "Key figures", label: k.label, value: k.value, tone: k.tone }));
  if (!countsInHeader) return [...key, ...calcs, ...extraFacts];
  // the header already shows Rules / Passed / Review / Failed: drop the agent's own copies of those counts
  return [...key, ...calcs, ...extraFacts].filter((r) => !isCount(r.label, r.value));
}

/**
 * THE COMMON RESULT LAYOUT of every agent (v5, owner 2026-11-11):
 *   1. compact header (title, decision, 4 facts, Rules / Passed / Review / Failed)
 *   2. a rail of sections, one shown at a time: Overview (AI summary, Strengths | Concerns, a card per section) ·
 *      Rules (cards, 6 per page) · Calculations · More details (the agent's own sections)
 *   3. actions.
 * Long lists page instead of scrolling.
 */
/** true when there is something to show (not null / false / an empty fragment list) */
function hasChildren(node: ReactNode): boolean {
  if (node === null || node === undefined || node === false || node === "") return false;
  if (Array.isArray(node)) return node.some(hasChildren);
  return true;
}

/* ---------------------------------------------------------------- 5. sections as tabs (owner 2026-11-11)
   "sab ek me naa dikhe": under the header ONE section at a time -- Overview (the AI summary) · Rules · Calculations ·
   More details -- on a pill rail with counts and a red mark for what failed. Every pane stays mounted (only put away),
   so a filter or an opened rule survives a switch. */
type Section = "overview" | "rules" | "calcs" | "details";
interface Tab { id: Section; label: string; icon: string; count?: number; alert?: number }

function SectionRail({ tabs, active, onPick, stuck, basic, onTop }: {
  tabs: Tab[]; active: Section; onPick: (s: Section) => void; stuck?: boolean; basic?: BasicCardProps; onTop?: () => void;
}) {
  const move = (e: KeyboardEvent, i: number) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = tabs[(i + step + tabs.length) % tabs.length];
    onPick(next.id);
    document.getElementById(`cu-r-tab-${next.id}`)?.focus();
  };
  return (
    <div className={`cu-r-rail${stuck ? " is-stuck" : ""}`} role="tablist" aria-label="Result sections">
      {stuck && basic && (
        <button type="button" className="cu-r-rail-case" onClick={onTop} tabIndex={-1} aria-hidden="true" title="Back to the top">
          <span className="cu-r-rail-name">{basic.title}</span>
          {basic.decision && <span className={`cu-r-rail-verdict is-${basic.decision.tone}`}>{DECISION_WORDS[basic.decision.tone]}</span>}
        </button>
      )}
      {tabs.map((t, i) => (
        <button key={t.id} type="button" role="tab" id={`cu-r-tab-${t.id}`} aria-controls={`cu-r-pane-${t.id}`}
          aria-selected={active === t.id} tabIndex={active === t.id ? 0 : -1}
          aria-label={`${t.label}${t.count !== undefined ? `, ${t.count}` : ""}${t.alert ? `, ${t.alert} failed` : ""}`}
          className={`cu-r-tab${active === t.id ? " is-on" : ""}`} onClick={() => onPick(t.id)} onKeyDown={(e) => move(e, i)}>
          <Icon name={t.icon} /><span>{t.label}</span>
          {t.count !== undefined && <b className="cu-r-tab-count">{t.count}</b>}
          {Boolean(t.alert) && <i className="cu-r-tab-alert" title={`${t.alert} need attention`}>{t.alert}</i>}
        </button>
      ))}
    </div>
  );
}

export function ResultPage({ basic, summary, rules, calculations, actions, children, detailsOpen, overview }: ResultPageProps) {
  const ruleRows = rules?.rules ?? [];
  const calcRows = withOverflow(calculations?.rows ?? [], basic, ruleRows.length > 0);
  const hasCalcs = calcRows.length > 0;
  const extra = hasChildren(children);
  const counts = ruleRows.length ? ruleCounts(ruleRows) : basic.kpis;
  const failed = ruleRows.filter((r) => r.outcome === "fail").length;

  const tabs: Tab[] = [];
  if (summary) tabs.push({ id: "overview", label: "Overview", icon: "sparkle" });
  // ONE tab for both: Calculations (left) | Rules (right)
  if (rules || hasCalcs) {
    tabs.push({ id: "rules", label: rules && hasCalcs ? "Rules & Calculations" : rules ? "Rules" : "Calculations",
      icon: "list", count: rules ? ruleRows.length : calcRows.length, alert: failed });
  }
  if (extra && !detailsOpen) tabs.push({ id: "details", label: "More details", icon: "grid" });
  const [picked, setPicked] = useState<Section | null>(null);
  const active: Section = picked && tabs.some((t) => t.id === picked) ? picked : (tabs[0]?.id ?? "overview");
  const tabbed = tabs.length > 1;
  const pane = (id: Section) => `cu-r-pane is-${id}${tabbed && active !== id ? " is-away" : ""}`;
  const paneProps = (id: Section) => (tabbed
    ? { role: "tabpanel", id: `cu-r-pane-${id}`, "aria-labelledby": `cu-r-tab-${id}` } : {});

  const [focus, setFocus] = useState<{ id: string; at: number } | null>(null);
  const onRule = rules ? (id: string) => { setPicked("rules"); setFocus({ id, at: Date.now() }); } : undefined;
  // the strip shows once the header is out of view (no IntersectionObserver, e.g. in tests: never)
  const head = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const el = head.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting && e.boundingClientRect.top < 0));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  // a form above the result (run on the same page): bring the result into view once, when it first shows
  useEffect(() => {
    const el = head.current;
    if (!el || typeof window === "undefined" || !el.scrollIntoView) return;
    const top = el.getBoundingClientRect().top;
    if (top > window.innerHeight * 0.55) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);
  const pick = (s: Section) => {
    setPicked(s);
    // a switch from far down: back to the rail, so the new section starts in view
    const rail = head.current?.nextElementSibling as HTMLElement | null;
    if (rail && rail.getBoundingClientRect().top < 0) rail.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };
  return (
    <div className={`cu-ui cu-r${tabbed ? " is-tabbed" : ""}`}>
      <div ref={head}><BasicCard {...basic} counts={counts} /></div>
      {tabbed && <SectionRail tabs={tabs} active={active} onPick={pick} stuck={stuck} basic={basic}
        onTop={() => head.current?.scrollIntoView({ behavior: "smooth", block: "start" })} />}
      {summary && (
        <div className={pane("overview")} {...paneProps("overview")}>
          <AiSummary {...summary} rules={ruleRows} onRule={onRule} numbers={keyNumbers(calcRows)} />
          {/* the agent's own picture right under the summary (owner 2026-11-12: Crime's risk gauges) */}
          {hasChildren(overview) && <div className="cu-r-overview-extra cu-r-agent">{overview}</div>}
        </div>
      )}
      {(rules || hasCalcs) && (
        <div className={pane("rules")} {...paneProps("rules")}>
          <div className={`cu-r-split${rules && hasCalcs ? "" : " is-single"}`}>
            {hasCalcs && <CalcPanel {...(calculations ?? {})} rows={calcRows} fit={Boolean(rules)} />}
            {rules && <RulesPanel {...rules} focus={focus} />}
          </div>
        </div>
      )}
      {extra && !detailsOpen && (
        <div className={pane("details")} {...paneProps("details")}>
          <div className="cu-r-card cu-r-details is-open" role="region" aria-label="More details">
            <div className="cu-r-details-body cu-r-agent">{children}</div>
          </div>
        </div>
      )}
      {extra && detailsOpen && <div className="cu-r-pane is-always cu-r-agent">{children}</div>}
      {actions && <ActionBar actions={actions} />}
    </div>
  );
}
