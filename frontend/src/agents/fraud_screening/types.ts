// Shapes of the fraud screening API (/api/v1/credit/fraud-screening) the screen reads.

export interface RuleConfig {
  rule_key: string;
  rule_id: string;
  rule_name: string;
  description?: string | null;
  severity: string;
  enabled: boolean;
  is_implementable: boolean;
  config_json?: Record<string, unknown>;
  sort_order?: number;
}

export interface RuleResult {
  rule_key?: string;
  rule?: string | null;
  name?: string | null;
  severity?: string | null;
  triggered?: boolean;
  enabled?: boolean;
  message?: string | null;
  /** the two sides a rule compared, when it has them: what this application says | what it was compared with */
  compare?: { field: string; application: string; other: string }[];
  /** the matching records of a rule as objects (Rule 15: score, application, customer_id, family_link, address) */
  records?: Record<string, string | number | null>[];
}

export interface Comparison {
  field: string;
  applicant?: string[] | null;
  record?: string[] | null;
  status: string;
  note?: string | null;
}

export interface ScreenRecord {
  name?: string | null;
  agency?: string | null;
  list_type?: string | null;
  match_percent?: number | null;
  matched_fields?: string[];
  partial_fields?: string[];
  tags?: string[];
  comparison?: Comparison[];
  facts?: { label: string; value: unknown }[];
  source_links?: string[];
}

/** POST /aml_check and /pep_check answer in the same shape; it arrives inside the evaluation as `aml` / `pep` */
export interface Screening {
  status?: string;
  error?: string;
  source?: string;
  summary?: string;
  threshold_percent?: number;
  total_records?: number;
  request_id?: string | null;
  strong_matches?: ScreenRecord[];
  other_matches?: ScreenRecord[];
  [k: string]: unknown;
}

export interface Evaluation {
  application_number: string;
  application_id?: number | null;
  result_id?: number | null;
  risk_level?: string;
  is_potential_fraud?: boolean;
  fraud_warning?: string;
  skipped_rules?: string[];
  rule_results?: RuleResult[];
  aml?: Screening | null;
  pep?: Screening | null;
  [k: string]: unknown;
}

export type ScreenKind = "aml" | "pep";
