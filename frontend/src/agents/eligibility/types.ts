// Shapes of the eligibility API (/api/v1/eligibility) the screen reads.

export interface FieldSpec {
  key: string;
  label: string;
  /** absent / "amount" / "int" / "percent" are numbers; "text" and "select" are not */
  type?: string;
  group?: string | null;
  required?: boolean;
  sample?: unknown;
  options?: Record<string, string>;
}

export interface MethodSpec {
  label: string;
  fields: FieldSpec[];
}

export interface Form {
  editable: FieldSpec[];
  case_fields: { key: string; label: string }[];
  products: string[];
  income_methods: Record<string, MethodSpec>;
  topup_types: Record<string, MethodSpec>;
  collateral_types: Record<string, string>;
  occupancy_types: Record<string, string>;
  existing_exposure_label: string;
}

export interface CaseRow {
  case_id: string;
  product?: string | null;
  label?: string | null;
}

export type Inputs = {
  product?: string | null;
  income?: Record<string, unknown> & { method?: string };
  topup?: Record<string, unknown> & { type?: string };
  collateral_type?: string;
  occupancy_type?: string;
  existing_exposure?: number;
} & Record<string, unknown>;

export interface Saved {
  saved_at: string;
  inputs?: Inputs;
}

export interface CasePayload {
  case_id: string;
  case?: Record<string, unknown>;
  saved?: Saved | null;
}

export interface Check {
  label: string;
  result: string;
  value?: unknown;
  limit?: unknown;
}

export interface CheckResult {
  case_id?: string;
  decision: string;
  summary?: string;
  offer?: { amount?: number; range?: string; emi?: number; tenure_months?: number; rate_percent?: number } | null;
  checks?: Check[];
  what_it_takes?: string[];
  next_steps?: string[];
  missing_fields?: string[];
  working?: Record<string, string>;
  run_id?: string | null;
}

/** what the entry card holds: every input as typed (strings), the dropdowns as chosen */
export interface Entry {
  product: string;
  loan: Record<string, string>;
  incomeMethod: string;
  income: Record<string, string>;
  topupType: string;
  topup: Record<string, string>;
  collateral: string;
  occupancy: string;
  existingExposure: string;
}
