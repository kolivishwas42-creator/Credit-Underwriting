// The screen's pure logic: severity bands, rule order, the side-by-side rows, the banner and the form values.
import type { FieldDef } from "../config/forms";
import type { FormValues, Property, RuleEval, ValuationResult } from "../types";

export type Band = "CRITICAL" | "MEDIUM" | "LOW";

export function severityBand(value: unknown): Band {
  const v = String(value || "").trim().toUpperCase();
  if (v === "CRITICAL" || v === "HIGH") return "CRITICAL";
  if (v === "MAJOR" || v === "MEDIUM") return "MEDIUM";
  return "LOW";
}

export function ruleSortValue(rule: RuleEval): number {
  if (!rule.triggered) return 9;
  const band = severityBand(rule.severity);
  return band === "CRITICAL" ? 0 : band === "MEDIUM" ? 1 : 2;
}

export function safeValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Not available";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export interface ComparisonRow { field: string; los: string; vendor: string; reason: string; severity: Band }

/** the actual values of the triggered rules' discrepancies, each (field, LOS, vendor) once */
export function buildComparisonRows(results: RuleEval[]): ComparisonRow[] {
  const rows: ComparisonRow[] = [];
  const seen = new Set<string>();
  for (const rule of (results || []).filter((r) => r.triggered)) {
    for (const d of rule.discrepancies || []) {
      const field = d.field || "Field";
      const los = safeValue(d.applicant_value);
      const vendor = safeValue(d.source_value);
      const key = [field, los, vendor].join("|").toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ field, los, vendor, reason: d.reason || rule.issue || "Triggered by rule", severity: severityBand(rule.severity) });
    }
  }
  return rows;
}

/** the assessment's numbers, status and banner */
export function assess(out: ValuationResult) {
  const s = out.summary || {};
  const results = (out.evaluation?.results || []).slice().sort((a, b) => ruleSortValue(a) - ruleSortValue(b));
  const triggered = results.filter((r) => r.triggered);
  const passed = results.filter((r) => !r.triggered);
  const count = (b: Band) => triggered.filter((r) => severityBand(r.severity) === b).length;
  const critical = count("CRITICAL"), medium = count("MEDIUM"), low = count("LOW");
  const status = String(s.agent_status || "REVIEW").toUpperCase();
  const bannerClass = status === "CLEAR" ? "CLEAR" : status === "REVIEW" ? "REVIEW" : "HIGH_RISK";
  const bannerTitle = status === "CLEAR" ? "No rule discrepancies detected"
    : status === "REVIEW" ? "Valuation review recommended" : "Critical valuation issue detected";
  const bannerText = critical
    ? `${critical} critical, ${medium} medium and ${low} low severity rule(s) triggered. Review the highlighted findings before proceeding.`
    : triggered.length
      ? `${medium} medium and ${low} low severity rule(s) triggered. Review the findings and supporting values.`
      : "All executed rules passed. No discrepancies were identified by the configured rules.";
  const icon = status === "CLEAR" ? "✓" : critical ? "✕" : "⚠";
  return {
    results, critical, medium, low, status, bannerClass, bannerTitle, bannerText, icon,
    checked: Number(s.total_rules_checked || results.length),
    triggeredCount: Number(s.total_rules_triggered || triggered.length),
    passedCount: Number(s.total_rules_passed ?? passed.length),
    comparison: buildComparisonRows(results),
    actions: s.recommended_actions || [],
  };
}

/** the outgoing form prefilled from LOS: checkboxes as booleans, a select falls back to its first option */
export function prefillOutgoing(fields: FieldDef[], prefill: Record<string, unknown> | null | undefined): FormValues {
  const v: FormValues = {};
  for (const f of fields) {
    const val = prefill?.[f.key];
    if (f.kind === "check") v[f.key] = !!val;
    else if (val !== undefined && val !== null) v[f.key] = String(val);
    else v[f.key] = f.kind === "select" ? (f.options?.[0] ?? "") : "";
  }
  return v;
}

/** an empty vendor form */
export function blankVendor(fields: FieldDef[]): FormValues {
  return Object.fromEntries(fields.map((f) => [f.key, f.kind === "check" ? false : ""]));
}

/** the vendor response as sent: text trimmed, checkboxes as booleans */
export function collectVendor(values: FormValues): Record<string, string | boolean> {
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, typeof v === "boolean" ? v : v.trim()]));
}

export function propertySummary(p: Property): string {
  return [p.property_owner, p.property_type || p.collateral_type, p.city, p.state, p.pincode].filter(Boolean).join(" · ");
}

export function propertyLabel(p: Property): string {
  return `Property ${p.collateral_property_id} · ${p.property_type || p.collateral_type || "Type not set"}`;
}
