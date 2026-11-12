// The bank verification result in the console's COMMON RESULT LAYOUT (shared/components/result): a pure adapter from
// what the API returns (CaseDetail + the plain summary) to ResultPageProps. No new numbers are invented: money is shown
// as returned (never parsed into a float), counts are counted.
import type { ActionItem, CalcRow, Fact, ResultPageProps, RuleRow, Tone } from "../../../shared/components";
import { statusWord } from "../components/ui";
import type { AppConfig, CaseDetail, Comparison, PlainSummary, RuleResult, SourceData } from "../types/api";
import { day, rupees } from "./format";

export const PRODUCTS: Record<string, string> = { PERSONAL_LOAN: "Personal Loan", LAP: "LAP", HOME_LOAN: "Home Loan" };
export const CLOSED = ["POSITIVE", "NEGATIVE", "WAIVED"];

/** The summary as points: one per line (numbered points from the server), else one per sentence. */
export const points = (text: string) =>
  (text.includes("\n") ? text.split("\n") : text.split(/(?<=[.!?])\s+/))
    .map((s) => s.trim().replace(/^(\d+[.)]|[-•*])\s+/, ""))
    .filter(Boolean);

/**
 * Tone of a bank status (rule, run or case):
 *   PASS / POSITIVE                                   -> pass
 *   FAIL / NEGATIVE                                   -> fail
 *   REVIEW_REQUIRED / READY_FOR_FINALIZATION / READING -> review (a person still has to act)
 *   WAIVED                                            -> info   (closed without a verdict)
 *   NOT_APPLICABLE / PENDING_VERIFICATION / anything else -> na
 */
export function toneOf(status: string | null | undefined): Tone {
  switch (status) {
    case "PASS": case "POSITIVE": return "pass";
    case "FAIL": case "NEGATIVE": return "fail";
    case "REVIEW_REQUIRED": case "READY_FOR_FINALIZATION": case "READING": return "review";
    case "WAIVED": return "info";
    default: return "na";
  }
}

const ORDER: Record<string, number> = { FAIL: 0, REVIEW_REQUIRED: 1, PASS: 2, NOT_APPLICABLE: 3 };
const SEVERITY_RANK: Record<string, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
const matchWord = (m: boolean | null) => (m === true ? "Match" : m === false ? "Mismatch" : "Not confirmed");

/** The one source every row of a check is compared with ("Statement"), or null when the rows differ. */
export const oneSource = (r: RuleResult) => {
  const labels = new Set(r.comparisons.map((c) => c.right_label).filter(Boolean));
  return labels.size === 1 ? [...labels][0]! : null;
};

function comparisonFacts(r: RuleResult, actions: Record<string, string>): Fact[] {
  const source = oneSource(r);
  const line = (c: Comparison) =>
    `${c.left ?? "—"} vs ${source ? "" : c.right_label ? `${c.right_label}: ` : ""}${c.right ?? "—"} · ${matchWord(c.match)}`
    + (c.note ? ` (${c.note})` : "");
  const facts: Fact[] = [];
  // the source is named once ("Compared with: Statement") instead of a tag on every row
  if (r.comparisons.length && source) facts.push({ label: "Compared with", value: source });
  r.comparisons.forEach((c, i) => facts.push({ label: c.left_label || `Value ${i + 1}`, value: line(c) }));
  if (r.missing_evidence.length) facts.push({ label: "Missing", value: r.missing_evidence.join("; ") });
  if (r.risk_flags.length) facts.push({ label: "Watch out", value: r.risk_flags.map((f) => f.message).join("; ") });
  if (r.recommended_action && actions[r.recommended_action]) facts.push({ label: "What to do", value: actions[r.recommended_action] });
  return facts;
}

/** Every check except R8 (the overall result is the basic card's decision): problems first, then reviews, passed, n/a. */
export function toRules(rules: RuleResult[], actions: Record<string, string>): RuleRow[] {
  return rules
    .filter((r) => r.rule_id !== "R8")
    .sort((a, b) => ORDER[a.status] - ORDER[b.status])
    .map((r) => {
      const top = r.risk_flags.reduce<string | null>(
        (s, f) => (!s || SEVERITY_RANK[f.severity] > SEVERITY_RANK[s] ? f.severity : s), null);
      const values = comparisonFacts(r, actions);
      return {
        id: r.rule_id,
        name: r.rule_name,
        outcome: toneOf(r.status),
        outcomeLabel: statusWord(r.status),
        severity: top ? statusWord(top) : undefined,
        detail: r.reason || undefined,
        values: values.length ? values : undefined,
      };
    });
}

function sourceRows(group: string, s: SourceData | null | undefined): CalcRow[] {
  if (!s) return [];
  const credits = s.transactions.filter((t) => t.direction === "CREDIT").length;
  const debits = s.transactions.filter((t) => t.direction === "DEBIT").length;
  const rows: CalcRow[] = [];
  if (s.period_start || s.period_end) rows.push({ group, label: "Period", value: `${day(s.period_start)} to ${day(s.period_end)}` });
  if (s.opening_balance) rows.push({ group, label: "Opening balance", value: rupees(s.opening_balance), mono: true });
  if (s.closing_balance) rows.push({ group, label: "Closing balance", value: rupees(s.closing_balance), mono: true });
  if (s.transactions.length) {
    rows.push({ group, label: "Transactions read", value: s.transactions.length });
    rows.push({ group, label: "Credits / debits", value: `${credits} / ${debits}`, hint: "count of entries" });
  }
  return rows;
}

/** Numbers the run computed or compared, grouped. */
export function toCalculations(detail: CaseDetail): CalcRow[] {
  const run = detail.latest_run;
  if (!run) return [];
  const k = run.checks;
  const rows: CalcRow[] = [
    { group: "Checks", label: "Checks applicable", value: k.checks_applicable, tone: "info" },
    { group: "Checks", label: "Passed", value: k.checks_passed, tone: k.checks_passed ? "pass" : undefined },
    { group: "Checks", label: "Needs review", value: k.checks_review, tone: k.checks_review ? "review" : undefined },
    { group: "Checks", label: "Problems", value: k.checks_failed, tone: k.checks_failed ? "fail" : undefined },
  ];
  if (k.not_applicable.length) rows.push({ group: "Checks", label: "Not applicable", value: k.not_applicable.length });
  // score_note is a note for developers (how the score is counted), not a value: not shown (owner 2026-11-11)
  rows.push(...sourceRows("Statement", run.sources.statement), ...sourceRows("Account Aggregator", run.sources.aa));
  const file = run.sources.statement_file;
  if (file) {
    rows.push({ group: "Statement file", label: "Pages with text", value: `${file.pages_with_text} of ${file.pages}` });
    rows.push({ group: "Statement file", label: "Read", value: statusWord(file.extraction_status), tone: toneOfRead(file.extraction_status) });
  }
  const flags = run.risk_flags;
  if (flags.length) {
    for (const sev of ["HIGH", "MEDIUM", "LOW"] as const) {
      const n = flags.filter((f) => f.severity === sev).length;
      if (n) rows.push({ group: "Risk flags", label: statusWord(sev), value: n, tone: sev === "HIGH" ? "fail" : sev === "MEDIUM" ? "review" : "info" });
    }
  }
  if (run.mismatches.length) rows.push({ group: "Risk flags", label: "Mismatched fields", value: run.mismatches.length, tone: "fail" });
  return rows;
}

const toneOfRead = (s: string): Tone => (s === "COMPLETE" ? "pass" : s === "INVALID" ? "fail" : "review");

/** 2–5 points from the checks that found a problem or need review, when no written summary is available. */
export function derivedPoints(rules: RuleResult[]): string[] {
  const shown = rules.filter((r) => r.rule_id !== "R8");
  const bad = shown.filter((r) => r.status === "FAIL" || r.status === "REVIEW_REQUIRED")
    .sort((a, b) => ORDER[a.status] - ORDER[b.status]);
  const passed = shown.filter((r) => r.status === "PASS").length;
  const out = [`${passed} of ${shown.filter((r) => r.status !== "NOT_APPLICABLE").length} checks passed.`];
  for (const r of bad.slice(0, 4)) out.push(`${r.rule_name}: ${r.reason || statusWord(r.status)}`);
  return out;
}

export interface SummaryState { summary: PlainSummary | null; error: Error | null }

export interface BankViewHandlers {
  downloadPdf?: () => void;
  printView?: () => void;
  openAgencyReport?: (documentId: string) => void;
  goToAgency?: () => void;
}

/** The whole result page for one case. */
export function toResultPage(detail: CaseDetail, config: AppConfig, s: SummaryState, h: BankViewHandlers = {}): ResultPageProps {
  const c = detail.case;
  const run = detail.latest_run;
  const reading = c.status === "READING";
  const closed = CLOSED.includes(c.status);
  const status = closed || reading ? c.status : run?.overall_status ?? "PENDING_VERIFICATION";
  const form = run?.form ?? detail.prefill;
  const agency = config.agencies.find((a) => a.id === c.assigned_agency)?.name;
  const next = run && !closed && !reading ? config.actions[run.recommended_action] : undefined;

  const facts: Fact[] = [
    { label: "Case ID", value: c.case_id, mono: true },
    { label: "Applicant ID", value: c.application_ref, mono: true },
    { label: "Loan amount", value: rupees(c.loan_amount) },
    { label: "Stage", value: c.stage },
    { label: "AA data", value: c.mode === "AA_SUCCESS" ? "Received" : "Not received" },
  ];
  if (form?.bank_name) facts.push({ label: "Bank", value: form.bank_name });
  if (form?.account_number) facts.push({ label: "Account", value: form.account_number, mono: true });
  if (form?.account_type) facts.push({ label: "Account type", value: form.account_type });
  facts.push({ label: "Agency", value: agency ?? "Not assigned" });
  if (next) facts.push({ label: "Next step", value: next });

  const subtitle = reading
    ? "Reading the statement. The checks will appear here as soon as it is read."
    : `${PRODUCTS[c.product] ?? c.product} · Bank account verification`;

  const result: ResultPageProps = {
    basic: {
      eyebrow: "Credit underwriting · Bank verification",
      title: c.applicant_name || c.case_id,
      subtitle,
      icon: "bank",
      facts,
      decision: { label: statusWord(status), tone: toneOf(status) },
      kpis: run ? [
        { label: "Checks run", value: run.checks.checks_applicable, tone: "info" },
        { label: "Passed", value: run.checks.checks_passed, tone: "pass" },
        { label: "Review", value: run.checks.checks_review, tone: "review" },
        { label: "Problems", value: run.checks.checks_failed, tone: "fail" },
      ] : undefined,
    },
  };
  if (!run) return result;

  const pending = Boolean(s.summary?.pending);
  const written = s.summary ? points(s.summary.text) : [];
  if (written.length) {
    result.summary = {
      points: written,
      source: `${s.summary!.source === "ai" ? "AI summary" : "Rules summary"}${pending ? " · Updating" : ""}`,
    };
  } else if (s.error || s.summary) {
    // no written summary (it failed, or came back empty): points from the checks themselves
    result.summary = { points: derivedPoints(run.rules), source: "Rules summary" };
  } else {
    result.summary = { points: [], loading: true, source: "AI summary" };
  }

  result.rules = { title: "Verification checks", rules: toRules(run.rules, config.actions), empty: "No checks were run." };
  result.calculations = { title: "Calculations", rows: toCalculations(detail) };

  const actions: ActionItem[] = [
    { id: "pdf", label: "Download PDF", kind: "primary", icon: "download", onClick: h.downloadPdf },
    { id: "print", label: "Print view", kind: "secondary", icon: "receipt", onClick: h.printView },
  ];
  detail.documents.filter((d) => d.role === "REPORT").forEach((d, i, all) =>
    actions.push({ id: `report-${d.document_id}`, label: all.length > 1 ? `Agency report ${i + 1}` : "Agency report",
                   kind: "ghost", icon: "receipt",
                   onClick: h.openAgencyReport ? () => h.openAgencyReport!(d.document_id) : undefined }));
  if (!closed) actions.push({ id: "agency", label: "Agency confirmation", kind: "secondary", icon: "shield", onClick: h.goToAgency });
  result.actions = actions;
  return result;
}
