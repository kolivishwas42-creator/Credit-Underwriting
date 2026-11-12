// The dedupe answer (core viewResult / allView) in the console's COMMON RESULT LAYOUT:
//   basic card -> AI summary -> rules | calculations -> actions.
// Pure: no React state, no fetch. Every value comes from the view the page already built from the backend answer.
//
// Tone mapping (the agent's own tones -> the layout's Tone):
//   ok / pass        -> pass     (clear, matched, available)
//   bad / fail       -> fail     (found, mismatch, source error)
//   warn / skip / partial -> review (not fully checked, limit not set, possible match)
//   brand            -> info     (a confirmed customer: a fact, not a verdict)
//   na / anything else -> na     (not available, not applicable)
import * as C from "../core";
import { label, sentences } from "../components/kit";
import type { ActionItem, CalcRow, Fact, Kpi, ResultPageProps, RuleRow, Tone } from "../../../shared/components";
import type { AllView, BusinessRuleView, DedupeView, Entered, UiText } from "../types";

export function toTone(tone: string | null | undefined): Tone {
  switch (tone) {
    case "ok": case "pass": return "pass";
    case "bad": case "fail": return "fail";
    case "warn": case "skip": case "partial": return "review";
    case "brand": return "info";
    default: return "na";
  }
}

/** A role code in the officer's words (ui_text.json roles / parties); unknown codes are humanised, never hidden. */
export function makeRoleWord(text: UiText) {
  return (code: string | null | undefined, group = "roles") => {
    if (!code) return "";
    const t = text as Record<string, Record<string, string> | undefined>;
    return (t[group] || {})[code] || (t.roles || {})[code] || label(code);
  };
}

/** red first, then amber, then green, then n/a; the backend's order is kept inside each colour */
const ORDER: Record<Tone, number> = { fail: 0, review: 1, info: 2, pass: 3, na: 4 };
const byTone = (rows: RuleRow[]) =>
  rows.map((r, i) => [r, i] as const).sort(([a, i], [b, j]) => (ORDER[a.outcome] - ORDER[b.outcome]) || i - j).map(([r]) => r);

/** R01-R11 (the match decisions) as rule rows */
export function businessRules(business: (BusinessRuleView & { via?: string[] })[]): RuleRow[] {
  return business.map((b) => {
    const values: Fact[] = [{ label: "What it checks", value: b.what || "—" }];
    b.next.forEach((n, i) => values.push({ label: i ? `Next (${i + 1})` : "Next", value: n }));
    if (b.via && b.via.length) values.push({ label: "Found via", value: b.via.join(", ") });
    return { id: b.id, name: b.name, outcome: toTone(b.tone), outcomeLabel: b.status, detail: b.reason, values };
  });
}

/** the loan-history policy checks as rule rows */
export function historyRules(v: DedupeView): RuleRow[] {
  return v.rules.map((r, i) => {
    const values: Fact[] = [];
    if (r.view.what) values.push({ label: "What it checks", value: r.view.what });
    if (r.value) values.push({ label: "Value", value: r.value, mono: true });
    if (r.nextAction) values.push({ label: "Next", value: r.nextAction });
    return {
      id: r.id || `CHK-${i + 1}`, name: r.view.title, outcome: toTone(r.view.tone), outcomeLabel: r.view.status,
      severity: r.severity ? label(r.severity) : undefined, detail: r.view.reason, values: values.length ? values : undefined,
    };
  });
}

/** "6 passed · 0 failed · 4 limit not set" */
export function checkCounts(v: DedupeView): string {
  const n = (t: string) => v.rules.filter((r) => r.view.tone === t).length;
  const limits = v.rules.filter((r) => r.view.tone === "skip" && r.reason === "THRESHOLD_UNCONFIGURED").length;
  const other = n("skip") - limits;
  return [`${n("pass")} passed`, `${n("fail")} failed`, limits ? `${limits} limit not set` : null,
    other ? `${other} not checked` : null].filter(Boolean).join(" · ");
}

const IDC_WORD: Record<string, string> = { MATCH: "Same", MISMATCH: "Different", NOT_COMPARED: "Not compared" };
const IDC_TONE: Record<string, Tone> = { MATCH: "pass", MISMATCH: "fail" };

export interface ViewOptions {
  text: UiText;
  entered?: Entered;
  /** the page's own working handler: run the same check again */
  onRerun?: () => void;
}

export function presentActions(onRerun?: () => void): ActionItem[] {
  return [
    { id: "report", label: "Download report", kind: "ghost", icon: "download" },
    ...(onRerun ? [{ id: "rerun", label: "Run check again", kind: "secondary" as const, icon: "arrow", onClick: onRerun }] : []),
    { id: "hold", label: "Hold", kind: "warning", icon: "pause" },
    { id: "decline", label: "Decline", kind: "danger", icon: "x" },
    { id: "submit", label: "Proceed", kind: "primary", icon: "send" },
  ];
}

/** One parameter's dedupe + loan-history answer in the common layout. */
export function toResultPage(v: DedupeView, { text, entered, onRerun }: ViewOptions): ResultPageProps {
  const roleWord = makeRoleWord(text);
  const head = v.headline || v.outcomeView;
  const decision = v.dedupe ? { label: v.dedupe.label, tone: toTone(v.dedupe.tone) } : { label: head.title, tone: toTone(head.tone) };
  const party = roleWord(v.checkedParty, "parties");
  const business = businessRules(v.business);
  const history = historyRules(v);
  const count = (t: Tone) => business.filter((b) => b.outcome === t).length;

  const facts: Fact[] = [
    { label: "Case ID", value: v.caseId || "—", mono: true },
    { label: "Checked for", value: party || "—" },
    { label: "Searched by", value: C.searchedLabel(v.searched) },
    { label: "MIFIN customer", value: v.match.ref && v.match.ref !== "—" ? v.match.ref : "—", mono: true },
  ];
  if (v.dedupe) facts.push({ label: "Recommended", value: v.dedupe.action });
  if (v.stage) facts.push({ label: "Stage", value: v.stage });
  facts.push({ label: "Request", value: v.requestId || "—", mono: true });
  const kpis: Kpi[] = [
    { label: "Previous loans", value: v.totals || v.history.status === "NO_PREVIOUS_LOANS" ? v.history.count : "—", tone: "info" },
    { label: "Rules found", value: count("fail"), tone: "fail" },
    { label: "Not fully checked", value: count("review"), tone: "review" },
    { label: "Rules clear", value: count("pass"), tone: "pass" },
  ];

  // 2. the reason: the officer-facing note, then the AI-worded (or deterministic) points
  const e = v.explanation;
  const fromLlm = e.pointsSource === "LLM" || (!e.points.length && e.source === "LLM");
  const points = e.points.length ? e.points : sentences(e.text || "").slice(0, 3);
  const all = [head.note, ...points].filter((p): p is string => Boolean(p && p.trim()));
  if (v.dedupe && !v.dedupe.complete && v.dedupe.missing.length) all.push(`Not complete: ${v.dedupe.missing.join(", ")}.`);

  // 3b. calculations
  const rows: CalcRow[] = [];
  const G1 = "Match";
  rows.push({ group: G1, label: "Customer", value: v.customer.label, tone: toTone(v.customer.tone) });
  rows.push({ group: G1, label: "MIFIN match", value: v.match.label,
    tone: v.match.code === "CONFIRMED_MATCH" ? "pass" : ["SOURCE_ERROR", "UNAVAILABLE", "MALFORMED"].includes(v.match.code) ? "fail" : "review" });
  if (v.match.role) rows.push({ group: G1, label: "Role in MIFIN", value: roleWord(v.match.role) });
  if (v.typeCheck) rows.push({ group: G1, label: "Customer type", value: label(v.typeCheck.result),
    tone: v.typeCheck.result === "CONSISTENT" ? "pass" : "review" });
  const ic = (v.identityCheck || {}) as Record<string, string | undefined>;
  ([["searched_identifier", C.searchedLabel(v.searched)], ["name", "Name"], ["dob", "Date of birth"]] as const).forEach(([k, what]) => {
    if (!ic[k]) return;
    rows.push({ group: G1, label: `${what} vs MIFIN`, value: IDC_WORD[ic[k]!] || label(ic[k]), tone: IDC_TONE[ic[k]!] || "na" });
  });
  if (v.otherCases.length) rows.push({ group: G1, label: "Other LOS cases", value: v.otherCases.length, tone: "review" });

  const G2 = "Existing loans";
  rows.push({ group: G2, label: "History", value: v.history.label, tone: toTone(v.history.tone) });
  if (v.totals) {
    const t = v.totals;
    rows.push({ group: G2, label: "Previous loans", value: v.history.count,
      hint: Object.entries(t.byStatus).map(([s, n]) => `${n} ${label(s).toLowerCase()}`).join(" · ") || undefined });
    const miss = (x: { missing?: string[]; reason?: string | null }) =>
      (x.missing && x.missing.length ? `Missing: ${x.missing.join(", ")}` : x.reason ? label(x.reason) : undefined);
    rows.push({ group: G2, label: "Live exposure", value: t.exposure.label, tone: toTone(t.exposure.tone), hint: miss(t.exposure) });
    rows.push({ group: G2, label: "Monthly EMI", value: t.emi.label, tone: toTone(t.emi.tone), hint: miss(t.emi) });
    rows.push({ group: G2, label: "Worst DPD (12 m)", value: t.dpd, tone: t.dpd === "Unavailable" ? "na" : undefined });
    if (t.conflicts) rows.push({ group: G2, label: "Conflicting records", value: t.conflicts, tone: "review", hint: "not counted" });
  } else {
    rows.push({ group: G2, label: "Previous loans", value: v.history.status === "NO_PREVIOUS_LOANS" ? 0 : "Unavailable",
      tone: v.history.status === "NO_PREVIOUS_LOANS" ? "pass" : "na" });
  }
  if (v.history.withheld) rows.push({ group: G2, label: "Hidden until confirmed", value: v.history.withheld, tone: "review" });

  const G3 = "Checks";
  rows.push({ group: G3, label: "Loan history checks", value: checkCounts(v) });
  rows.push({ group: G3, label: "All checks evaluated", value: v.complete ? "Yes" : "No", tone: v.complete ? "pass" : "review" });

  const G4 = "Sources";
  for (const s of v.sources) {
    const line = C.sourceLine(s, text);
    rows.push({ group: G4, label: line.name, value: line.state, tone: toTone(line.tone) });
  }

  const G5 = "Policy";
  const pol = `${v.policy?.policy_id || ""} ${v.policy?.policy_version || ""}`.trim();
  if (pol) rows.push({ group: G5, label: "Policy", value: pol, hint: v.policy?.signed_off ? undefined : "not signed off",
    tone: v.policy?.signed_off ? undefined : "review" });
  if (v.timings.total_ms !== undefined) rows.push({ group: G5, label: "Time", value: `${Math.round(v.timings.total_ms)} ms` });

  return {
    basic: {
      eyebrow: "Credit underwriting · Dedupe & loan history",
      title: entered?.name || (v.caseId ? `Case ${v.caseId}` : "Existing-customer check"),
      subtitle: `${head.title}${party ? ` · ${party}` : ""}`,
      icon: "users",
      decision, facts, kpis,
    },
    summary: {
      title: "Why this recommendation", points: all, source: fromLlm ? "AI summary" : "From the verified result",
      loading: e.pending && !all.length, empty: "No summary available.",
    },
    rules: { title: "Dedupe rules", rules: [...byTone(business), ...byTone(history)], empty: "No rules were run." },
    calculations: { title: "Match & loans", rows, pageSize: 12 },
    actions: presentActions(onRerun),
  };
}

/** Every parameter at once: one combined decision, a row per parameter. */
export function toAllResultPage(a: AllView, { text, entered, onRerun }: ViewOptions): ResultPageProps {
  const t = (text.all_parameters || {}) as Record<string, string>;
  const caseId = a.rows.find((r) => r.view.caseId)?.view.caseId || "";
  const business = businessRules(a.business);
  const count = (tone: Tone) => business.filter((b) => b.outcome === tone).length;
  const rows: CalcRow[] = a.rows.map((r) => ({
    group: "Parameters", label: r.label, value: r.decision, tone: toTone(r.tone),
    hint: [r.match, r.customer ? `customer ${r.customer}` : null].filter(Boolean).join(" · ") || undefined,
  }));
  a.missing.forEach((m) => rows.push({ group: "Parameters", label: m, value: t.missing || "Not checked", tone: "na" }));
  return {
    basic: {
      eyebrow: `Credit underwriting · ${t.title || "All parameters"}`,
      title: entered?.name || (caseId ? `Case ${caseId}` : t.title || "All parameters"),
      subtitle: `${a.rows.length} parameter${a.rows.length === 1 ? "" : "s"} checked`,
      icon: "users",
      decision: { label: a.combined.label, tone: toTone(a.combined.tone) },
      facts: [
        { label: "Case ID", value: caseId || "—", mono: true },
        { label: "Checked", value: a.rows.map((r) => r.label).join(", ") || "—" },
        { label: "Request", value: a.requestId || "—", mono: true },
      ],
      kpis: [
        { label: "Parameters checked", value: a.rows.length, tone: "info" },
        { label: "Not checked", value: a.missing.length, tone: a.missing.length ? "review" : "na" },
        { label: "Rules found", value: count("fail"), tone: "fail" },
        { label: "Rules clear", value: count("pass"), tone: "pass" },
      ],
    },
    summary: {
      title: "Why this decision", source: "From the verified result",
      points: [a.consistency.text, ...a.combined.reasons, ...(a.consistency.byParameter.length > 1 ? a.consistency.byParameter : [])]
        .filter((p) => Boolean(p && String(p).trim())),
    },
    rules: { title: "Dedupe rules", rules: byTone(business) },
    calculations: { title: "Parameters", rows, pageSize: 12 },
    actions: presentActions(onRerun),
  };
}
