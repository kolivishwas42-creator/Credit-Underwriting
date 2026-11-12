// Crime record verification -> THE COMMON RESULT LAYOUT (shared/components/result, frontend/DESIGN.md §3).
// Pure: maps only what the API returns (GET /cases/{id}, GET /applications/{id}, GET /cases/{id}/summary) and the
// handlers the screen already has. No fetching, no state.
import type { ActionItem, CalcRow, Fact, Kpi, ResultPageProps, RuleRow, Tone } from "../../../shared/components";
import type { ApplicationView, Case, CaseSummary, Subject, UiConfig } from "../types/api";
import { rupees, tone as statusTone, when } from "./format";
import { t } from "./text";

/**
 * A person's risk level (else their status) -> tone, the same five tones as the screen's badges (utils/format tone):
 *   NO_RISK, LOW_RISK, COMPLETED            -> pass
 *   AVERAGE_RISK, REVIEW_REQUIRED           -> review
 *   HIGH_RISK, VERY_HIGH_RISK, FAILED       -> fail
 *   PROCESSING, INITIATED                   -> info  (no result yet)
 *   WAIVED / anything else                  -> na
 */
export function riskTone(level: string | null | undefined): Tone {
  return ({ ok: "pass", warn: "review", bad: "fail", info: "info", na: "na" } as const)[statusTone(level)];
}

/** The summary text as points: the server sends one point per line; an older text: one point per sentence. */
export const points = (text: string) =>
  (text.includes("\n") ? text.split("\n") : text.split(/(?<=[.!?])\s+/))
    .map((s) => s.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim()).filter(Boolean);

const levelOf = (s: Subject) => s.result?.risk_level ?? s.status;
const levelLabel = (s: Subject, config: UiConfig) =>
  s.result ? config.risk.labels[s.result.risk_level] ?? s.result.risk_label : s.status_label || config.statuses[s.status] || s.status;

/** what one line under the person's name says */
function detail(s: Subject, waived: string | null): string {
  if (s.status === "WAIVED") return waived || t("result.waived");
  if (s.status === "FAILED") return s.error?.message ?? s.outcome_label;
  if (!s.result) return s.outcome_label || t("result.pending_text", { ref: s.provider_reference ?? "—" });
  return s.result.summary;
}

function personRow(s: Subject, config: UiConfig, waived: string | null): RuleRow {
  const r = s.result;
  const values: Fact[] = [];
  if (r) {
    if (r.risk_meaning) values.push({ label: t("result.overall_risk", { risk: levelLabel(s, config) }), value: r.risk_meaning });
    values.push({ label: t("result.cases_found"), value: String(r.total_cases) });
    for (const c of r.clusters) values.push({ label: c.label, value: String(c.count) });
    const hits = r.groups.flatMap((g) => g.items).filter((i) => i.cases_found > 0);
    if (hits.length) values.push({ label: t("result.source_with_findings"), value: hits.map((i) => `${i.name} (${i.cases_found})`).join(", ") });
    values.push({ label: t("result.provider_ref"), value: r.provider_reference, mono: true });
    values.push({ label: t("result.received"), value: when(r.result_at) });
  } else if (s.provider_reference) {
    values.push({ label: t("result.provider_ref"), value: s.provider_reference, mono: true });
  }
  if (s.pan_masked) values.push({ label: config.fields.pan, value: s.pan_masked, mono: true });     // masked by the API
  return {
    id: s.role_label,
    name: s.full_name,
    outcome: riskTone(levelOf(s)),
    outcomeLabel: levelLabel(s, config),
    detail: detail(s, waived),
    values: values.length ? values : undefined,
  };
}

export interface CrimeHandlers {
  /** the final report of the whole case (every person in one PDF) */
  download?: () => void;
  /** asks the provider again (a processing case) */
  refresh?: () => void;
  /** takes the officer to the acknowledgement (decision + remarks) */
  finalize?: () => void;
}

export interface CrimeResultInput {
  kase: Case;
  view: ApplicationView;
  config: UiConfig;
  summary: CaseSummary | null;
  /** the summary is still being fetched (first answer not in yet) */
  summaryLoading?: boolean;
  handlers?: CrimeHandlers;
  busy?: string | null;
}

const ORDER: Tone[] = ["fail", "review", "info", "pass", "na"];

export function toResultPage({ kase, view, config, summary, summaryLoading = false, handlers = {}, busy = null }: CrimeResultInput): ResultPageProps {
  const app = view.application;
  const people = kase.subjects;
  const levels = people.map(levelOf);
  const clean = levels.length > 0 && levels.every((l) => config.ui.celebrate_risks.includes(l));
  const flagged = people.filter((s) => (config.ui.alarm_risks ?? []).includes(s.result?.risk_level ?? ""));
  const failed = people.filter((s) => s.status === "FAILED");
  const found = people.reduce((n, s) => n + (s.result?.total_cases ?? 0), 0);
  const statusWord = kase.status_label || config.statuses[kase.status] || kase.status;

  // the overall word: the screen's own (All clear / Review required / the case status)
  const worst = people.map((s) => riskTone(levelOf(s))).sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))[0] ?? "na";
  const decision = clean ? { label: t("results.all_clear"), tone: "pass" as Tone }
    : kase.status === "REVIEW_REQUIRED" ? { label: t("results.review"), tone: "review" as Tone }
    : { label: statusWord, tone: kase.status === "WAIVED" ? "na" as Tone : worst };

  const facts: Fact[] = [
    { label: "Case ID", value: kase.case_id, mono: true },
    { label: "Application", value: kase.application_id, mono: true },
    { label: "Vendor", value: kase.vendor_name },
    { label: "Initiated", value: when(kase.initiated_at) },
    { label: t("results.loan"), value: rupees(app.loan_amount) },
  ];
  if (kase.final_decision) {
    facts.push({ label: t("finalize.done_title"), value: kase.final_decision_label || config.decision_labels[kase.final_decision] || kase.final_decision });
  }

  const kpis: Kpi[] = [
    { label: t("results.people"), value: people.length, tone: "info" },
    { label: t("results.found"), value: found, tone: found ? "fail" : "pass" },
    { label: config.summary_labels.clean ?? "Clean result", value: people.filter((s) => config.ui.celebrate_risks.includes(levelOf(s))).length, tone: "pass" },
    { label: config.summary_labels.review ?? "Needs review", value: flagged.length, tone: "review" },
  ];
  if (failed.length) kpis.push({ label: config.statuses.FAILED ?? "Failed", value: failed.length, tone: "fail" });

  // the summary: the server's (AI when it passed its check, else rules-written); none -> one point per person
  const ai = summary?.source === "ai";
  let summaryPoints = summary?.available && summary.text ? points(summary.text) : [];
  let source = ai ? "AI summary" : "Rules summary";
  if (!summaryPoints.length && !summaryLoading) {
    summaryPoints = [...people].sort((a, b) => ORDER.indexOf(riskTone(levelOf(a))) - ORDER.indexOf(riskTone(levelOf(b))))
      .slice(0, 5).map((s) => `${s.role_label} (${s.full_name}): ${levelLabel(s, config)} — ${detail(s, kase.waived_reason)}`);
    source = "Rules summary";
  }

  // calculations: per person, the risk level, the cases and where they were found (by matter type)
  const calcs: CalcRow[] = [];
  for (const s of people) {
    const group = `${s.role_label} · ${s.full_name}`;
    calcs.push({ group, label: "Risk level", value: levelLabel(s, config), tone: riskTone(levelOf(s)) });
    const r = s.result;
    if (!r) continue;
    const items = r.groups.flatMap((g) => g.items);
    calcs.push({ group, label: t("result.cases_found"), value: r.total_cases, tone: r.total_cases ? "fail" : "pass" });
    calcs.push({ group, label: t("result.sources_hit"), value: items.filter((i) => i.cases_found > 0).length,
                 hint: `${t("result.sources_covered")}: ${items.length}` });
    for (const c of r.clusters) calcs.push({ group, label: c.label, value: c.count, hint: t("result.matter_types") });
  }

  const actions: ActionItem[] = [];
  if (view.can.download_report && people.some((s) => s.result)) {
    actions.push({ id: "download", label: busy === "all" ? t("results.preparing_all") : t("results.download_all"), kind: "ghost",
                   icon: "download", onClick: handlers.download, disabled: busy === "all" });
  }
  if (kase.can.refresh) {
    actions.push({ id: "refresh", label: t("results.refresh"), kind: "secondary", icon: "clock", onClick: handlers.refresh,
                   disabled: busy === "refresh" });
  }
  if (kase.can.finalize && !kase.final_decision && kase.status !== "WAIVED") {
    actions.push({ id: "finalize", label: t("finalize.title"), kind: "primary", icon: "check", onClick: handlers.finalize });
  }

  return {
    basic: {
      eyebrow: "Credit underwriting · Crime verification",
      title: app.applicant_name || kase.application_id,
      subtitle: [app.product, app.branch, statusWord].filter(Boolean).join(" · "),
      icon: "shield",
      facts,
      decision,
      kpis,
    },
    summary: kase.status === "WAIVED" ? undefined : {
      title: ai ? config.summary_labels.ai : summary?.pending ? config.summary_labels.pending : config.summary_labels.rules,
      source,
      points: summaryPoints,
      loading: summaryLoading && !summaryPoints.length,
      // the per-person risk indicator is the gauge strip under the summary (ResultsPage -> RiskOverview)
    },
    rules: {
      title: "Results by person",
      rules: [...people].map((s) => personRow(s, config, kase.waived_reason))
        .sort((a, b) => ORDER.indexOf(a.outcome) - ORDER.indexOf(b.outcome)),
      empty: t("result.none_text"),
    },
    calculations: { title: "Calculations", rows: calcs },
    actions,
  };
}
