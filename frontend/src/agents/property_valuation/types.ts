// Shapes of the property valuation API (/api/v1/credit/property-valuation) the screen reads.

export interface Property {
  collateral_property_id: number | string;
  property_owner?: string | null;
  property_type?: string | null;
  collateral_type?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  vendor_request_prefill?: Record<string, unknown> | null;
  [k: string]: unknown;
}

export interface Application {
  application_number: string;
  applicant_name?: string | null;
  properties: Property[];
}

export interface Discrepancy {
  field?: string | null;
  applicant_value?: unknown;
  source_value?: unknown;
  reason?: string | null;
}

export interface RuleEval {
  rule_id?: string | null;
  rule_number?: string | number | null;
  rule_name?: string | null;
  severity?: string | null;
  triggered?: boolean;
  issue?: string | null;
  recommended_action?: string | null;
  discrepancies?: Discrepancy[];
}

export interface ValuationResult {
  result_id?: number | string;
  verification_id?: number | string;
  vendor_status?: string | null;
  summary?: {
    agent_status?: string;
    total_rules_checked?: number;
    total_rules_triggered?: number;
    total_rules_passed?: number;
    recommended_actions?: string[];
  };
  evaluation?: { results?: RuleEval[] };
}

export interface RuleConfig {
  rule_key: string;
  original_id?: string;
  name: string;
  description?: string | null;
  enabled: boolean;
  sequence: number;
  severity: string;
  fields?: Record<string, unknown>;
  settings?: Record<string, unknown>;
}

export interface History {
  verifications: {
    verification_id: number; collateral_property_id: number | string; verification_type?: string;
    vendor_status?: string | null; created_at?: string | null;
  }[];
  agent_results: {
    result_id: number; collateral_property_id: number | string; vendor_status?: string | null; agent_status: string;
    total_rules_triggered: number; critical_issues_count: number; created_at?: string | null;
  }[];
}

/** the values of a form: text as typed, checkboxes as booleans */
export type FormValues = Record<string, string | boolean>;
