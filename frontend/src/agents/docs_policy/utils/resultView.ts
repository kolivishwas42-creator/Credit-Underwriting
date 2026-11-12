// The readiness board (POST /api/v1/credit/document-readiness/{case_id}/rules) in the console's COMMON RESULT LAYOUT:
//   basic card -> AI summary -> rules | calculations -> actions.
// Pure: no React state, no fetch. Every status comes from the backend; this decides nothing.
//
// Tone mapping (the desk's own tones -> the layout's Tone):
//   route MOVE_AHEAD / MOVE_AHEAD_WITH_NOTES -> pass,  AWAIT_APPROVAL -> review,  REFER_TO_AUTHORITY -> fail
//   rule  PASS -> pass,  WARN (to collect) -> review,  FAIL (critical) -> fail,  N/A and OFF -> na
//   document ok -> pass,  warn / approval -> review,  bad -> fail
import { clock, docLook, docsFor, money, personName, ROLES, ROUTE_TONE, RULE_TONE, RULE_WORD, words } from "../lib/format";
import type { ActionItem, CalcRow, Fact, Kpi, ResultPageProps, RuleRow, Tone } from "../../../shared/components";
import type { Board, Filter, Tone as DeskTone } from "../types";

/** a note as points: one per line when the text is already a list ("1. …\n2. …"), else split at a full stop followed
 *  by a capital ("…ITR; it needs its ITR computation." stays whole). The list numbers / bullets are dropped (the layout
 *  numbers the points) and a lone "1." never becomes a point of its own. */
export const sentences = (text: unknown): string[] => {
  const raw = String(text || "");
  const lines = raw.split(/\n+|\s+(?=\d{1,2}[.)]\s+[A-Z(])/);
  const parts = lines.length > 1 ? lines : raw.split(/(?<=[a-z0-9)\]%'"’”]\.)\s+(?=[A-Z(])/);
  return parts
    .map((t) => t.replace(/^\s*(?:\d{1,2}[.)]|[•*\-–])\s*/, "").trim())
    .filter((t) => t.length > 2 && !/^\d+[.)]?$/.test(t));
};

const DESK_TONE: Record<DeskTone | "approval", Tone> = { ok: "pass", warn: "review", bad: "fail", na: "na", approval: "review" };
export const toTone = (t: string | null | undefined): Tone => DESK_TONE[(t || "na") as DeskTone] ?? "na";

/** the banner counts: Critical / (Approval) / To collect / Verified -- the same numbers the filter buttons use */
export function boardCounts(board: Board): [Filter, number][] {
  const { answer: a, documents: d } = board;
  const route = a.summary.route;
  const verified = d.rows.reduce((n, r) => n + Object.values(r.cells).filter((c) => docLook(c)[0] === "ok").length, 0);
  const approval = a.requirements.filter((q) => q.status === "EXCEPTION_PENDING").length;
  return [["bad", route.critical], ...(approval ? [["approval", approval] as [Filter, number]] : []),
    ["warn", route.non_critical], ["ok", verified]];
}

const COUNT_WORD: Record<Filter, string> = { bad: "Critical", approval: "Approval", warn: "To collect", ok: "Verified" };

/** the eleven policy rules as rule rows (RULE-xx, in the policy's order) */
export function policyRules(board: Board): RuleRow[] {
  const section = new Map<string, string>();
  for (const s of board.sections) for (const id of s.rules) section.set(id, s.name);
  return board.rules.map((r) => {
    const values: Fact[] = [];
    if (section.get(r.rule_id)) values.push({ label: "Section", value: section.get(r.rule_id) });
    if (r.explain || r.help) values.push({ label: "What it checks", value: r.explain || r.help });
    if (r.status !== "OFF") values.push({ label: "Checks passed", value: `${r.passed} of ${r.total}` });
    const open = r.checks.filter((c) => !["SATISFIED", "WAIVED"].includes(c.status));
    open.slice(0, 4).forEach((c, i) => values.push({ label: i ? `Open (${i + 1})` : "Open", value: c.reason }));
    if (open.length > 4) values.push({ label: "More", value: `${open.length - 4} more open check(s) — open the rule in the left rail` });
    return {
      id: r.rule_id, name: r.name, outcome: RULE_TONE[r.status] ? toTone(RULE_TONE[r.status]) : "na",
      outcomeLabel: RULE_WORD[r.status] || r.status,
      detail: r.status === "OFF" ? "Switched off in the policy." : r.total ? `${r.passed} of ${r.total} checks passed` : "Nothing to check on this case.",
      values,
    };
  });
}

export interface BoardOptions {
  checkedAt?: Date | null;
  /** the desk's own working handlers */
  onRecheck?: () => void;
}

export function toResultPage(board: Board, { checkedAt = null, onRecheck }: BoardOptions = {}): ResultPageProps {
  const { case: c, answer: a } = board;
  const s = a.summary;
  const route = s.route;
  const counts = boardCounts(board);

  // 1. basic card
  const facts: Fact[] = [
    { label: "Case ID", value: c.case_id, mono: true },
    { label: "Loan amount", value: money(c.loan_amount) },
    { label: "Product", value: words(a.product) || "—" },
    { label: "Stage", value: a.stage || "—" },
    { label: "Policy", value: `${a.policy_version}${a.audit.policy_status !== "APPROVED" ? ` · ${a.audit.policy_status}` : ""}` },
    { label: "Underwriting", value: a.credit_underwriting_allowed ? "Can start" : "Not yet" },
    { label: "Checked", value: clock(checkedAt) },
  ];
  const kpis: Kpi[] = counts.map(([f, n]) => ({ label: COUNT_WORD[f], value: n, tone: toTone(f) }));

  // 2. summary: the brief's note as points, what the route means, the next step
  const ai = s.ai_summary.source === "ai";
  const points = [...sentences(s.ai_summary.text || s.headline), route.text,
    `Next step: ${s.next_step}`,
    ...(route.decision === "REFER_TO_AUTHORITY" || route.decision === "AWAIT_APPROVAL" ? [`Higher authority: ${route.authority}`] : [])]
    .filter((p) => Boolean(p && p.trim()));

  // 3b. calculations: documents per person, per status; rules per status
  const rows: CalcRow[] = [];
  const people = board.documents.people.length ? board.documents.people : ["PRIMARY_APPLICANT"];
  for (const role of people) {
    const docs = docsFor(board, role);
    const n = (g: Filter) => docs.filter((x) => x.group === g).length;
    const name = (s.people || {})[role]?.name || personName(board, role);
    const group = `${ROLES[role] || words(role)}${name ? ` · ${name}` : ""}`;
    rows.push({ group, label: "Verified", value: `${n("ok")} of ${docs.length}`, tone: docs.length && n("ok") === docs.length ? "pass" : undefined });
    rows.push({ group, label: "Critical", value: n("bad"), tone: n("bad") ? "fail" : undefined });
    if (n("approval")) rows.push({ group, label: "Awaiting approval", value: n("approval"), tone: "review" });
    rows.push({ group, label: "To collect", value: n("warn"), tone: n("warn") ? "review" : undefined });
  }
  const total = counts.reduce((x, [, v]) => x + v, 0);
  for (const [f, v] of counts) rows.push({ group: "All documents", label: COUNT_WORD[f], value: v, tone: v ? toTone(f) : undefined });
  rows.push({ group: "All documents", label: "Total", value: total });
  const ruleCount = (st: string) => board.rules.filter((r) => r.status === st).length;
  for (const st of ["PASS", "WARN", "FAIL", "N/A", "OFF"]) {
    const v = ruleCount(st);
    if (v) rows.push({ group: "Rules", label: RULE_WORD[st] || st, value: v, tone: toTone(RULE_TONE[st]) });
  }

  // 4. actions: Re-check is the desk's own; the rest are presentational (no copy buttons in production, owner 2026-11-11)
  const actions: ActionItem[] = [
    { id: "report", label: "Download report", kind: "ghost", icon: "download" },
    { id: "recheck", label: "Re-check", kind: "secondary", icon: "arrow", ...(onRecheck ? { onClick: onRecheck } : {}) },
    { id: "hold", label: "Hold", kind: "warning", icon: "pause" },
    { id: "refer", label: "Refer to authority", kind: "danger", icon: "flag" },
    { id: "submit", label: "Send to underwriting", kind: "primary", icon: "send" },
  ];

  const tone = (ROUTE_TONE[route.decision] || ["na"])[0];
  return {
    basic: {
      eyebrow: "Credit underwriting · Document Desk",
      title: c.applicant_name || c.case_id,
      subtitle: [c.co_applicant_name ? `& ${c.co_applicant_name}` : null, words(a.product) || null, a.stage || null].filter(Boolean).join(" · ") || undefined,
      icon: "receipt",
      decision: { label: route.label, tone: toTone(tone) },
      facts, kpis,
    },
    summary: { title: "Underwriter brief", points, source: ai ? "AI summary" : "Rules summary", empty: "No brief yet." },
    rules: { title: "Policy rules", rules: policyRules(board) },
    calculations: { title: "Documents", rows, pageSize: 12 },
    actions,
  };
}
