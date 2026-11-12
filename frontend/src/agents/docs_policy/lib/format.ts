// Wording and small helpers ported from the old app.js. Every status comes from the backend; this decides nothing.
import type { Board, DocCell, DocRow, Filter, Requirement, Role, Tone } from "../types";

export const FILTER_WORD: Record<Filter, string> = { bad: "Critical", approval: "Approval", warn: "To collect", ok: "Verified" };
export const FILTER_EMPTY: Record<Filter, string> = {
  bad: "Nothing critical", approval: "Nothing awaiting approval", warn: "Nothing to collect", ok: "Nothing verified yet",
};
export const ROLES: Record<string, string> = { PRIMARY_APPLICANT: "Applicant", CO_APPLICANT: "Co-applicant" };
export const ROUTE_TONE: Record<string, [Tone, string]> = {
  MOVE_AHEAD: ["ok", "✓"], MOVE_AHEAD_WITH_NOTES: ["ok", "✓"], REFER_TO_AUTHORITY: ["bad", "↑"], AWAIT_APPROVAL: ["warn", "…"],
};
export const RULE_TONE: Record<string, Tone> = { PASS: "ok", WARN: "warn", FAIL: "bad", "N/A": "na", OFF: "na" };
export const RULE_WORD: Record<string, string> = {
  PASS: "Pass", WARN: "To collect", FAIL: "Critical", "N/A": "Not applicable", OFF: "Switched off",
};
export const DONE = new Set(["SATISFIED", "WAIVED"]);
export const OPEN_WORD: Record<string, string> = {
  PENDING_VERIFICATION: "Being verified", UNDER_REVIEW: "With reviewer", EXCEPTION_PENDING: "Awaiting approval",
  MISMATCH: "Mismatch", UNRESOLVED: "Can't check", ACTION_REQUIRED: "Action needed",
};

export const money = (v: unknown): string =>
  v == null || v === "" || isNaN(Number(v)) ? "—" : "₹" + Number(v).toLocaleString("en-IN");
export const words = (v: unknown): string =>
  String(v || "").replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
export const initials = (name: unknown): string =>
  String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
/** width class w0..w10 (the old CSP allowed no inline styles; the classes stay) */
export const tenth = (n: number, of: number): number => (of ? Math.round((n / of) * 10) : 0);
/** a whole sentence: cut at a full stop only ("…gave the ITR; it needs its ITR computation." stays whole) */
export const firstSentence = (t: unknown): string => {
  const s = String(t || "");
  const i = s.search(/\.\s/);
  return i > 0 ? s.slice(0, i + 1) : s;
};
export const rest = (t: unknown): string => {
  const s = String(t || "");
  const i = s.search(/[.;:]\s+(?=[A-Z(])/);
  return i > 0 ? s.slice(i + 1).trim() : "";
};
export const clock = (d: Date | null): string =>
  d ? d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—";
export const normalise = (raw: unknown): string => String(raw || "").trim().toUpperCase().replace(/\s+/g, "");
export const VALID_CASE_ID = /^[A-Z0-9._:-]+$/;

export function personName(board: Board, role: Role | null | undefined): string | null | undefined {
  const c = board.case;
  return role === "PRIMARY_APPLICANT" ? c.applicant_name : role === "CO_APPLICANT" ? c.co_applicant_name : null;
}

export type Look = [Tone, string, string];

/** tone (ok / warn / bad), icon, short status line for a checklist cell -- from the backend's state + severity */
export function docLook(c: DocCell): Look {
  if (c.state === "OK") return ["ok", "✓", c.file ? `Verified · ${c.file}` : "Verified"];
  if (c.state === "WAIVED") return ["ok", "✓", "Waived by an approved exception"];
  if (c.state === "AWAITING_APPROVAL") return ["warn", "…", "Exception awaiting approval"];
  const tone: Tone = c.blocking ? "bad" : "warn";
  const issue = c.reasons.length > 1 ? firstSentence(c.reasons[1]) : firstSentence(c.reasons[0]);
  const lines: Record<string, string> = {
    MISSING: "Missing · ask the customer", REPLACE: c.blocking ? "Rejected · a new one is needed" : "Needs a fresh copy",
    ISSUE: issue, MINOR: issue, IN_REVIEW: "Being verified", CHECK: "Could not be checked · re-check",
  };
  const line = lines[c.state] || words(c.state);
  const icon = ({ MISSING: "✕", REPLACE: "↻", IN_REVIEW: "…" } as Record<string, string>)[c.state] || "!";
  return [tone, icon, line];
}

/** which banner count a document belongs to: an exception awaiting approval is its own group, not "to collect" */
export const group = (cell: DocCell, look: Look): Filter => (cell.state === "AWAITING_APPROVAL" ? "approval" : look[0] as Filter);

export interface DocItem { row: DocRow; cell: DocCell; look: Look; group: Filter }

export function docsFor(board: Board, role: Role): DocItem[] {
  const order: Record<string, number> = { bad: 0, warn: 1, ok: 2 };
  return board.documents.rows
    .filter((r) => r.cells[role])
    .map((r) => {
      const cell = r.cells[role];
      const look = docLook(cell);
      return { row: r, cell, look, group: group(cell, look) };
    })
    .sort((a, b) => order[a.look[0]] - order[b.look[0]]);
}

/** the document a requirement is about: its slot when the check names one, else the row whose reasons name that document */
export function slotOf(board: Board, q: Requirement): { slot: string; role: Role } | null {
  const role = q.party_role;
  if (!role) return null;
  const rows = board.documents.rows.filter((r) => r.cells[role]);
  const kind = String(q.check_id || "").split(":").pop() || "";
  const hit = rows.find((r) => r.slot === kind)
    || rows.find((r) => r.cells[role].reasons.some((t) => t.toLowerCase().includes(words(kind).toLowerCase())));
  return hit ? { slot: hit.slot, role } : null;
}

export const who = (board: Board, q: { party_role?: Role | null }): string =>
  q.party_role ? `${personName(board, q.party_role) || ROLES[q.party_role]}: ` : "";

export interface BriefGroups { critical: Requirement[]; approval: Requirement[]; collect: Requirement[] }

export function briefGroups(board: Board): BriefGroups {
  const reqs = board.answer.requirements;
  return {
    critical: reqs.filter((q) => q.severity === "BLOCKING" && q.status !== "EXCEPTION_PENDING"),
    approval: reqs.filter((q) => q.status === "EXCEPTION_PENDING"),
    collect: reqs.filter((q) => q.severity !== "BLOCKING"),
  };
}

export function briefText(board: Board, { critical, approval, collect }: BriefGroups): string {
  const { case: c, answer: a } = board;
  const s = a.summary;
  const block = (title: string, items: Requirement[]) =>
    items.length ? [``, `${title}:`, ...items.map((q) => `- ${who(board, q)}${firstSentence(q.reason)}`)] : [];
  return [
    `${c.case_id} · ${c.applicant_name || ""}${c.co_applicant_name ? ` & ${c.co_applicant_name}` : ""} · ${words(a.product)} · ${money(c.loan_amount)}`,
    `${s.route.label}: ${s.route.text}`,
    ``, s.ai_summary.text || s.headline,
    ...block("Critical", critical), ...block("Awaiting approval", approval), ...block("To collect", collect),
    ``, `Next step: ${s.next_step}`,
  ].join("\n");
}

/** The file rule checks UPLOADED files only: name the documents that have no file yet, so a pass is not misread. */
export function notUploaded(board: Board): string[] {
  const rows: string[] = [];
  for (const r of board.documents.rows) {
    for (const [role, c] of Object.entries(r.cells)) {
      if (c.state === "MISSING") rows.push(`${r.label} (${personName(board, role) || ROLES[role]})`);
    }
  }
  // supporting documents that are not on file (e.g. an ITR's computation), with whose they are
  for (const q of board.answer.requirements.filter((x) => x.rule_id === "RULE-07" && x.status === "ACTION_REQUIRED")) {
    const m = /needs its (.+?)\.?$/i.exec(q.reason || "");
    const what = m ? m[1].charAt(0).toUpperCase() + m[1].slice(1) : q.reason;
    const role = q.party_role || "";
    rows.push(`${what} (${personName(board, role) || ROLES[role] || "case"})`);
  }
  return rows;
}
