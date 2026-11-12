// The shapes of POST /api/v1/credit/document-readiness/{case_id}/rules, as this page uses them.
// Built by backend/agents/docs_policy/api/routes.py (dashboard_rules): models/response.py (answer) and
// services/board_service.py (rules, sections, documents). The answer is dumped with exclude_none, so optional fields
// may be absent.

export type Role = "PRIMARY_APPLICANT" | "CO_APPLICANT" | string;

export interface CaseInfo {
  case_id: string;
  applicant_name?: string | null;
  co_applicant_name?: string | null;
  loan_amount?: number | string | null;
  employment_type?: string | null;
  co_applicant_employment_type?: string | null;
}

export type RequirementStatus = "ACTION_REQUIRED" | "PENDING_VERIFICATION" | "UNDER_REVIEW" | "MISMATCH" | "UNRESOLVED"
  | "EXCEPTION_PENDING";
export type Severity = "BLOCKING" | "NON_BLOCKING";

export interface Requirement {
  rule_id: string;
  rule_name: string;
  check_id: string;
  status: RequirementStatus;
  severity: Severity;
  party_role?: Role | null;
  party_id?: string | null;
  missing_documents?: string[] | null;
  reason: string;
  recommended_action: string;
  evidence?: string[] | null;
  deviation_codes?: string[] | null;
}

export interface Audit {
  evaluation_id: string;
  evaluation_status: "COMPLETED";
  evaluated_at: string;
  policy_id: string;
  policy_version: string;
  policy_status: string;
  recorded: boolean;
  replayed: boolean;
  rules_disabled?: string[];
  [key: string]: unknown;
}

export type RouteDecision = "MOVE_AHEAD" | "MOVE_AHEAD_WITH_NOTES" | "REFER_TO_AUTHORITY" | "AWAIT_APPROVAL";

export interface Route {
  decision: RouteDecision;
  label: string;
  text: string;
  critical: number;
  non_critical: number;
  authority: string;
}

export interface PersonStatus {
  name?: string | null;
  open: number;
  critical: number;
}

export interface AiNote {
  text: string;
  source: "ai" | "rules";
  pending?: boolean | null;
}

export interface Summary {
  headline: string;
  route: Route;
  missing: string[];
  minor_missing?: string[];
  not_satisfied: string[];
  people?: Record<string, PersonStatus>;
  next_step: string;
  ai_summary: AiNote;
}

export interface Answer {
  request_id: string;
  application_id: string;
  stage?: string | null;
  product?: string | null;
  policy_version: string;
  overall_status: "COMPLETE" | "ACTION_REQUIRED" | "EXCEPTION_PENDING";
  requirements: Requirement[];
  recommended_action: string;
  credit_underwriting_allowed: boolean;
  audit: Audit;
  summary: Summary;
}

export type RuleStatus = "PASS" | "WARN" | "FAIL" | "N/A" | "OFF";

export interface RuleCheck {
  check_id: string;
  status: string;                      // SATISFIED / WAIVED / ACTION_REQUIRED / ...
  severity: Severity;
  party_role?: Role | null;
  reason: string;
}

export interface Rule {
  rule_id: string;
  name: string;
  help: string;
  explain: string;
  status: RuleStatus;
  passed: number;
  total: number;
  checks: RuleCheck[];
}

export interface Section {
  id: string;
  name: string;
  help: string;
  rules: string[];
  counts: Record<RuleStatus, number>;
}

export type CellState = "OK" | "ISSUE" | "MINOR" | "WAIVED" | "AWAITING_APPROVAL" | "IN_REVIEW" | "REPLACE" | "MISSING"
  | "CHECK";

export interface DocCell {
  state: CellState | string;
  blocking: boolean;
  reasons: string[];
  accepts?: string[];
  rule_id?: string;
  file?: string | null;
}

export interface DocRow {
  slot: string;
  label: string;
  cells: Record<string, DocCell>;
}

export interface Documents {
  people: Role[];
  rows: DocRow[];
}

export interface Board {
  case: CaseInfo;
  answer: Answer;
  rules: Rule[];
  sections: Section[];
  documents: Documents;
}

/** a recent case remembered in this browser only */
export interface RecentItem {
  id: string;
  name: string;
  tone: string;
}

export type Tone = "ok" | "warn" | "bad" | "na";
export type Filter = "bad" | "approval" | "warn" | "ok";
