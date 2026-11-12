// The eligibility result in the console's COMMON RESULT LAYOUT (shared/components/result): a pure adapter from what
// POST /check returns (CheckResult) to ResultPageProps. Nothing is decided here: the decision, the offer, the checks and
// the sentences are the API's own; values are only formatted.
import type { ActionItem, CalcRow, Fact, ResultPageProps, RuleRow, Tone } from "../../../shared/components";
import type { Check, CheckResult } from "../types";
import { inr, lim, pretty } from "./logic";

/**
 * Tone of the overall decision:
 *   APPROVED               -> pass
 *   CONDITIONAL / REFER    -> review (eligible for less, or borderline: a person decides)
 *   DATA_MISSING           -> review (nothing was decided; figures are needed)
 *   REJECTED               -> fail
 *   anything else          -> na
 */
export function decisionTone(decision: string | null | undefined): Tone {
  switch (String(decision || "").toUpperCase()) {
    case "APPROVED": return "pass";
    case "CONDITIONAL": case "REFER": case "DATA_MISSING": return "review";
    case "REJECTED": return "fail";
    default: return "na";
  }
}

/**
 * Tone of one check (`result`):
 *   pass            -> pass
 *   fail            -> fail
 *   missing         -> review (the figure was not given; the rule could not run)
 *   not_applicable  -> na
 */
export function checkTone(result: string | null | undefined): Tone {
  switch (String(result || "").toLowerCase()) {
    case "pass": return "pass";
    case "fail": return "fail";
    case "missing": return "review";
    default: return "na";
  }
}

/** the agent's own word for a check result: "pass" -> "Pass", "not_applicable" -> "Not applicable" */
const word = (s: string | null | undefined) => {
  const t = pretty(s).trim();
  return t ? t[0].toUpperCase() + t.slice(1).toLowerCase() : "—";
};

/** a summary text as points: one per sentence */
export const sentences = (text: string | null | undefined) =>
  String(text || "").split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);

const has = (v: unknown) => v !== null && v !== undefined && v !== "";

function toRule(c: Check, i: number): RuleRow {
  const values: Fact[] = [];
  if (has(c.value)) values.push({ label: "Value", value: lim(c.value) });
  if (has(c.limit)) values.push({ label: "Limit", value: lim(c.limit) });
  const detail = has(c.value) || has(c.limit)
    ? `${has(c.value) ? lim(c.value) : "—"} · limit ${has(c.limit) ? lim(c.limit) : "—"}`
    : undefined;
  return {
    id: `C${String(i + 1).padStart(2, "0")}`,
    name: c.label,
    outcome: checkTone(c.result),
    outcomeLabel: word(c.result),
    detail,
    values: values.length ? values : undefined,
  };
}

export interface EligibilityContext {
  /** the product checked (the entry's choice) */
  product?: string | null;
  /** the amount asked for in the figures checked */
  requested?: number | null;
}

/** POST /check's answer -> the common result layout */
export function toResultPage(r: CheckResult, ctx: EligibilityContext = {}): ResultPageProps {
  const checks = r.checks || [];
  const rules = checks.map(toRule);
  const count = (t: Tone) => rules.filter((x) => x.outcome === t).length;
  const o = r.offer || {};

  const facts: Fact[] = [];
  if (r.case_id) facts.push({ label: "Case ID", value: r.case_id, mono: true });
  if (ctx.product) facts.push({ label: "Product", value: pretty(ctx.product) });
  if (has(ctx.requested)) facts.push({ label: "Requested", value: inr(ctx.requested) });
  if (has(o.amount)) facts.push({ label: "Amount to offer", value: inr(o.amount) });

  // summary: the API's sentences, what it would take, next steps, missing figures; else the checks that did not pass
  let points = [
    ...sentences(r.summary),
    ...(r.what_it_takes || []),
    ...(r.next_steps || []),
    ...((r.missing_fields || []).length ? [`Missing: ${r.missing_fields!.join(", ")}.`] : []),
  ];
  points = points.filter((p, i) => points.indexOf(p) === i);
  if (!points.length) {
    points = checks
      .filter((c) => c.result !== "pass" && c.result !== "not_applicable")
      .slice(0, 5)
      .map((c) => `${c.label}: ${word(c.result).toLowerCase()} (${has(c.value) ? lim(c.value) : "no value"}, limit ${lim(c.limit)}).`);
  }

  const calc: CalcRow[] = [];
  if (has(ctx.requested)) calc.push({ group: "Offer", label: "Requested amount", value: inr(ctx.requested) });
  if (has(o.amount)) calc.push({ group: "Offer", label: "Amount to offer", value: inr(o.amount), tone: decisionTone(r.decision) });
  if (o.range) calc.push({ group: "Offer", label: "Range", value: o.range });
  if (has(o.emi)) calc.push({ group: "Offer", label: "EMI", value: inr(o.emi) });
  if (has(o.tenure_months)) {
    calc.push({ group: "Offer", label: "Tenure", value: `${o.tenure_months} months`,
                hint: has(o.rate_percent) ? `@ ${o.rate_percent}%` : undefined });
  }
  for (const c of checks) {
    if (!has(c.value)) continue;
    calc.push({ group: "Checked against policy", label: c.label, value: lim(c.value), mono: true,
                hint: has(c.limit) ? `limit ${lim(c.limit)}` : undefined, tone: checkTone(c.result) });
  }
  for (const [k, s] of Object.entries(r.working || {})) {
    calc.push({ group: "Working", label: word(k), value: s });
  }

  // presentational: the screen has no hold / decline / submit / report handler yet
  const actions: ActionItem[] = [
    { id: "report", label: "Download report", kind: "ghost", icon: "download" },
    { id: "hold", label: "Hold", kind: "warning", icon: "pause" },
    { id: "decline", label: "Decline", kind: "danger", icon: "x" },
    { id: "submit", label: "Submit", kind: "primary", icon: "send" },
  ];

  return {
    basic: {
      eyebrow: "Credit underwriting · Eligibility",
      title: r.case_id || "Eligibility check",
      subtitle: ctx.product ? `${pretty(ctx.product)} · eligibility check` : "Eligibility check",
      icon: "calc",
      facts,
      decision: { label: pretty(r.decision) || "—", tone: decisionTone(r.decision) },
      kpis: [
        { label: "Checks run", value: rules.length, tone: "info" },
        { label: "Passed", value: count("pass"), tone: "pass" },
        { label: "Missing", value: count("review"), tone: "review" },
        { label: "Failed", value: count("fail"), tone: "fail" },
      ],
    },
    summary: { points, source: "Rules summary", empty: "The check returned no summary." },
    rules: { rules, title: "Checks", empty: "No checks were returned." },
    calculations: { rows: calc, empty: "No figures were returned." },
    actions,
  };
}
