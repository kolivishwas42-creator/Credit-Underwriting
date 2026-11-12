// The fraud screening result in the console's COMMON RESULT LAYOUT (shared/components/result): a pure adapter from
// POST /fraud/evaluate's answer (Evaluation) to ResultPageProps. The risk level, the warning and every rule outcome are
// the API's own; here they are only counted and worded.
import type { ActionItem, CalcRow, Fact, ResultPageProps, RuleRow, Tone } from "../../../shared/components";
import type { Evaluation, RuleResult, ScreenKind, Screening } from "../types";
import { SCREENS, ruleCounts, screenCount } from "./screening";

/**
 * Tone of the overall risk level:
 *   LOW              -> pass
 *   MEDIUM           -> review
 *   HIGH / CRITICAL  -> fail
 *   anything else    -> na
 */
export function riskTone(level: string | null | undefined): Tone {
  switch (String(level || "").toUpperCase()) {
    case "LOW": return "pass";
    case "MEDIUM": return "review";
    case "HIGH": case "CRITICAL": return "fail";
    default: return "na";
  }
}

/**
 * Tone of one rule result:
 *   disabled (enabled === false)                -> na     "Disabled"
 *   triggered, severity HIGH / CRITICAL         -> fail   "Triggered"
 *   triggered, any other severity               -> review "Triggered"
 *   not triggered                               -> pass   "Passed"
 *   listed in skipped_rules                     -> na     "Skipped"
 */
export function ruleTone(r: RuleResult): Tone {
  if (r.enabled === false) return "na";
  if (r.triggered) return ["HIGH", "CRITICAL"].includes(String(r.severity || "").toUpperCase()) ? "fail" : "review";
  return "pass";
}

const ruleWord = (r: RuleResult) => (r.enabled === false ? "Disabled" : r.triggered ? "Triggered" : "Passed");
const sentences = (text: string | null | undefined) =>
  String(text || "").split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
const pretty = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

/** a skipped-rule note that only says the rule is switched off (or cannot run at all): those live in Rule configuration */
const offNote = (key: string) => /disabled in configuration|not implementable/i.test(key);

/** a record's keys, in this order, with plain labels (anything else follows, its key read as words) */
const RECORD_LABELS: Record<string, string> = {
  score: "Match score", application: "Application", customer_id: "Customer ID", family_link: "Family link", address: "Address",
};
const recordLines = (rec: Record<string, string | number | null>) => [
  ...Object.keys(RECORD_LABELS).filter((k) => k in rec),
  ...Object.keys(rec).filter((k) => !(k in RECORD_LABELS)),
].map((k) => ({
  label: RECORD_LABELS[k] ?? k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()),
  value: rec[k] === null || rec[k] === undefined || rec[k] === "" ? "—" : String(rec[k]),
}));

/** Rules that exist once for the applicant and once for the co-applicant share a number: say whose data each checks. */
const WHO: Record<string, string> = {
  Rule1_PAN_Aadhaar_Mismatch: "Applicant", Rule1_CoApp_PAN_Aadhaar_Mismatch: "Co-applicant",
  Rule6_Shared_Bank_Account: "Applicant", Rule6_CoApp_Shared_Bank_Account: "Co-applicant",
  Rule9_Age_DOB_Mismatch: "Applicant and co-applicant", Rule9_DOB_Conflict: "Applicant",
};
export const withWho = (name: string, key: string | undefined) => {
  const who = key ? WHO[key] : undefined;
  return who && !/primary|applicant/i.test(name) ? `${name} (${who})` : name;
};

/**
 * The rules list: every enabled rule's result, then the rules skipped for lack of data. A disabled rule is NOT listed
 * (owner 2026-11-12) until it is enabled: it is switched on in Rule configuration.
 */
export function toRules(data: Evaluation): RuleRow[] {
  const results = (data.rule_results || []).filter((r) => r.enabled !== false);
  const rows: RuleRow[] = results.map((r, i) => ({
    id: String(r.rule || r.rule_key || `#${i + 1}`),
    name: withWho(r.name || r.rule_key || "Rule", r.rule_key),
    outcome: ruleTone(r),
    outcomeLabel: ruleWord(r),
    severity: r.severity ? pretty(r.severity) : undefined,
    detail: r.message || undefined,
    // collapsed to its name; opened, the message and the compared fields as two boxes side by side
    detailOnOpen: true,
    records: r.records?.length ? r.records.map(recordLines) : undefined,
    compare: r.compare?.length ? r.compare.map((c) => ({ field: c.field, left: c.application, right: c.other })) : undefined,
  }));
  const seen = new Set(results.map((r) => r.rule_key));
  for (const key of data.skipped_rules || []) {
    if (seen.has(key) || offNote(key)) continue;
    // a skipped rule arrives as one sentence ("Rule 11 [Identity-document mismatch]: not implementable …"):
    // the short "Rule 11" is the id, the bracketed title the name, the rest the detail
    const m = /^\s*(rule\s*\d+)\s*(?:\[([^\]]+)\])?\s*:?\s*(.*)$/i.exec(key);
    rows.push(m
      ? { id: m[1].replace(/\s+/g, " "), name: m[2] || m[1], outcome: "na", outcomeLabel: "Skipped",
          detail: m[3] ? m[3].charAt(0).toUpperCase() + m[3].slice(1) : "Not run for this application." }
      : { id: key.length > 18 ? "Skipped" : key, name: key, outcome: "na", outcomeLabel: "Skipped",
          detail: "Not run for this application." });
  }
  return rows;
}

/** one screening (AML / PEP) as calculation rows */
function screeningRows(kind: ScreenKind, s: Screening | null | undefined): CalcRow[] {
  const group = SCREENS[kind].title;
  if (!s) return [{ group, label: "Status", value: "Not run", tone: "na" }];
  if (s.error || s.status === "error") return [{ group, label: "Status", value: "Could not run", tone: "review" }];
  const strong = s.strong_matches || [], other = s.other_matches || [];
  const scores = [...strong, ...other].map((v) => Number(v.match_percent)).filter((n) => !isNaN(n));
  const rows: CalcRow[] = [
    { group, label: `At or above ${s.threshold_percent ?? "—"}%`, value: strong.length, tone: strong.length ? "fail" : "pass" },
    { group, label: `Below ${s.threshold_percent ?? "—"}%`, value: other.length },
  ];
  if (scores.length) rows.push({ group, label: "Highest match score", value: `${Math.max(...scores)}%` });
  if (s.total_records !== undefined) rows.push({ group, label: "Records from vendor", value: s.total_records });
  if (s.source === "mock") rows.push({ group, label: "Source", value: "Sample data", tone: "review" });
  return rows;
}

function screeningPoint(kind: ScreenKind, s: Screening | null | undefined): string | null {
  const title = SCREENS[kind].title;
  if (!s) return null;
  if (s.error || s.status === "error") return `${title} could not run: ${s.error || "the vendor returned an error"}.`;
  if (s.summary) return `${title}: ${s.summary}`;
  return `${title}: ${screenCount(s)} record(s) at or above the threshold.`;
}

/** POST /fraud/evaluate's answer -> the common result layout */
export function toResultPage(data: Evaluation): ResultPageProps {
  const counts = ruleCounts(data);
  const results = data.rule_results || [];
  const rules = toRules(data);
  const risk = data.risk_level || "LOW";

  const facts: Fact[] = [{ label: "Application", value: data.application_number, mono: true }];
  if (data.is_potential_fraud !== undefined) facts.push({ label: "Potential fraud", value: data.is_potential_fraud ? "Yes" : "No" });

  // summary: the API's warning, AML / PEP in one line each, then the triggered rules' messages
  const points = [
    ...sentences(data.fraud_warning),
    ...(["aml", "pep"] as ScreenKind[]).map((k) => screeningPoint(k, data[k])).filter((p): p is string => Boolean(p)),
    ...results.filter((r) => r.triggered && r.enabled !== false && r.message)
      .slice(0, 5).map((r) => `${r.name || r.rule || r.rule_key}: ${r.message}`),
  ];

  const calc: CalcRow[] = [
    { group: "Risk", label: "Risk level", value: risk, tone: riskTone(risk) },
    { group: "Risk", label: "Rules triggered", value: counts.trig, tone: counts.trig ? riskTone(risk) : "pass" },
    { group: "Risk", label: "Skipped / disabled", value: counts.skip },
    ...screeningRows("aml", data.aml),
    ...screeningRows("pep", data.pep),
  ];

  // presentational: the screen has no hold / decline / submit / report handler yet
  const actions: ActionItem[] = [
    { id: "report", label: "Download report", kind: "ghost", icon: "download" },
    { id: "hold", label: "Hold", kind: "warning", icon: "pause" },
    { id: "decline", label: "Decline", kind: "danger", icon: "x" },
    { id: "submit", label: "Submit", kind: "primary", icon: "send" },
  ];

  return {
    basic: {
      eyebrow: "Credit underwriting · Fraud screening",
      title: data.application_number,
      subtitle: "Fraud rules · AML screening · PEP check",
      icon: "shield",
      facts,
      decision: { label: `${risk} risk`, tone: riskTone(risk) },
      kpis: [
        { label: "Rules run", value: results.filter((r) => r.enabled !== false).length, tone: "info" },
        { label: "Triggered", value: counts.trig, tone: counts.trig ? "fail" : "na" },
        { label: "Passed", value: counts.pass, tone: "pass" },
        { label: "Skipped / disabled", value: counts.skip, tone: "na" },
      ],
    },
    summary: { points, source: "Rules summary", empty: "The evaluation returned no warning." },
    rules: { rules, title: "Rule results", empty: "No rule results were returned." },
    calculations: { rows: calc, title: "Risk and screening" },
    actions,
  };
}
