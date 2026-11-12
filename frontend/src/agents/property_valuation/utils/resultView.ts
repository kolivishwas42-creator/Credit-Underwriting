// The property valuation result in the console's COMMON RESULT LAYOUT (shared/components/result): a pure adapter from
// the valuation answer (ValuationResult) plus what this screen sent with it (the application, the property, the
// vendor's response) to ResultPageProps. The agent status, the rule outcomes and the discrepancies are the API's own;
// assess() only counts, orders and words them. No deviation % or value is computed here.
import type { ActionItem, CalcRow, Fact, ResultPageProps, RuleRow, Tone } from "../../../shared/components";
import type { FieldDef } from "../config/forms";
import type { Application, Property, RuleEval, ValuationResult } from "../types";
import { assess, propertySummary, safeValue, severityBand } from "./result";

/**
 * Tone of the agent status:
 *   CLEAR      -> pass
 *   REVIEW     -> review
 *   HIGH_RISK  -> fail   (and any other status: assess() treats it as high risk)
 */
export function statusTone(status: string): Tone {
  return status === "CLEAR" ? "pass" : status === "REVIEW" ? "review" : "fail";
}

/**
 * Tone of one rule:
 *   not triggered                               -> pass   "Passed"
 *   triggered, band CRITICAL (CRITICAL / HIGH)  -> fail   "Triggered"
 *   triggered, band MEDIUM or LOW               -> review "Triggered"
 */
export function ruleTone(r: RuleEval): Tone {
  if (!r.triggered) return "pass";
  return severityBand(r.severity) === "CRITICAL" ? "fail" : "review";
}

const title = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

function toRule(r: RuleEval, i: number): RuleRow {
  const values: Fact[] = [];
  // the LOS and the vendor property side by side: one row a compared field
  const found = r.triggered ? r.discrepancies || [] : [];
  const table = found.length
    ? {
      columns: ["Field", "Application value", "Vendor value"],
      rows: found.map((d) => [d.field || "Field", safeValue(d.applicant_value), safeValue(d.source_value)]),
    }
    : undefined;
  // the reasons go below the table, one line a field that has one
  const reasons = found.filter((d) => d.reason);
  for (const d of reasons) values.push({ label: reasons.length > 1 ? `Reason — ${d.field || "Field"}` : "Reason", value: String(d.reason) });
  if (r.recommended_action) values.push({ label: "Recommended action", value: r.recommended_action });
  return {
    id: String(r.rule_id || `#${r.rule_number ?? i + 1}`),
    name: r.rule_name || r.rule_id || "Rule",
    outcome: ruleTone(r),
    outcomeLabel: r.triggered ? "Triggered" : "Passed",
    severity: r.triggered ? title(severityBand(r.severity)) : undefined,
    detail: r.issue || (r.triggered ? "Rule condition was met." : "No issue detected."),
    values: values.length ? values : undefined,
    table,
  };
}

export interface ValuationContext {
  application?: Application | null;
  property?: Property | null;
  /** the vendor's response as sent with this run */
  vendorResponse?: Record<string, unknown> | null;
  /** the response fields whose figures are listed under Calculations (the number fields of the vendor form) */
  figureFields?: FieldDef[];
}

/** the valuation answer -> the common result layout */
export function toResultPage(out: ValuationResult, ctx: ValuationContext = {}): ResultPageProps {
  const a = assess(out);
  const p = ctx.property;
  const facts: Fact[] = [];
  if (ctx.application?.application_number) facts.push({ label: "Application", value: ctx.application.application_number, mono: true });
  if (p) facts.push({ label: "Property ID", value: String(p.collateral_property_id), mono: true });
  facts.push({ label: "Vendor status", value: out.vendor_status || "Not supplied" });

  // summary: the assessment in words, the triggered rules' findings, then the recommended actions
  const points = [
    `${a.bannerTitle}.`,
    a.bannerText,
    ...a.results.filter((r) => r.triggered && r.issue).slice(0, 4).map((r) => `${r.rule_name || r.rule_id}: ${r.issue}`),
    ...a.actions.map((x) => `Recommended: ${x}`),
  ];

  const calc: CalcRow[] = a.comparison.map((c) => ({
    group: "LOS vs vendor", label: c.field, value: c.vendor, hint: `LOS ${c.los}`, mono: true,
    tone: c.severity === "CRITICAL" ? "fail" : "review",
  }));
  const response = ctx.vendorResponse || {};
  for (const f of ctx.figureFields || []) {
    const v = response[f.key];
    if (v === undefined || v === null || v === "" || typeof v === "boolean") continue;
    calc.push({ group: "Vendor valuation (as submitted)", label: f.label, value: String(v), mono: true });
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
      eyebrow: "Credit underwriting · Property valuation",
      title: ctx.application?.applicant_name || ctx.application?.application_number || `Result #${out.result_id ?? ""}`,
      subtitle: p ? propertySummary(p) || `Property ${p.collateral_property_id}` : "Property valuation assessment",
      icon: "home",
      facts,
      decision: { label: a.status.replace(/_/g, " "), tone: statusTone(a.status) },
      kpis: [
        { label: "Rules checked", value: a.checked, tone: "info" },
        { label: "Passed", value: a.passedCount, tone: "pass" },
        { label: "Triggered", value: a.triggeredCount, tone: a.triggeredCount ? "review" : "na" },
        { label: "Critical", value: a.critical, tone: a.critical ? "fail" : "na" },
        { label: "Medium", value: a.medium, tone: a.medium ? "review" : "na" },
        { label: "Low", value: a.low, tone: "na" },
      ],
    },
    summary: { points, source: "Rules summary" },
    rules: { rules: a.results.map(toRule), title: "Rule-wise evaluation", empty: "No rule evaluation records were returned." },
    calculations: { rows: calc, title: "Compared values",
                    empty: "No triggered rule supplied a value to compare, and no vendor figures were entered." },
    actions,
  };
}
