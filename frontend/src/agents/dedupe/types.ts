// Shared types of the Dedupe page. core.ts's types first; UI types may be appended below.

/** Raw JSON from the backend or from public/*.json (ui_text, sample_config). Its shapes are wide and evolve with the
 * backend; core.ts reads them defensively exactly as the original core.js did, so they stay loosely typed here. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;
/** public/ui_text.json */
export type UiText = Json;
/** public/sample_config.json */
export type SampleConfig = Json;
/** A POST /api/v1/credit/dedupe answer (validated by viewResult, which throws on a body that is not the contract). */
export type DedupeAnswer = Json;
/** A POST /api/v1/credit/dedupe/all answer. */
export type AllAnswer = Json;

// ---------------------------------------------------------------- dedupe parameters
export interface DedupeParameter {
  value: string;
  label: string;
  hint: string;
  pattern: RegExp;
  normalise: (v: unknown) => string;
  all?: undefined;
}

export interface AllParameter {
  value: string;
  label: string;
  hint: string;
  all: true;
}

export type ParameterOption = DedupeParameter | AllParameter;

export interface AllValuesResult {
  errors: Record<string, string>;
  body: Record<string, string>;
}

// ---------------------------------------------------------------- form schema and state
export interface ByProductSpec {
  choices: string[];
  required?: boolean;
  default?: string | null;
}

export interface FieldRules {
  pattern?: string;
  strip?: string;
  date?: boolean;
  not_future?: boolean;
  min_age?: number;
  max_age?: number;
  number?: boolean;
  integer?: boolean;
  min?: number;
  max?: number;
  boolean?: boolean;
  upper?: boolean;
  control?: string;
  by_product?: Record<string, ByProductSpec>;
}

export interface SchemaField {
  name: string;
  label?: string;
  group?: string;
  required?: boolean;
  max_length?: number | null;
  choices?: string[] | null;
  rules?: FieldRules;
  /** effectiveField: not used by the chosen product (never shown, validated or sent) */
  hidden?: boolean;
  /** effectiveField: the product's default choice */
  defaultValue?: string | null;
}

export interface CoApplicantBlock {
  max?: number;
  fields?: SchemaField[];
}

/** GET /api/v1/fos/form-schema */
export interface FormSchemaDef {
  fields?: SchemaField[];
  co_applicants?: CoApplicantBlock | null;
}

export interface CoApplicantSchema {
  max: number;
  fields: SchemaField[];
}

export type CoApplicant = Record<string, string>;

export interface FormState {
  customerType: string;
  dedupeParameter: string;
  dedupeValue: string;
  values: Record<string, string>;
  touched: Record<string, boolean>;
  coApplicants: CoApplicant[];
  /** All-parameters values: pan / mobile / ap_code / pr_code */
  allValues?: Record<string, string>;
}

/** { fieldName: message } -- co-applicant errors keyed as the backend names them: co_applicants[i].field */
export type ValidationErrors = Record<string, string>;

export interface Sample {
  customerType: string | null;
  dedupeParameter: string;
  dedupeValue: string;
  values: Record<string, string>;
  coApplicants?: CoApplicant[];
  label?: string;
}

export interface LookupSample {
  caseId: string;
  party: string;
  customerType: string;
  parameter: string;
  value: string;
}

// ---------------------------------------------------------------- request bodies
export type BodyValue = string | number | boolean;

export interface CreateBody {
  applicant: Record<string, BodyValue>;
  application: Record<string, BodyValue>;
  co_applicants?: CoApplicant[];
}

export interface DedupeBody {
  case_id: string;
  customer_type: string;
  requested_product?: BodyValue;
  requested_amount?: BodyValue;
  mode?: "ALL";
  dedupe_parameter?: string;
  dedupe_parameter_value?: string;
  pan?: string;
  mobile?: string;
  ap_code?: string;
  pr_code?: string;
}

export interface Submission<T> {
  key: string;
  body: T;
}

// ---------------------------------------------------------------- the API client
export interface HeadersLike {
  get(name: string): string | null | undefined;
}

export interface FetchInit {
  method: string;
  cache: RequestCache;
  signal: AbortSignal;
  headers: Record<string, string>;
  body: string | undefined;
}

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  headers: HeadersLike;
  text(): Promise<string>;
}

export type FetchImpl = (url: string, init: FetchInit) => Promise<FetchResponseLike>;

export interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
  signal?: AbortSignal;
  token?: string | null;
  /** injectable for tests; default globalThis.fetch, resolved at call time */
  fetchImpl?: FetchImpl;
  /** injectable for tests; default a setTimeout promise */
  sleep?: (ms: number) => Promise<unknown>;
}

export interface ApiResponse<T = Json> {
  data: T;
  headers: HeadersLike;
  status: number;
}

// ---------------------------------------------------------------- the view of a dedupe answer
export interface OutcomeView {
  tone: string;
  title: string;
  note: string;
}

export interface ToneLabel {
  tone: string;
  label: string;
}

export interface TotalView {
  label: string;
  tone: string;
  value: string | null;
  missing?: string[];
  reason?: string | null;
}

export interface MatchedLine {
  tone: string;
  text: string;
}

export interface RuleView {
  title: string;
  what: string;
  status: string;
  tone: string;
  reason: string;
}

export interface BusinessRuleView {
  id: string;
  name: string;
  what: string;
  tone: string;
  status: string;
  reason: string;
  next: string[];
}

export interface AllBusinessRuleView extends BusinessRuleView {
  /** the parameters that found it */
  via: string[];
}

export interface ExistingLoanRow {
  [key: string]: unknown;
  prospect_code: string;
  ap_code: string | null;
  applicant_type: string | null;
  product_name: string | null;
  product_code: string | null;
  loan_amount: string | null;
  principal_outstanding: string | null;
  emi: string | null;
  overdue: string | null;
  disbursement_date: string | null;
  tenor: string | null;
  roi: null;
  foreclosure_interest: null;
  common_applicant: string | null;
  pan_match: string | null;
  pan_tone: string | null;
  mifin_status: string | null;
  lms_record: string | null;
  status_why: string | null;
  data_problems: string | null;
  topup: string | null;
  topup_tone: string | null;
  emi_bounces: string | null;
  cancel_reason: string | null;
  is_cancelled: boolean;
  name_match: string | null;
  name_tone: string | null;
  dob_match: string | null;
  dob_tone: string | null;
  loan_status: string;
  status_tone: string;
  match_found: string | null;
  match_found_why: string | null;
}

export interface LoanDetailItem {
  key: string;
  label: string;
  source: string;
  num: boolean;
  value: string | null;
  note: string;
  tone: string | null;
}

/** matchTable's `entered`: what was typed on the page (value = the searched identifier, unmasked; masked on display). */
export interface Entered {
  value?: string | null;
  pan?: string | null;
  name?: string | null;
  dob?: string | null;
}

export interface MatchRow {
  field: string;
  entered: string | null;
  mifin: string | null;
  result: string;
  tone: string;
}

export interface SimpleRow {
  key: string;
  q: string;
  a: string;
  tone: string;
}

export interface SourceLineView {
  name: string;
  state: string;
  tone: string;
}

export interface LoanColumn {
  key: string;
  label: string;
  [k: string]: unknown;
}

export interface LoanColumnsView<C extends LoanColumn = LoanColumn> {
  shown: C[];
  empty: string[];
  constant: string[];
}

export interface SummaryRow {
  key: string;
  label: string;
  value: string;
  tone: string;
  strong?: boolean;
}

export interface AssessmentSummaryView {
  title: string;
  note: string;
  rows: SummaryRow[];
  recommendation: string | null;
}

export interface DedupeStatusView {
  status: string;
  label: string;
  tone: string;
  action: string;
  complete: boolean;
  reasons: string[];
  missing: string[];
}

export interface GuidanceView {
  key: string;
  tone: string;
  title: string;
  lines: string[];
}

export interface ActionsView {
  officer: string[];
  limitsNotSet: number;
}

export interface LoanView {
  ref: string;
  scheme: string;
  sourceStatus: string;
  status: string;
  statusSource: string;
  tone: string;
  sanctioned: string | null;
  outstanding: string | null;
  emi: string | null;
  dpd: Json;
  dpdNow: Json;
  overdue: string | null;
  disbursedOn: string | null;
  closedOn: string | null;
  tenure: Json;
  lms: string;
  resolved: boolean;
  searchedAccount: boolean;
  conflict: boolean;
  duplicates: number;
  problems: string[];
  cancelReason: string | null;
  check: Json;
  topup: Json;
  bounces: Json;
}

export interface RuleRow {
  id: string;
  outcome: string;
  reason: string | null;
  reasonCode: string | null;
  description: string;
  severity: string | null;
  nextAction: string | null;
  version: Json;
  signal: Json;
  view: RuleView;
  value: string | null;
}

export interface MatchView {
  code: string;
  label: string;
  ref: string;
  basis: Json;
  identifierMatches: boolean | null | undefined;
  warnings: string[];
  role: string | null;
}

export interface OtherCase {
  caseId: string | null;
  role: string | null;
  product: string | null;
  status: string | null;
}

export interface HistoryView {
  status: string;
  tone: string;
  label: string;
  count: number;
  withheld: number;
  sources: Json[];
}

export interface TotalsView {
  exposure: TotalView;
  emi: TotalView;
  dpd: string;
  active: Json;
  byStatus: Record<string, number>;
  conflicts: number;
  unknown: number;
}

export interface Headline {
  title: string;
  tone: string;
  note: string;
}

export interface ExplanationView {
  text: string;
  source: string;
  fallback: string | null;
  points: string[];
  pending: boolean;
  pointsSource?: "LLM" | "DETERMINISTIC";
}

export interface LosView {
  status: string | null;
  recommendation: string | null;
  recommendations: Json[];
  documentsReused: number;
  sameProduct: Json;
  searchStatus: string | null;
  searchMatches: number;
  searchTypeCheck: Json;
}

/** viewResult(): the page's view of one dedupe answer. */
export interface ResultView {
  requestId: string;
  caseId: string;
  stage: string | null;
  isDemo: boolean;
  outcome: string;
  outcomeView: OutcomeView;
  customer: ToneLabel;
  customerStatus: string;
  typeCheck: Json;
  searched: string;
  match: MatchView;
  confirmation: Json;
  identityCheck: Json;
  identityValues: Json;
  checkedParty: string;
  otherCases: OtherCase[];
  history: HistoryView;
  loans: LoanView[];
  commonApplicant: Json;
  totals: TotalsView | null;
  rules: RuleRow[];
  ruleCounts: Record<string, number>;
  reasonCodes: string[];
  nextActions: string[];
  actions: ActionsView;
  guidance: GuidanceView;
  dedupe: DedupeStatusView | null;
  summary: AssessmentSummaryView | null;
  simple: SimpleRow[];
  headline: Headline | null;
  business: BusinessRuleView[];
  matched: MatchedLine[];
  complete: boolean;
  sources: Json[];
  policy: Json;
  explanation: ExplanationView;
  los: LosView;
  timings: Record<string, number>;
}

/** buildView's result before the simple summary is filled in. */
export type ResultViewDraft = Omit<ResultView, "simple"> & { simple: SimpleRow[] | null };

export interface AllRowView {
  parameter: string;
  label: string;
  value: string | null;
  from: string;
  match: string;
  matchCode: string;
  customer: string | null;
  decision: string;
  tone: string;
  found: string[];
  findings: string[];
  view: ResultView;
}

export interface AllConsistencyView {
  status: string | undefined;
  tone: string;
  text: string;
  byParameter: string[];
}

export interface AllCombinedView {
  code: string | undefined;
  label: string;
  tone: string;
  reasons: string[];
}

/** allView(): the All-parameters answer as the page shows it. */
export interface AllView {
  requestId: string;
  checked: string[];
  rows: AllRowView[];
  missing: string[];
  consistency: AllConsistencyView;
  combined: AllCombinedView;
  business: AllBusinessRuleView[];
}

// ---------------------------------------------------------------- aliases (names the UI files import)
export type FormSchema = FormSchemaDef;
export type DedupeView = ResultView;
export type LoanRow = ExistingLoanRow;
/** A dedupe call as the page sends it: the create flow's body, or Check an existing case's (party, optional customer
 * type), plus the officer's decision on a possible match (confirm_match + candidate). */
export type DedupeRequest = Omit<DedupeBody, "customer_type"> & {
  customer_type?: string;
  party_role?: string;
  confirm_match?: string;
  candidate?: unknown;
};
export type LookupSampleValues = LookupSample;
