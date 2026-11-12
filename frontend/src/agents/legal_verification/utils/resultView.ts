// Legal verification -> THE COMMON RESULT LAYOUT (shared/components/result, frontend/DESIGN.md §3).
// Pure: maps only what the API returns (GET /applications/{id} workspace + GET /applications/{id}/summary) and the
// handlers the screen already has. No fetching, no state.
import type { ActionItem, CalcRow, Fact, ResultPageProps, RuleRow, Tone } from "../../../shared/components";
import type { Comparison, Config, Rule, Source, Summary, Workspace } from "../types";
import { rupees, t, when } from "./text";

/** the order the sources are listed in a comparison */
const SOURCES: Source[] = ["APPLICATION", "SALE_DEED", "CORRECTED", "AGENCY", "AGENT"];
/** the overall rule ("Overall Risk and Next Action"): it IS the recommendation, so it is the decision badge, not a row */
const OVERALL_RULE = "R10";

/** Rule status -> tone: FAIL (mismatch) = fail, REVIEW = review, PASS = pass, NOT_APPLICABLE / anything else = na. */
export function ruleTone(status: string): Tone {
  return ({ FAIL: "fail", REVIEW: "review", PASS: "pass" } as Record<string, Tone>)[status] ?? "na";
}

/** Recommendation -> tone: ESCALATE = fail, REVIEW_REQUIRED = review, CLEAR_FOR_REVIEW = pass. */
export function recoTone(reco: string | null | undefined): Tone {
  return ({ ESCALATE: "fail", REVIEW_REQUIRED: "review", CLEAR_FOR_REVIEW: "pass" } as Record<string, Tone>)[reco ?? ""] ?? "na";
}

/** comparison match -> tone: true = pass, false = fail, null (not confirmed) = review */
const matchTone = (m: boolean | null): Tone => (m === true ? "pass" : m === false ? "fail" : "review");
const matchWord = (m: boolean | null) => t(m === true ? "rules.match" : m === false ? "rules.mismatch" : "rules.unknown");

/** "Application: Vikas Shetty · Agency report: Prakash Shetty" -- each source by its configured name */
function bySource(c: Comparison, config: Config): string {
  return SOURCES.filter((s) => s in c.values)
    .map((s) => `${config.sources[s] ?? s}: ${c.values[s] ?? t(`rules.missing_value.${s}`)}`)
    .join(" · ");
}

const ORDER: Tone[] = ["fail", "review", "pass", "info", "na"];

function ruleRow(r: Rule, config: Config): RuleRow {
  const values: Fact[] = r.comparisons.map((c) => ({
    label: c.label,
    value: `${bySource(c, config)} — ${matchWord(c.match)}${c.note ? ` (${c.note})` : ""}`,
  }));
  if (r.why) values.push({ label: t("rules.why"), value: r.why });
  if (r.missing.length) values.push({ label: t("rules.missing"), value: r.missing.join("; ") });
  if (r.action_text) values.push({ label: t("rules.action"), value: r.action_text });
  return {
    // the rule's number, never its backend id (the screen shows no "R1")
    id: `#${r.number}`,
    name: r.name,
    outcome: ruleTone(r.status),
    outcomeLabel: r.status_label,
    severity: r.severity_label ?? undefined,
    detail: r.reason,
    values: values.length ? values : [{ label: t("rules.nothing_compared"), value: r.reason }],
  };
}

export interface LegalHandlers {
  /** records the CPA decision (the screen's own submit: remarks are checked there) */
  decide?: (decisionId: string) => void;
  /** downloads the legal verification report PDF */
  download?: () => void;
  /** runs the validation again */
  validate?: () => void;
  /** opens the Final Status step (from the rules step) */
  openFinal?: () => void;
}

export interface LegalResultInput {
  ws: Workspace;
  config: Config;
  summary: Summary | null;
  /** "rules": the rule results step (no summary, no decision); "final": the whole result with the decision */
  step: "rules" | "final";
  handlers?: LegalHandlers;
  busy?: boolean;
}

/** The summary points: the API's (AI when it passed the check, else rules-written); none -> from the overview. */
function summaryPoints(ws: Workspace, summary: Summary): { points: string[]; source: string } {
  if (summary.points?.length) return { points: summary.points, source: summary.source === "ai" ? "AI summary" : "Rules summary" };
  const ov = ws.run?.overview;
  if (!ov) return { points: [], source: "Rules summary" };
  const points = [...ov.findings, ...ov.missing.map((m) => `${t("reco.missing")}: ${m}`)];
  if (!points.length) {
    // nothing failed or missing: the rules that need review, then the recommendation's note
    for (const r of ws.run!.rules) if (r.status === "REVIEW" && r.id !== OVERALL_RULE) points.push(`${r.name}: ${r.reason}`);
    if (!points.length) points.push(ov.recommendation_note);
  }
  points.push(`${t("reco.next")} ${ov.next_action_text}`);
  return { points: points.slice(0, 5), source: "Rules summary" };
}

export function toResultPage({ ws, config, summary, step, handlers = {}, busy = false }: LegalResultInput): ResultPageProps {
  const app = ws.application;
  const run = ws.run;
  const ov = run?.overview;
  const rules = (run?.rules ?? []).filter((r) => r.id !== OVERALL_RULE)
    .map((r) => ruleRow(r, config))
    .sort((a, b) => ORDER.indexOf(a.outcome) - ORDER.indexOf(b.outcome));
  const n = (tone: Tone) => rules.filter((r) => r.outcome === tone).length;

  const facts: Fact[] = [
    { label: t("case.application_id"), value: app.application_id, mono: true },
    { label: "Case ID", value: ws.case.case_id, mono: true },
    { label: t("case.los_status"), value: ws.case.status_label },
    { label: "Agency", value: ws.case.agency_name ?? "—" },
    { label: t("application.property_type"), value: app.property_type_label || "—" },
    { label: "Property", value: [app.property_address, app.property_pin].filter(Boolean).join(" ") || "—" },
    { label: t("case.loan"), value: rupees(app.loan_amount) },
  ];
  if (ws.case.sent_at) facts.push({ label: "Sent to agency", value: when(ws.case.sent_at) });
  if (run) facts.push({ label: "Rules run", value: when(run.run_at) });
  if (ws.case.decision_label) facts.push({ label: t("case.final_status"), value: ws.case.decision_label });

  // calculations: the values compared, Sale Deed vs agency vs application, then the Sale Deed as entered
  const calcs: CalcRow[] = [];
  const seen = new Set<string>();
  for (const r of run?.rules ?? []) {
    for (const c of r.comparisons) {
      const sources = SOURCES.filter((s) => s in c.values && s !== "AGENT");
      if (sources.length < 2 || seen.has(c.label)) continue;         // a real comparison: two sources or more
      seen.add(c.label);
      calcs.push({ group: "Compared values", label: c.label, hint: bySource(c, config), value: matchWord(c.match),
                   tone: matchTone(c.match) });
    }
  }
  for (const f of ws.deed ?? []) {
    if (f.value) calcs.push({ group: config.sources.SALE_DEED ?? "Sale Deed", label: f.label, value: f.value,
                              hint: f.source && f.source !== "SALE_DEED" ? config.sources[f.source] : undefined });
  }
  const overall = run?.rules.find((r) => r.id === OVERALL_RULE);
  if (overall) calcs.push({ group: overall.name, label: overall.status_label, value: overall.reason, tone: ruleTone(overall.status) });

  const actions: ActionItem[] = [];
  if (step === "final") {
    const reco = ov?.recommendation;
    const open = ws.can.decide && !["DECIDED", "WAIVED"].includes(ws.case.status);
    const kind: Record<string, ActionItem["kind"]> = { PROCEED: "primary", SEND_BACK_TO_AGENCY: "secondary",
                                                       ESCALATE_TO_LEGAL: "warning", REJECT_COLLATERAL: "danger" };
    const icon: Record<string, string> = { PROCEED: "check", SEND_BACK_TO_AGENCY: "send", ESCALATE_TO_LEGAL: "flag",
                                           REJECT_COLLATERAL: "x" };
    if (ws.can.download) actions.push({ id: "download", label: t("case.download"), kind: "ghost", icon: "download",
                                        onClick: handlers.download, disabled: busy });
    // reject first, proceed last: the primary action sits at the end
    for (const d of [...config.decisions].reverse()) {
      const blocked = d.id === "PROCEED" && !!reco && !config.proceed_allowed_for.includes(reco);
      actions.push({ id: d.id, label: d.label, kind: kind[d.id] ?? "secondary", icon: icon[d.id],
                     onClick: handlers.decide ? () => handlers.decide!(d.id) : undefined, disabled: !open || blocked || busy });
    }
  } else {
    if (ws.can.validate) actions.push({ id: "validate", label: t("case.validate"), kind: "secondary", icon: "arrow",
                                        onClick: handlers.validate, disabled: busy });
    if (ws.can.download) actions.push({ id: "download", label: t("case.download"), kind: "ghost", icon: "download",
                                        onClick: handlers.download, disabled: busy });
    actions.push({ id: "final", label: t("sections.final"), kind: "primary", icon: "arrow", onClick: handlers.openFinal,
                   disabled: !run });
  }

  // the summary is fetched on its own: until it answers the card shows its loading lines
  const { points, source } = summary ? summaryPoints(ws, summary) : { points: [], source: undefined };
  return {
    basic: {
      eyebrow: "Credit underwriting · Legal verification",
      title: app.applicant_name || app.application_id,
      subtitle: [app.product, app.branch, ws.case.agency_name].filter(Boolean).join(" · ") || undefined,
      icon: "scale",
      facts,
      decision: ov ? { label: ov.recommendation_label, tone: recoTone(ov.recommendation) }
        : { label: t("reco.not_run"), tone: "na" },
      kpis: run ? [
        { label: "Rules run", value: rules.length, tone: "info" },
        { label: t("rules.group.PASS"), value: n("pass"), tone: "pass" },
        { label: t("rules.group.REVIEW"), value: n("review"), tone: "review" },
        { label: t("rules.group.FAIL"), value: n("fail"), tone: "fail" },
      ] : undefined,
    },
    summary: step === "final" && run ? {
      title: summary?.source === "ai" ? "AI summary" : t("summary.title"),
      source,
      points,
      loading: !summary,
      empty: t("summary.none_text"),
    } : undefined,
    rules: { title: t("rules.title"), rules, empty: ws.can.validate ? t("rules.not_run_text") : t("rules.not_run_wait") },
    calculations: { title: "Compared values", rows: calcs, empty: t("rules.nothing_compared") },
    actions,
  };
}
