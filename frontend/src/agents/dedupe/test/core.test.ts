// The page's logic (src/core.ts) -- vitest port of the original test/core.test.js (node:test), same tests, same
// assertions. The fixture is a REAL answer of POST /api/v1/credit/dedupe on the backend's demo providers (synthetic,
// masked); variants are derived from it, never invented from scratch.
import * as C from "../core";
import type { BusinessRuleView, DedupeParameter, FetchImpl, FetchInit, FormSchemaDef, Json, SchemaField } from "../types";
import fixture from "./fixtures/dedupe_existing_complete.json";
import uiText from "../../../../public/dedupe/ui_text.json";
import sampleConfig from "../../../../public/dedupe/sample_config.json";

const REAL: Json = fixture;
const clone = (x: Json): Json => JSON.parse(JSON.stringify(x));
/** a single (not All-parameters) dedupe parameter -- a type narrowing only */
const single = (value: string) => C.parameter(value) as DedupeParameter;

/** assert.rejects(promise, validate) */
async function rejects(p: Promise<unknown>, check: (e: C.ApiError) => boolean) {
  let threw = false;
  let caught: unknown;
  try { await p; } catch (e) { threw = true; caught = e; }
  expect(threw, "expected a rejection").toBe(true);
  expect(check(caught as C.ApiError)).toBe(true);
}

/** assert.throws(fn, validate) */
function throws(fn: () => unknown, check: (e: C.ApiError) => boolean) {
  let threw = false;
  let caught: unknown;
  try { fn(); } catch (e) { threw = true; caught = e; }
  expect(threw, "expected a throw").toBe(true);
  expect(check(caught as C.ApiError)).toBe(true);
}

type Schema = FormSchemaDef & { fields: SchemaField[] };

// the backend's GET /api/v1/fos/form-schema (shape and rules as returned on 2026-10-22)
const SCHEMA: Schema = { fields: [
  { name: "full_name", group: "applicant", label: "Applicant name", required: true, max_length: 200, choices: null, rules: { pattern: "^[A-Za-z\\u0900-\\u097F .'-]{2,}$" } },
  { name: "mobile", group: "applicant", label: "Mobile", required: true, max_length: 20, choices: null, rules: { pattern: "^[6-9]\\d{9}$", strip: "[\\s+-]|^91(?=\\d{10}$)" } },
  { name: "date_of_birth", group: "applicant", label: "Date of birth", required: true, max_length: 32, choices: null, rules: { date: true, min_age: 18, max_age: 80 } },
  { name: "address", group: "applicant", label: "Address", required: true, max_length: 500, choices: null, rules: {} },
  { name: "email", group: "applicant", label: "Email", required: false, max_length: 200, choices: null, rules: { pattern: "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$" } },
  { name: "product", group: "application", label: "Product", required: true, max_length: 64, choices: ["PERSONAL_LOAN", "HOME_LOAN", "LOAN_AGAINST_PROPERTY"], rules: {} },
  { name: "loan_amount", group: "application", label: "Loan amount (Rs)", required: true, max_length: null, choices: null, rules: { number: true } },
  { name: "employment_type", group: "application", label: "Employment type", required: false, max_length: 64, choices: ["SALARIED", "SELF_EMPLOYED"], rules: {} },
  { name: "tenure_months", group: "application", label: "Tenure (months)", required: false, max_length: null, choices: null, rules: { integer: true, min: 1, max: 480 } },
] };
const TODAY = new Date("2026-10-22T10:00:00");
const GOOD: Record<string, string> = { full_name: "Test Person", mobile: "+91 98765 43210", date_of_birth: "1990-05-01", address: "1 Synthetic Road",
  product: "PERSONAL_LOAN", loan_amount: "5,00,000", tenure_months: "36" };

function filled(customerType = "New") {
  let s = C.setCustomerType(C.initialState(), customerType);
  for (const [k, v] of Object.entries(GOOD)) s = C.setValue(s, k, v);
  return s;
}

// ---- the API client fakes -----------------------------------------------------------------------------------------
type Fake = Error | { status: number; body?: unknown; headers?: Record<string, string> };
function fakeFetch(responses: Fake[]) {
  const calls: { url: string; init: FetchInit }[] = [];
  const impl: FetchImpl = async (url, init) => {
    calls.push({ url, init });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (r instanceof Error) throw r;
    return { ok: r.status >= 200 && r.status < 300, status: r.status, headers: new Map(Object.entries(r.headers || {})),
      text: async () => (r.body === undefined ? "" : typeof r.body === "string" ? r.body : JSON.stringify(r.body)) };
  };
  return { impl, calls };
}
const noSleep = async () => {};

// ---- Fill sample: random, realistic, every pool and range from public/sample_config.json
const SAMPLE_CFG: Json = sampleConfig;
const FULL_SCHEMA: Schema = { fields: [...SCHEMA.fields,
  { name: "interest_rate_pct", label: "Interest rate (%)", required: false, rules: { number: true, min: 1, max: 60 } },
  { name: "declared_monthly_income", label: "Monthly income", required: false, rules: { number: true } },
  { name: "declared_monthly_obligations", label: "Monthly obligations", required: false, rules: { number: true } },
  { name: "property_value", label: "Property value", required: false, rules: { number: true } },
  // GET /form-schema since 2026-10-22: choices / required per product come from the eligibility terms
  { name: "property_type", group: "application", label: "Property type", required: false, choices: ["COMMERCIAL", "INDUSTRIAL", "RESIDENTIAL"],
    rules: { by_product: { HOME_LOAN: { choices: ["RESIDENTIAL"], required: false, default: "RESIDENTIAL" },
      LOAN_AGAINST_PROPERTY: { choices: ["COMMERCIAL", "INDUSTRIAL", "RESIDENTIAL"], required: true, default: null } } } },
] };

function seeded(seed: number) {                                        // mulberry32: a repeatable rng for the tests
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const UI_TEXT: Json = uiText;

const CO_SCHEMA: Schema = { ...FULL_SCHEMA, co_applicants: { max: 3, fields: [
  { name: "full_name", label: "Co-applicant name", required: true, rules: { pattern: "^[A-Za-zऀ-ॿ .'-]{2,}$" } },
  { name: "date_of_birth", label: "Date of birth", rules: { date: true, min_age: 18, max_age: 80 } },
  { name: "pan", label: "PAN", rules: { pattern: "^[A-Z]{5}[0-9]{4}[A-Z]$", upper: true } },
  { name: "relationship", label: "Relationship to applicant", rules: {} }] } };

function dd(over: Json = {}): Json {
  return { status: "NO_DUPLICATE_FOUND", search_complete: true, searches_missing: [], parties_incomplete: [],
    match_reasons: ["MOBILE_MATCHES_EXISTING_CUSTOMER", "EXISTING_LOANS_ON_RECORD"],
    parties: [{ role: "PRIMARY_APPLICANT", status: "NO_DUPLICATE_FOUND", existing_customer: true, identifier_used: "MOBILE",
      match_reasons: ["MOBILE_MATCHES_EXISTING_CUSTOMER"], mifin: { customer_ref: "AP******18" } }],
    assessment: { existing_customer_or_loan: "FOUND", duplicate_application: "NOT_FOUND", conflicts: [], credit_decision: "NOT_DECIDED_BY_DEDUPE" },
    workflow_recommendation: { recommendation: "PROCEED_TO_NEXT_STAGE", reason: "r", next_action: "n", policy_question: null }, ...over };
}

// ---- R01-R11, each rule: found / clear / partly checked / not available, from the answer only ----------------
interface World {
  scenarios?: Record<string, string>; search?: string; matches?: number; history?: Record<string, Json>;
  ident?: boolean | null; check?: Json; match?: string; caseStatus?: string;
}
function ruleWorld({ scenarios = {}, search = "NO_MATCH", matches = 0, history = {}, ident = true, check = null,
  match = "CONFIRMED_MATCH", caseStatus = "NO_MATCH" }: World = {}): Record<string, BusinessRuleView> {
  const r = clone(REAL);
  const base = Object.fromEntries(["S02_EXISTING_CUSTOMER", "S09_ROLE_CHANGE", "S10_SIMULTANEOUS_APPLICATION",
    "S11_IDENTITY_CONFLICT", "S11_POSSIBLE_MATCH", "S12_DOCUMENT_REUSE"].map((s) => [s, "NOT_DETECTED"]));
  r.los_dedupe.case.status = caseStatus;
  r.los_dedupe.case.scenarios = Object.entries({ ...base, ...scenarios }).map(([scenario, status]) => ({ scenario, status }));
  r.los_dedupe.search = { status: search, matches: Array.from({ length: matches }, () => ({ visible: false })) };
  const all = [...r.evaluation.rules, ...["H11_TOPUP_ELIGIBILITY", "H12_EMI_BOUNCES", "H13_FRAUD_HISTORY", "H14_COLLATERAL_REUSE"].map((rule_id) => ({ rule_id, outcome: "NOT_TRIGGERED" }))];
  r.evaluation.rules = all.map((x: Json) => (history[x.rule_id]
    ? { ...x, ...history[x.rule_id] } : { ...x, outcome: "NOT_TRIGGERED", reason: null }));
  r.history.customer.searched_identifier_matches = ident;
  r.history.customer.identity_check = check || { searched_identifier: "MATCH", pan: "MATCH", name: "MATCH", dob: "MATCH" };
  r.history.customer.match = match;
  return Object.fromEntries(C.businessRules(r, UI_TEXT).map((b) => [b.id, b]));
}

describe("core", () => {
  // ---- New / Existing conditional behaviour -----------------------------------------------------------------------
  it("New hides and CLEARS the dedupe fields, so a stale hidden value is never sent", () => {
    let s = C.setCustomerType(C.initialState(), "Existing");
    s = C.setDedupeParameter(s, "PAN");
    s = { ...s, dedupeValue: "ABCDE1234F" };
    s = C.setCustomerType(s, "New");
    expect(s.dedupeParameter).toBe("");
    expect(s.dedupeValue).toBe("");
    const body = C.dedupeBody("CASE-1", { ...filled("New"), dedupeParameter: s.dedupeParameter, dedupeValue: s.dedupeValue }, SCHEMA);
    expect(body!.dedupe_parameter).toBe("Mobile No");                     // the applicant's own mobile, never the old PAN
    expect(body!.dedupe_parameter_value).toBe("9876543210");
    expect(!JSON.stringify(body).includes("ABCDE1234F")).toBeTruthy();
  });

  it("changing the parameter clears the value typed for the old one", () => {
    let s = C.setDedupeParameter(C.setCustomerType(C.initialState(), "Existing"), "PAN");
    s = { ...s, dedupeValue: "ABCDE1234F" };
    expect(C.setDedupeParameter(s, "Mobile No").dedupeValue).toBe("");
    expect(C.setDedupeParameter(s, "PAN").dedupeValue).toBe("ABCDE1234F");
  });

  it("Existing requires a parameter and a valid value before anything is sent", () => {
    const base = filled("Existing");
    expect(Object.keys(C.validate(base, SCHEMA, TODAY))).toEqual(["dedupeParameter"]);
    const noValue = C.setDedupeParameter(base, "AP Code");
    expect(C.validate(noValue, SCHEMA, TODAY).dedupeValue).toMatch(/Enter the Customer ID/);
    expect(C.validate({ ...noValue, dedupeValue: "AP123" }, SCHEMA, TODAY).dedupeValue).toMatch(/AP followed by 8 digits/);
    expect(C.validate({ ...noValue, dedupeValue: "ap 00731942" }, SCHEMA, TODAY)).toEqual({});
  });

  it("no customer type chosen is an error", () => {
    expect(C.validate(C.initialState(), SCHEMA, TODAY).customerType).toBeTruthy();
  });

  // ---- dedupe parameters -----------------------------------------------------------------------------------------
  it("the dropdown: the API's four values, plain officer labels, no source text", () => {
    expect(C.DEDUPE_PARAMETERS.map((p) => p.value)).toEqual(["PAN", "Mobile No", "AP Code", "PR Code"]);
    expect(C.DEDUPE_PARAMETERS.map((p) => p.label)).toEqual(["PAN", "Mobile No", "Customer ID", "Loan account no."]);
    expect(!C.DEDUPE_PARAMETERS.some((p) => /mifin|los records/i.test(`${p.label} ${p.hint}`))).toBeTruthy();
    expect(!C.DEDUPE_PARAMETERS.some((p) => /aadhaar/i.test(p.value + p.label))).toBeTruthy();
  });

  it("values are normalised the way the backend normalises them", () => {
    expect(single("PAN").normalise(" abcde 1234f ")).toBe("ABCDE1234F");
    expect(single("Mobile No").normalise("+91 98765-43210")).toBe("9876543210");
    expect(single("Mobile No").normalise("09876543210")).toBe("9876543210");
  });

  // ---- schema-driven validation -------------------------------------------------------------------------------------
  it("the backend's own rules: pattern, strip, age, integer range, choices", () => {
    const f = Object.fromEntries(SCHEMA.fields.map((x) => [x.name, x]));
    expect(C.validateField(f.mobile, "+91 98765 43210")).toBe(null);
    expect(C.validateField(f.mobile, "12345")).toMatch(/valid format/);
    expect(C.validateField(f.date_of_birth, "2015-01-01", TODAY)).toMatch(/at least 18/);
    expect(C.validateField(f.date_of_birth, "1930-01-01", TODAY)).toMatch(/at most 80/);
    expect(C.validateField(f.tenure_months, "500")).toMatch(/at most 480/);
    expect(C.validateField(f.tenure_months, "12.5")).toMatch(/whole number/);
    expect(C.validateField(f.product, "CAR_LOAN")).toMatch(/listed options/);
    expect(C.validateField(f.loan_amount, "lots")).toMatch(/must be a number/);
    expect(C.validateField(f.full_name, "")).toMatch(/required/);
    expect(C.validateField(f.email, "")).toBe(null);                     // optional
  });

  it("the create body carries only filled schema fields, numbers as numbers", () => {
    const body = C.createBody(filled(), SCHEMA);
    expect(body.application).toEqual({ product: "PERSONAL_LOAN", loan_amount: 500000, tenure_months: 36 });
    expect(body.applicant.mobile).toBe("9876543210");
    expect(!("email" in body.applicant)).toBeTruthy();
  });

  it("an Existing dedupe body carries the officer's parameter, normalised, and the requested loan", () => {
    let s = C.setDedupeParameter(filled("Existing"), "PR Code");
    s = { ...s, dedupeValue: "pr02184467" };
    expect(C.dedupeBody("CASE-1", s, SCHEMA)).toEqual({ case_id: "CASE-1", customer_type: "Existing",
      requested_product: "PERSONAL_LOAN", requested_amount: 500000, dedupe_parameter: "PR Code",
      dedupe_parameter_value: "PR02184467" });
  });

  // ---- idempotency ------------------------------------------------------------------------------------------------
  it("a retry keeps its key; an edited form gets a new one", () => {
    const body = C.createBody(filled(), SCHEMA);
    const first = C.caseSubmission(undefined, body);
    expect(C.caseSubmission(first, JSON.parse(JSON.stringify(body))).key).toBe(first.key);
    const edited = C.caseSubmission(first, { ...body, application: { ...body.application, loan_amount: 600000 } });
    expect(edited.key).not.toBe(first.key);
  });

  // ---- the API client --------------------------------------------------------------------------------------------
  it("a typed error with the backend's code, message and request id", async () => {
    const { impl } = fakeFetch([{ status: 403, body: { detail: { code: "CASE_ACCESS_DENIED", message: "Not yours.", request_id: "r1" } } }]);
    await rejects(C.request("/x", { fetchImpl: impl }), (e) => e.status === 403 && e.code === "CASE_ACCESS_DENIED" && e.requestId === "r1");
  });

  it("GET and keyed POSTs are retried on 503; an unkeyed POST never is", async () => {
    const get = fakeFetch([{ status: 503 }, { status: 200, body: { ok: 1 } }]);
    expect((await C.request("/x", { retries: 2, fetchImpl: get.impl, sleep: noSleep })).data).toEqual({ ok: 1 });
    expect(get.calls.length).toBe(2);
    const keyed = fakeFetch([{ status: 503 }, { status: 201, body: { case_id: "C" } }]);
    await C.request("/x", { method: "POST", body: {}, headers: { "Idempotency-Key": "k" }, retries: 1, fetchImpl: keyed.impl, sleep: noSleep });
    expect(keyed.calls.length).toBe(2);
    const plain = fakeFetch([{ status: 503 }, { status: 200, body: {} }]);
    await rejects(C.request("/x", { method: "POST", body: {}, retries: 3, fetchImpl: plain.impl, sleep: noSleep }), (e) => e.status === 503);
    expect(plain.calls.length).toBe(1);
  });

  it("a body that is not JSON is MALFORMED_RESPONSE, a network failure NETWORK", async () => {
    const bad = fakeFetch([{ status: 200, body: "<html>oops" }]);
    await rejects(C.request("/x", { fetchImpl: bad.impl }), (e) => e.code === "MALFORMED_RESPONSE");
    const down = fakeFetch([new TypeError("fetch failed")]);
    await rejects(C.request("/x", { fetchImpl: down.impl }), (e) => e.code === "NETWORK" && e.retryable);
  });

  it("a slow backend times out; a cancelled request says so", async () => {
    const slow: FetchImpl = (_url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))));
    await rejects(C.request("/x", { fetchImpl: slow, timeoutMs: 20 }), (e) => e.code === "TIMEOUT");
    const controller = new AbortController();
    const p = C.request("/x", { fetchImpl: slow, timeoutMs: 5000, signal: controller.signal });
    controller.abort();
    await rejects(p, (e) => e.code === "CANCELLED");
  });

  it("the bearer token is sent only when held; 401 surfaces as status 401", async () => {
    const f = fakeFetch([{ status: 401, body: { detail: "Not authenticated" } }]);
    await rejects(C.request("/x", { token: "t-1", fetchImpl: f.impl }), (e) => e.status === 401);
    expect(f.calls[0].init.headers.Authorization).toBe("Bearer t-1");
    const g = fakeFetch([{ status: 200, body: {} }]);
    await C.request("/x", { fetchImpl: g.impl });
    expect(!("Authorization" in g.calls[0].init.headers)).toBeTruthy();
  });

  // ---- the view of the real answer -------------------------------------------------------------------------------
  it("the real answer renders: existing customer, three loans, verified exposure, review required", () => {
    const v = C.viewResult(REAL);
    expect(v.outcome).toBe("REVIEW_REQUIRED");
    expect(v.outcomeView.title).toBe("Review required");
    expect(v.customer.label).toBe("Existing customer");
    expect(v.match.code).toBe("CONFIRMED_MATCH");
    expect(v.loans.length).toBe(3);
    expect(v.totals!.exposure.label).toBe("₹3,12,400");
    expect(v.totals!.emi.label).toBe("₹11,200");
    expect(v.isDemo).toBeTruthy();
    expect(v.rules.some((r) => r.outcome === "NOT_EVALUATED" && r.reason === "THRESHOLD_UNCONFIGURED")).toBeTruthy();
  });

  it("READY_FOR_DECISION is never shown as an approval", () => {
    const r = clone(REAL); r.outcome = "READY_FOR_DECISION";
    const v = C.viewResult(r);
    expect(v.outcomeView.note).toMatch(/not an approval/);
    expect(!/approved/i.test(v.outcomeView.title)).toBeTruthy();
  });

  for (const [status, label] of [["NO_PREVIOUS_LOANS", "No previous loans"], ["UNAVAILABLE", "Unavailable"],
    ["NOT_ATTRIBUTED", "Not attributed (identity not confirmed)"], ["PARTIAL", "2 of 3 loans confirmed by Leviosa"]]) {
    it(`history ${status} reads as "${label}", never as zero loans unless authoritative`, () => {
      const r = clone(REAL);
      r.history.history_status = status;
      if (status !== "PARTIAL") { r.history.loans = []; r.history.loan_count = 0; r.history.aggregates = null; }
      else r.history.loans.forEach((x: Json, i: number) => { x.resolved = i !== 0; });   // the LMS confirmed 2 of 3: said exactly
      const v = C.viewResult(r, UI_TEXT);
      expect(v.history.label).toBe(label);
      if (status === "UNAVAILABLE") expect(v.totals).toBe(null);
    });
  }

  it("match states map to their labels", () => {
    for (const [code, text] of [["CONFIRMED_MATCH", "Confirmed match"], ["POTENTIAL_MATCH", "Potential match"],
      ["AMBIGUOUS", "Ambiguous match"], ["NO_MATCH", "No match"], ["SOURCE_ERROR", "Source error"]]) {
      const r = clone(REAL); r.history.customer.match = code;
      expect(C.viewResult(r).match.label).toBe(text);
    }
  });

  it("one loan, a conflicting duplicate, a partial total and an unknown amount", () => {
    const r = clone(REAL);
    r.history.loans = [r.history.loans[0]];
    r.history.loans[0].conflicting_duplicate = true;
    r.history.loans[0].lms = null;
    r.history.aggregates.active_exposure = { status: "PARTIAL", value: "120000", loans_missing: ["PR******31"] };
    const v = C.viewResult(r);
    expect(v.loans.length).toBe(1);
    expect(v.loans[0].conflict).toBe(true);
    expect(v.loans[0].outstanding).toBe(null);                   // unknown, not zero
    expect(v.totals!.exposure.label).toBe("₹1,20,000 · 1 loan not included");   // never a bare "partial"
    expect(v.totals!.exposure.missing).toEqual(["PR******31"]);
  });

  it("loans sort by amount with unknowns last, both directions", () => {
    const rows = [{ sanctioned: "₹5,00,000" }, { sanctioned: null }, { sanctioned: "₹1,50,000" }];
    expect(C.sortLoans(rows, "sanctioned", "asc").map((x) => x.sanctioned)).toEqual(["₹1,50,000", "₹5,00,000", null]);
    expect(C.sortLoans(rows, "sanctioned", "desc").map((x) => x.sanctioned)).toEqual(["₹5,00,000", "₹1,50,000", null]);
  });

  it("a body that is not the contract is refused, never half-rendered", () => {
    for (const bad of [null, {}, { outcome: "X" }, { outcome: "X", history: {} }]) {
      throws(() => C.viewResult(bad), (e) => e.code === "MALFORMED_RESPONSE");
    }
  });

  it("defence in depth: a PAN, mobile or PR code in free text never reaches the page; the AP number is shown", () => {
    const r = clone(REAL);
    r.history.customer.customer_ref = "AP00745218";
    r.explanation.text = "Customer AP00745218. PAN BCDPM5678N, mobile 9876502222, loan PR02407753.";
    const v = C.viewResult(r);
    const text = JSON.stringify(v);
    for (const s of ["BCDPM5678N", "9876502222", "PR02407753"]) expect(!text.includes(s), s).toBeTruthy();
    expect(v.explanation.text.includes("AP00745218"), "the AP number in full (owner 2026-10-23)").toBeTruthy();
  });

  it("the explanation's source and fallback are carried, never invented", () => {
    const r = clone(REAL);
    r.explanation = { text: "x", source: "DETERMINISTIC", fallback_reason: "LLM_ERROR:TimeoutError" };
    const v = C.viewResult(r);
    expect(v.explanation.source).toBe("DETERMINISTIC");
    expect(v.explanation.fallback).toBe("LLM_ERROR:TimeoutError");
  });

  it("property type: hidden for a personal loan, required for LAP, optional with a default for HL; never sent where hidden", () => {
    const field = FULL_SCHEMA.fields.find((f) => f.name === "property_type")!;
    expect(C.effectiveField(field, { product: "PERSONAL_LOAN" }).hidden).toBe(true);
    const lap = C.effectiveField(field, { product: "LOAN_AGAINST_PROPERTY" });
    expect([lap.hidden, lap.required, lap.choices!.length]).toEqual([false, true, 3]);
    const hl = C.effectiveField(field, { product: "HOME_LOAN" });
    expect([hl.required, hl.choices, hl.defaultValue]).toEqual([false, ["RESIDENTIAL"], "RESIDENTIAL"]);
    let s = filled();
    s = C.setValue(s, "product", "LOAN_AGAINST_PROPERTY");
    expect(C.validate(s, FULL_SCHEMA, TODAY).property_type).toMatch(/required/);
    s = C.setValue(s, "property_type", "VILLA");
    expect(C.validate(s, FULL_SCHEMA, TODAY).property_type, "a type LAP does not offer is refused").toBeTruthy();
    s = C.setValue(s, "property_type", "COMMERCIAL");
    expect(C.validate(s, FULL_SCHEMA, TODAY).property_type).toBe(undefined);
    expect(C.createBody(s, FULL_SCHEMA).application.property_type).toBe("COMMERCIAL");
    s = C.setValue(s, "product", "PERSONAL_LOAN");
    expect(C.validate(s, FULL_SCHEMA, TODAY).property_type).toBe(undefined);
    expect(C.createBody(s, FULL_SCHEMA).application.property_type, "hidden -> not sent").toBe(undefined);
  });

  it("Fill sample: LAP always carries a property type it offers; a personal loan never does", () => {
    let lap = 0;
    for (let i = 0; i < 400; i += 1) {
      const v = C.applySample(C.generateSample(SAMPLE_CFG, FULL_SCHEMA, seeded(20000 + i), TODAY), FULL_SCHEMA).values;
      if (v.product === "LOAN_AGAINST_PROPERTY") { lap += 1; expect(["COMMERCIAL", "INDUSTRIAL", "RESIDENTIAL"].includes(v.property_type)).toBeTruthy(); }
      if (v.product === "PERSONAL_LOAN") expect(v.property_type).toBe(undefined);
      if (v.product === "HOME_LOAN" && v.property_type) expect(v.property_type).toBe("RESIDENTIAL");
    }
    expect(lap > 50).toBeTruthy();
  });

  it("Fill sample: 500 random draws all pass the schema rules, the dedupe rules and the configured ranges", () => {
    const seen = { names: new Set<string>(), types: new Set<string>(), products: new Set<string>(), params: new Set<string>() };
    for (let i = 0; i < 500; i += 1) {
      const s = C.generateSample(SAMPLE_CFG, FULL_SCHEMA, seeded(i + 1), TODAY);
      const state = C.applySample(s, FULL_SCHEMA);
      for (const f of FULL_SCHEMA.fields) {
        if (state.values[f.name] != null) expect(C.validateField(f, state.values[f.name], TODAY), `${i} ${f.name}`).toBe(null);
      }
      expect(C.validateDedupe(state), `draw ${i}`).toEqual({});
      const v = state.values;
      const p = SAMPLE_CFG.products[v.product];
      const amount = Number(v.loan_amount);
      expect(amount >= p.amount[0] && amount <= p.amount[1], `amount ${amount} in ${v.product} range`).toBeTruthy();
      const tenure = Number(v.tenure_months);
      expect(tenure >= p.tenure_months[0] && tenure <= p.tenure_months[1]).toBeTruthy();
      const rate = Number(v.interest_rate_pct);
      expect(rate >= p.interest_rate_pct[0] && rate <= p.interest_rate_pct[1]).toBeTruthy();
      const r = rate / 1200;
      const emi = (amount * r) / (1 - (1 + r) ** -tenure);
      expect((emi + Number(v.declared_monthly_obligations)) / Number(v.declared_monthly_income) <= SAMPLE_CFG.max_foir + 1e-9, "FOIR").toBeTruthy();
      expect(v.property_value != null, "property value only for secured products").toBe(Boolean(p.loan_to_value));
      if (v.property_value) expect(amount / Number(v.property_value) <= p.loan_to_value[1] + 1e-9, "LTV").toBeTruthy();
      if (state.dedupeParameter === "Mobile No") expect(state.dedupeValue, "searched mobile is the applicant's").toBe(v.mobile);
      seen.names.add(v.full_name); seen.types.add(state.customerType); seen.products.add(v.product); seen.params.add(state.dedupeParameter);
    }
    expect(seen.names.size > 300, "random, not a fixed record").toBeTruthy();
    expect([...seen.types].sort()).toEqual(["Existing", "New"]);
    expect([...seen.products].sort()).toEqual(Object.keys(SAMPLE_CFG.product_weights).filter((k) => SAMPLE_CFG.product_weights[k] > 0).sort());
    expect([...seen.params].filter(Boolean).sort()).toEqual(["AP Code", "Mobile No", "PAN", "PR Code"]);
  });

  it("Fill sample: the schema wins over the config (fields, choices, ranges)", () => {
    const narrow: Schema = { fields: SCHEMA.fields.map((f) => (f.name === "product" ? { ...f, choices: ["PERSONAL_LOAN"] }
      : f.name === "tenure_months" ? { ...f, rules: { integer: true, min: 1, max: 24 } } : f)) };
    for (let i = 0; i < 100; i += 1) {
      const state = C.applySample(C.generateSample(SAMPLE_CFG, narrow, seeded(1000 + i), TODAY), narrow);
      expect(state.values.product).toBe("PERSONAL_LOAN");
      expect(Number(state.values.tenure_months) <= 24).toBeTruthy();
      expect(state.values.property_value, "not in this schema -> not filled").toBe(undefined);
      expect(state.values.interest_rate_pct).toBe(undefined);
    }
  });

  it("Fill sample: a New sample carries no dedupe parameter; a PAN looks like a person's PAN", () => {
    for (let i = 0; i < 300; i += 1) {
      const s = C.generateSample(SAMPLE_CFG, FULL_SCHEMA, seeded(5000 + i), TODAY);
      if (s.customerType === "New") expect(C.applySample(s, FULL_SCHEMA).dedupeParameter).toBe("");
      if (s.dedupeParameter === "PAN") expect(s.dedupeValue).toMatch(/^[A-Z]{3}P[A-Z]\d{4}[A-Z]$/);
    }
  });

  it("Fill sample: a name never mixes genders (first and middle from one pool)", () => {
    const { male, female } = SAMPLE_CFG.names;
    const genderOf = (w: string) => (male.first.includes(w) || male.middle.includes(w) ? "m" : female.first.includes(w) || female.middle.includes(w) ? "f" : null);
    let withMiddle = 0;
    for (let i = 0; i < 400; i += 1) {
      const parts = C.generateSample(SAMPLE_CFG, FULL_SCHEMA, seeded(9000 + i), TODAY).values.full_name.split(" ");
      if (parts.length === 3) {
        withMiddle += 1;
        expect(genderOf(parts[0]), parts.join(" ")).toBe(genderOf(parts[1]));
      }
    }
    expect(withMiddle > 20).toBeTruthy();
  });

  it("what matched: plain sentences from the answer, no flags, scores or Y/N", () => {
    const lines = C.viewResult(REAL).matched.map((m) => m.text);
    expect(lines[0]).toMatch(/^This mobile number belongs to an existing SBFC customer in MIFIN \(Customer ID AP\*{6}18\)\.$/);
    expect(lines.some((t) => /same one you searched/.test(t))).toBeTruthy();
    expect(lines.some((t) => /No other case in the LOS has this mobile number/.test(t))).toBeTruthy();
    expect(!lines.some((t) => /\bY\b|score|flag|strong|potential_flag/i.test(t))).toBeTruthy();
    const none = clone(REAL);
    none.history.customer = { match: "NO_MATCH", customer_ref: null, searched_identifier_matches: null, warnings: [] };
    none.history.loan_count = 0;
    none.searched_parameter = "PR_CODE";
    none.los_dedupe.search = { status: "INSUFFICIENT_DATA", matches: [] };
    const t = C.viewResult(none).matched.map((m) => m.text);
    expect(t).toEqual(["No customer in MIFIN has this loan account number.",
      "The LOS does not store the loan account number, so only MIFIN was checked for it."]);
  });

  it("next steps: limits the business has not set are counted once, not listed as officer actions", () => {
    const v = C.viewResult(REAL);
    const waiting = REAL.evaluation.rules.filter((r: Json) => r.outcome === "NOT_EVALUATED" && r.reason === "THRESHOLD_UNCONFIGURED").length;
    expect(v.actions.limitsNotSet).toBe(waiting);
    expect(!v.actions.officer.some((a) => /once the business owner sets it/.test(a))).toBeTruthy();
    expect(v.actions.officer.length + waiting).toBe(new Set(REAL.next_actions).size);
  });

  it("policy checks: a title and what it checks for every rule; traffic-light tone; the rule id never shown", () => {
    const v = C.viewResult(REAL, UI_TEXT);
    for (const r of v.rules) {
      expect(UI_TEXT.rules[r.id], `ui_text.json has words for ${r.id}`).toBeTruthy();
      expect(r.view.title && r.view.what && r.view.reason, r.id).toBeTruthy();
      expect(!/H\d\d_/.test(`${r.view.title} ${r.view.what} ${r.view.reason}`), r.id).toBeTruthy();
      expect(r.view.tone).toBe(({ NOT_TRIGGERED: "pass", TRIGGERED: "fail", NOT_EVALUATED: "skip", EVALUATION_FAILED: "skip" } as Record<string, string>)[r.outcome]);
    }
    const skipped = v.rules.find((r) => r.reason === "THRESHOLD_UNCONFIGURED")!;
    expect(skipped.view.reason).toMatch(/business has not set this limit/);
  });

  it("what to do next: one plain message picked from the answer", () => {
    const pick = (mut: (r: Json) => void) => { const r = clone(REAL); mut(r); return C.guidance(r, UI_TEXT); };
    expect(pick(() => {}).key).toBe("EXISTING_CLEAN");
    expect(pick(() => {}).lines[0]).toMatch(/Customer ID AP\*{6}18/);
    const failed = pick((r) => { r.evaluation.rules[5].outcome = "TRIGGERED"; });
    expect(failed.key).toBe("EXISTING_FAILED");
    expect(failed.lines[0]).toMatch(/Found: /);
    expect(pick((r) => { r.customer_status = "POSSIBLE_EXISTING"; }).key).toBe("POSSIBLE_EXISTING");
    expect(pick((r) => { r.customer_status = "UNKNOWN"; }).key).toBe("UNKNOWN");
    expect(pick((r) => { r.customer_status = "NEW"; r.customer_type_check = { declared: "EXISTING" }; }).key).toBe("DECLARED_EXISTING_NOT_FOUND");
    expect(pick((r) => { r.customer_status = "NEW"; r.customer_type_check = null; }).key).toBe("NEW");
    expect(pick((r) => { r.customer_status = "NEW"; r.customer_type_check = null; r.los_dedupe.search.matches = [{ role: "CO_APPLICANT" }]; }).key).toBe("NEW_OTHER_CASES");
    const marked = pick((r) => { r.customer_type_check = { declared: "NEW" }; });
    expect(marked.lines.length, "marked New but found: told to change the customer type").toBe(2);
  });

  it("co-applicant: the checked party, MIFIN's role and each other LOS case's role reach the view", () => {
    const r = clone(REAL);
    r.checked_party = "CO_APPLICANT";
    r.history.customer.role_in_source = "CO_APPLICANT";
    r.los_dedupe.search.matches = [{ case_id: "REDACTED", visible: false, role: "PRIMARY_APPLICANT", product: null },
      { case_id: "CASE-SYN1", visible: true, role: "CO_APPLICANT", product: "HOME_LOAN" }];
    const v = C.viewResult(r, UI_TEXT);
    expect(v.checkedParty).toBe("CO_APPLICANT");
    expect(v.match.role).toBe("CO_APPLICANT");
    expect(v.otherCases.map((c) => [c.caseId, c.role])).toEqual([[null, "PRIMARY_APPLICANT"], ["CASE-SYN1", "CO_APPLICANT"]]);
    expect(UI_TEXT.roles.PRIMARY_APPLICANT).toBe("Applicant");
    expect(UI_TEXT.roles.CO_APPLICANT).toBe("Co-applicant");
  });

  it("Fill sample on Check an existing case: the last case, a party, a valid identifier from config", () => {
    const params = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const s = C.lookupSample(SAMPLE_CFG, "CASE-LAST", seeded(40000 + i));
      expect(s.caseId).toBe("CASE-LAST");
      expect(["Applicant", "Co-Applicant"].includes(s.party)).toBeTruthy();
      expect(single(s.parameter).pattern.test(s.value), `${s.parameter} ${s.value}`).toBeTruthy();
      params.add(s.parameter);
    }
    expect(params.size).toBe(4);
    expect(C.lookupSample(SAMPLE_CFG, "", seeded(1)).caseId).toBe("");
  });

  it("a possible match carries the confirmation; a recorded decision is said in plain words", () => {
    const r = clone(REAL);
    r.history.customer.match = "POTENTIAL_MATCH";
    r.history.customer.confirmation = { required: true, candidate: "dev1:abc", decision: null };
    expect(C.viewResult(r, UI_TEXT).confirmation).toEqual({ required: true, candidate: "dev1:abc", decision: null });
    r.history.customer.match = "CONFIRMED_MATCH";
    r.history.customer.confirmation = { required: false, candidate: "dev1:abc", decision: "SAME_CUSTOMER", decided_by: "OFFICER" };
    expect(C.viewResult(r, UI_TEXT).matched.some((m) => /An officer confirmed this is the same customer/.test(m.text))).toBeTruthy();
  });

  it("R01-R11: every rule shown in order; a rule missing from the answer is not checked; findings and gaps are honest", () => {
    const v = C.viewResult(REAL, UI_TEXT);
    expect(v.business.map((b) => b.id)).toEqual(["R01", "R02", "R03", "R04", "R05", "R06", "R07", "R08", "R09", "R10", "R11"]);
    for (const id of ["R08", "R09", "R10", "R11"]) {          // an older answer without H11-H14: "not checked", never clear
      const b = v.business.find((x) => x.id === id)!;
      expect(b.tone, id).toBe("skip");
      expect(b.reason).toMatch(/not in this answer/);
    }
    const r05 = v.business.find((x) => x.id === "R05")!;
    expect(r05.tone).toBe("skip");                                     // the fixture's limits are unset: never clear
    const found = clone(REAL);
    found.los_dedupe.search.matches = [{ case_id: "REDACTED", visible: false, role: "PRIMARY_APPLICANT" }];
    found.los_dedupe.search.status = "POSSIBLE_MATCH";
    found.evaluation.rules.find((x: Json) => x.rule_id === "H06_ADVERSE_HISTORY").outcome = "TRIGGERED";
    const w = C.viewResult(found, UI_TEXT).business;
    expect(w.find((x) => x.id === "R01")!.tone).toBe("fail");
    expect(w.find((x) => x.id === "R01")!.reason).toMatch(/other LOS cases with this identifier/);
    expect(w.find((x) => x.id === "R02")!.tone).toBe("fail");
    const mismatch = clone(REAL);
    mismatch.history.customer.searched_identifier_matches = false;
    expect(C.viewResult(mismatch, UI_TEXT).business.find((x) => x.id === "R07")!.tone).toBe("fail");
  });

  it("the one dedupe status: words and tone from config; an incomplete check names what is missing", () => {
    const r = clone(REAL);
    r.dedupe = { status: "NO_DUPLICATE_FOUND", search_complete: true, recommended_action: "CONTINUE", match_reasons: [], searches_missing: [] };
    expect((({ label, tone, action }) => ({ label, tone, action }))(C.viewResult(r, UI_TEXT).dedupe!))
      .toEqual({ label: "No duplicate found", tone: "ok", action: "Continue" });
    r.dedupe = { status: "CHECK_INCOMPLETE", search_complete: false, recommended_action: "MANUAL_REVIEW", match_reasons: [],
      searches_missing: ["MIFIN_UNAVAILABLE"] };
    const v = C.viewResult(r, UI_TEXT).dedupe!;
    expect(v.tone).toBe("bad");
    expect(v.missing).toEqual(["Mifin unavailable"]);
    delete r.dedupe;
    expect(C.viewResult(r, UI_TEXT).dedupe).toBe(null);
  });

  it("what to do next follows the one dedupe status: review evidence or an incomplete check is never 'go ahead'", () => {
    const r = clone(REAL);
    r.dedupe = { status: "POSSIBLE_DUPLICATE", match_reasons: ["MOBILE_MATCHES_EXISTING_CUSTOMER", "IDENTIFIER_ON_OTHER_LOS_CASES"], searches_missing: [] };
    const g = C.guidance(r, UI_TEXT);
    expect(g.key).toBe("EXISTING_OTHER_RECORDS");
    expect(g.lines[0]).toMatch(/identifier on other los cases/);
    r.dedupe = { status: "CHECK_INCOMPLETE", match_reasons: [], searches_missing: ["MIFIN_UNAVAILABLE"] };
    expect(C.guidance(r, UI_TEXT).key).toBe("CHECK_INCOMPLETE");
    r.dedupe = { status: "NO_DUPLICATE_FOUND", match_reasons: ["MOBILE_MATCHES_EXISTING_CUSTOMER", "EXISTING_LOANS_ON_RECORD"], searches_missing: [] };
    expect(C.guidance(r, UI_TEXT).key).toBe("EXISTING_CLEAN");      // an existing customer with loans is not a duplicate
  });

  it("Existing Loan Details: the Loan Existing columns, every value from a verified source, the rest 'not available'", () => {
    const cols = UI_TEXT.existing_loan_columns.map((c: Json) => c.key);
    expect(cols).toEqual(["prospect_code", "ap_code", "applicant_type", "product_name", "loan_amount", "principal_outstanding",
      "emi", "disbursement_date", "tenor", "roi", "loan_status", "cancel_reason", "common_applicant", "pan_match",
      "match_found"]);
    expect(UI_TEXT.loan_detail_fields.some((f: Json) => f.key === "overdue"), "overdue moved to the PR details, not dropped").toBeTruthy();
    expect(UI_TEXT.existing_loan_columns.every((c: Json) => c.label && c.source)).toBeTruthy();
    const r = clone(REAL);
    r.history.customer.role_in_source = "APPLICANT";
    const rows = C.existingLoanRows(C.viewResult(r, UI_TEXT), UI_TEXT);
    expect(rows.length).toBe(REAL.history.loans.length);
    const active = rows.find((x) => x.loan_status === "Active")!;
    expect(active.prospect_code).toBe("PR******53");
    expect(active.ap_code).toBe("AP******18");
    expect(active.applicant_type).toBe("Applicant");
    expect(active.disbursement_date).toBe("15-03-2024");
    expect(active.tenor).toBe("60 M 0 D");
    expect(active.roi, "ROI has no source: never invented").toBe(null);
    expect(active.match_found).toBe("✓ Same customer");
    expect(active.match_found_why).toMatch(/searched mobile number matched/);
    for (const row of rows) for (const k of cols) expect(k in row, k).toBeTruthy();
  });

  it("Match Found says WHAT matched: the searched loan account itself, or the same customer", () => {
    const r = clone(REAL);
    r.searched_parameter = "PR_CODE";
    r.history.loans[0].searched_loan_account = true;
    const rows = C.existingLoanRows(C.viewResult(r, UI_TEXT), UI_TEXT);
    expect(rows.filter((x) => x.match_found === "✓ This loan account").length).toBe(1);
    expect(rows.every((x) => ["✓ This loan account", "✓ Same customer"].includes(x.match_found as string))).toBeTruthy();
    const other = rows.find((x) => x.match_found === "✓ Same customer")!;
    expect(other.match_found_why).toMatch(/customer the searched loan account number matched/);
  });

  it("Dedupe Assessment Summary: every line from the answer; never a credit decision; co-applicant said honestly", () => {
    const r = clone(REAL);
    r.dedupe = dd();
    const s = C.assessmentSummary(r, UI_TEXT)!;
    const get = (k: string) => s.rows.find((x) => x.key === k)!;
    expect(get("overall").value).toBe("No duplicate found");
    expect(get("existing").value).toBe("Found");
    expect(get("applicant").value).toMatch(/existing customer \(AP\*{6}18\)/);
    expect(get("co").value).toMatch(/no co-applicant on this case/);
    expect(get("recommendation").value).toBe("Proceed to next stage");
    expect(s.note, "the 'not a credit decision' line was removed by the owner (2026-10-23)").toBe("");
    // an incomplete co-applicant check: incomplete, held, and the co-applicant row says so
    r.dedupe = dd({ status: "CHECK_INCOMPLETE", search_complete: false, parties_incomplete: ["CO_APPLICANT:NO_PAN_OR_MOBILE_ON_RECORD"],
      parties: [...dd().parties, { role: "CO_APPLICANT", status: "CHECK_INCOMPLETE", existing_customer: false, identifier_used: null,
        match_reasons: ["NO_PAN_OR_MOBILE_ON_RECORD"] }],
      assessment: { ...dd().assessment, duplicate_application: "UNKNOWN" },
      workflow_recommendation: { recommendation: "HOLD_FOR_REVIEW", reason: "r", next_action: "n" } });
    const t = C.assessmentSummary(r, UI_TEXT)!;
    expect(t.rows.find((x) => x.key === "co0")!.value).toMatch(/^Check incomplete – no SBFC customer record · no PAN or mobile on record/);
    expect(t.rows.find((x) => x.key === "complete")!.value).toBe("Incomplete – Co-applicant: No PAN or mobile on record");
    expect(t.rows.find((x) => x.key === "recommendation")!.value).toBe("Hold for review");
    // no approved rule: unable to decide, and the open question is shown
    r.dedupe = dd({ status: "DUPLICATE_FOUND", workflow_recommendation: { recommendation: "UNABLE_TO_DECIDE", policy_question: "block or hold?" } });
    const u = C.assessmentSummary(r, UI_TEXT)!;
    expect(u.rows.find((x) => x.key === "recommendation")!.value).toMatch(/Unable to decide/);
    expect(u.rows.find((x) => x.key === "question")!.value).toBe("block or hold?");
    delete r.dedupe;
    expect(C.assessmentSummary(r, UI_TEXT)).toBe(null);
  });

  it("a NEW customer: the agent did not run, the page says so and proceeds -- never 'no duplicate found'", () => {
    const r = clone(REAL);
    r.dedupe = { invoked: false, status: null, search_complete: true, searches_missing: [], parties_incomplete: [], parties: [],
      match_reasons: ["NEW_CUSTOMER_NO_RECORD"],
      trigger: { customer_lookup: "NEW", dedupe_invoked: false, reason: "New customer: MIFIN has no record." },
      assessment: { existing_customer_or_loan: "NOT_FOUND", duplicate_application: "NOT_EVALUATED", conflicts: [] },
      workflow_recommendation: { recommendation: "PROCEED_TO_NEXT_STAGE", next_action: "Continue with the normal LOS checks." } };
    const v = C.viewResult(r, UI_TEXT);
    expect(v.dedupe!.label).toBe("New customer – dedupe not required");
    const rows = Object.fromEntries(v.summary!.rows.map((x) => [x.key, x.value]));
    expect(rows.lookup).toBe("New customer: MIFIN has no record.");
    expect(rows.agent).toMatch(/Not invoked/);
    expect(rows.duplicate).toBe("Not evaluated – new customer");
    expect(!Object.values(rows).includes("No duplicate found")).toBeTruthy();
    expect(C.guidance(r, UI_TEXT).key).not.toBe("NEW_REVIEW");      // the new-customer reason is not review evidence
  });

  it("Existing Loan Details: constant columns go to the strip, all-empty columns are hidden but NAMED", () => {
    const cols = UI_TEXT.existing_loan_columns;
    const r = clone(REAL);
    r.history.loans.forEach((l: Json) => { delete l.lms; l.lms_status = "UNAVAILABLE"; });   // e.g. canceled loans: no LMS data
    const rows = C.existingLoanRows(C.viewResult(r, UI_TEXT), UI_TEXT);
    const { shown, empty, constant } = C.loanColumns(cols, rows, UI_TEXT);
    const keys = shown.map((c) => c.key);
    expect(!keys.includes("ap_code") && !keys.includes("applicant_type")).toBeTruthy();
    expect(constant).toEqual(["AP Code", "Applicant Type"]);
    expect(keys.includes("prospect_code") && keys.includes("loan_status") && keys.includes("loan_amount")).toBeTruthy();
    expect(empty.includes("ROI") && empty.includes("EMI")).toBeTruthy();
    expect(!keys.includes("roi")).toBeTruthy();
    expect(new Set([...keys, ...cols.filter((c: Json) => empty.includes(c.label)).map((c: Json) => c.key), "ap_code", "applicant_type"]).size,
      "every column is either shown, in the strip, or named as empty").toBe(cols.length);
  });

  it("a MIFIN scheme gets a friendly name only when the business maps it; otherwise shown as sent", () => {
    const r = clone(REAL);
    const raw = C.existingLoanRows(C.viewResult(r, UI_TEXT), UI_TEXT).map((x) => x.product_name);
    expect(raw).toEqual(REAL.history.loans.map((l: Json) => l.scheme));
    const text = { ...UI_TEXT, scheme_labels: { "ME NEW CUSTOMER": "Synthetic label" } };
    const rows = C.existingLoanRows(C.viewResult(r, text), text);
    const row = rows.find((x) => x.product_code === "ME NEW CUSTOMER")!;
    expect(row.product_name).toBe("Synthetic label");
  });

  it("co-applicants: add up to the schema max, errors named as the backend names them, sent only when declared", () => {
    let s = filled();
    expect(C.createBody(s, CO_SCHEMA).co_applicants, "no co-applicant: the body is unchanged").toBe(undefined);
    for (let i = 0; i < 5; i += 1) s = C.addCoApplicant(s, CO_SCHEMA);
    expect(s.coApplicants.length).toBe(3);
    s = C.removeCoApplicant(s, 2);
    s = C.setCoApplicantValue(s, 0, "full_name", "Sneha Joshi");
    s = C.setCoApplicantValue(s, 0, "pan", "abcpk4321l");
    s = C.setCoApplicantValue(s, 1, "pan", "NOT-A-PAN");
    const errors = C.validate(s, CO_SCHEMA, TODAY);
    expect(!errors["co_applicants[0].pan"], "lower-case PAN is upper-cased, then valid").toBeTruthy();
    expect(errors["co_applicants[1].full_name"] && errors["co_applicants[1].pan"]).toBeTruthy();
    s = C.setCoApplicantValue(s, 1, "full_name", "Rahul Joshi");
    s = C.setCoApplicantValue(s, 1, "pan", "");
    expect(C.createBody(s, CO_SCHEMA).co_applicants).toEqual([{ full_name: "Sneha Joshi", pan: "ABCPK4321L" }, { full_name: "Rahul Joshi" }]);
    expect(C.addCoApplicant(filled(), { fields: [] }).coApplicants.length, "a backend without the block: none").toBe(0);
  });

  it("Fill sample co-applicants: within the max, same family name, valid, gendered relationship and a sensible age", () => {
    let any = 0;
    for (let i = 0; i < 300; i += 1) {
      const sample = C.generateSample(SAMPLE_CFG, CO_SCHEMA, seeded(60000 + i), TODAY);
      const st = C.applySample(sample, CO_SCHEMA);
      expect(st.coApplicants.length <= 3).toBeTruthy();
      const last = st.values.full_name.split(" ").pop();
      for (const co of st.coApplicants) {
        any += 1;
        expect(co.full_name.split(" ").pop()).toBe(last);
        const g = SAMPLE_CFG.names.male.first.includes(co.full_name.split(" ")[0]) ? "male" : "female";
        expect(SAMPLE_CFG.co_applicants.relationships[g].includes(co.relationship), `${co.full_name} ${co.relationship}`).toBeTruthy();
      }
      expect(C.validateCoApplicants(st, CO_SCHEMA, TODAY), `draw ${i}`).toEqual({});
    }
    expect(any > 100).toBeTruthy();
  });

  it("what to do next counts a co-applicant's evidence: a possible match on co-applicant 2 is never 'continue'", () => {
    const r = clone(REAL);
    r.customer_status = "NEW";
    r.customer_type_check = null;
    r.los_dedupe.search.matches = [];
    r.dedupe = { invoked: true, status: "POSSIBLE_DUPLICATE", match_reasons: [], searches_missing: [], parties: [
      { role: "PRIMARY_APPLICANT", status: "NO_DUPLICATE_FOUND", match_reasons: [] },
      { role: "CO_APPLICANT", status: "NO_DUPLICATE_FOUND", match_reasons: ["PAN_MATCHES_EXISTING_CUSTOMER"] },
      { role: "CO_APPLICANT", status: "POSSIBLE_DUPLICATE", match_reasons: ["POSSIBLE_MATCH_NOT_CONFIRMED"] }] };
    const g = C.guidance(r, UI_TEXT);
    expect(g.key).toBe("NEW_REVIEW");
    expect(g.lines.join(" ")).toMatch(/Co-applicant 2: possible match not confirmed/);
    expect(!/Co-applicant 1/.test(g.lines.join(" ")), "an existing customer alone is not review evidence").toBeTruthy();
  });

  it("form fields like the LOS Sourcing screen: listed optional fields removed, never a required one, never sent", () => {
    const schema = C.formSchema(FULL_SCHEMA, UI_TEXT);
    const names = schema.fields.map((f) => f.name);
    for (const gone of ["email", "interest_rate_pct", "declared_monthly_income", "declared_monthly_obligations", "property_value"]) {
      expect(!names.includes(gone), gone).toBeTruthy();
    }
    for (const kept of ["full_name", "mobile", "date_of_birth", "address", "product", "loan_amount", "employment_type", "tenure_months", "property_type"]) {
      expect(names.includes(kept), kept).toBeTruthy();
    }
    // a required field stays even if someone lists it as hidden
    const forced = C.formSchema(FULL_SCHEMA, { form_hidden_fields: ["full_name", "email"] });
    expect(forced.fields.some((f) => f.name === "full_name")).toBeTruthy();
    // a sample that fills a removed field never sends it
    const sample = C.generateSample(SAMPLE_CFG, FULL_SCHEMA, seeded(7), TODAY);
    const body = C.createBody(C.applySample(sample, schema), schema);
    expect(!("email" in body.applicant) && !("declared_monthly_income" in body.application) && !("interest_rate_pct" in body.application)).toBeTruthy();
  });

  it("LOS Sourcing fields: Loan Purpose / Applicant Type free text, the Aadhaar-linked checkbox sends true / false", () => {
    const schema: Schema = { ...FULL_SCHEMA, fields: [...FULL_SCHEMA.fields,
      { name: "loan_purpose", group: "application", label: "Loan Purpose", required: false, rules: {} },
      { name: "applicant_type", group: "application", label: "Applicant Type", required: false, rules: {} },
      { name: "mobile_aadhaar_linked", group: "applicant", label: "Is it Aadhaar Linked Mobile No", required: false, rules: { boolean: true } }] };
    let s = filled();
    s = C.setValue(s, "loan_purpose", "Business Expansion");
    s = C.setValue(s, "applicant_type", "Individual");
    s = C.setValue(s, "mobile_aadhaar_linked", "true");
    expect(C.validate(s, schema, TODAY), "a checkbox is never invalid").toEqual({});
    const body = C.createBody(s, schema);
    expect(body.application.loan_purpose).toBe("Business Expansion");
    expect(body.application.applicant_type).toBe("Individual");
    expect(body.applicant.mobile_aadhaar_linked).toBe(true);
    expect(C.createBody(C.setValue(s, "mobile_aadhaar_linked", "false"), schema).applicant.mobile_aadhaar_linked).toBe(false);
    // Fill sample fills them only where the schema has them, from config
    const st = C.applySample(C.generateSample(SAMPLE_CFG, schema, seeded(3), TODAY), schema);
    expect(SAMPLE_CFG.sourcing.loan_purposes.includes(st.values.loan_purpose)).toBeTruthy();
    expect(["true", "false"].includes(st.values.mobile_aadhaar_linked)).toBeTruthy();
    expect(C.applySample(C.generateSample(SAMPLE_CFG, FULL_SCHEMA, seeded(3), TODAY), FULL_SCHEMA).values.loan_purpose).toBe(undefined);
  });

  it("AP / PR codes in full when the backend sends them (owner 2026-10-23); the masked ref otherwise", () => {
    const r = clone(REAL);
    r.history.customer.customer_code = "AP00745218";
    r.history.loans.forEach((l: Json, i: number) => { l.prospect_code = `PR0240775${i}`; });
    const v = C.viewResult(r, UI_TEXT);
    expect(v.match.ref).toBe("AP00745218");
    const rows = C.existingLoanRows(v, UI_TEXT);
    expect(rows.every((x) => /^PR\d{8}$/.test(x.prospect_code) && x.ap_code === "AP00745218")).toBeTruthy();
    expect(v.matched.some((m) => m.text.includes("AP00745218"))).toBeTruthy();
    const masked = C.viewResult(clone(REAL), UI_TEXT);
    expect(masked.match.ref.includes("*"), "no customer_code: the masked ref, never a guess").toBeTruthy();
  });

  it("a PR's details: every listed field, tenor as 'N M 0 D', values with no source are null (never invented)", () => {
    const keys = UI_TEXT.loan_detail_fields.map((f: Json) => f.key);
    expect(keys).toEqual(["ap_code", "common_applicant", "pan_match", "name_match", "dob_match", "applicant_type",
      "product_name", "product_code", "loan_amount",
      "disbursement_date", "principal_outstanding", "emi", "overdue", "foreclosure_interest", "tenor", "roi", "loan_status",
      "mifin_status", "lms_record", "status_why", "data_problems", "topup", "emi_bounces", "cancel_reason"]);
    expect(UI_TEXT.loan_detail_fields.every((f: Json) => f.label && f.source)).toBeTruthy();
    const rows = C.existingLoanRows(C.viewResult(clone(REAL), UI_TEXT), UI_TEXT);
    const d = C.loanDetail(rows.find((x) => x.loan_status === "Active")!, UI_TEXT);
    const get = (k: string) => d.find((x) => x.key === k)!.value;
    expect(get("tenor")).toBe("60 M 0 D");
    expect(get("roi")).toBe(null);
    expect(get("foreclosure_interest")).toBe(null);
    expect(get("disbursement_date")).toBe("15-03-2024");
    expect(C.tenor(120)).toBe("120 M 0 D");
    expect(C.tenor(null)).toBe(null);
    expect(C.tenor("x")).toBe(null);
  });

  it("What matched, field by field: what was entered AND what MIFIN holds, with the result (sir, 2026-10-23)", () => {
    const r = clone(REAL);
    r.history.customer.searched_identifier_matches = true;
    r.history.customer.identity_check = { name: "MATCH", dob: "MISMATCH", pan: "MATCH" };
    r.history.customer.identity_values = {
      entered: { name: "Test Person", dob: "1990-01-01", pan: "******678N", mobile: "98******00" },
      mifin: { name: "TEST PERSON", dob: "1990-01-02", pan: "******678N", mobile: "98******00" } };
    const v = C.viewResult(r, UI_TEXT);
    const rows = C.matchTable(v, { value: "9876500000" }, UI_TEXT);
    const by = (f: string) => rows.find((x) => x.field === f)!;
    expect(by("mobile number").entered, "shown masked (ui_text.json display_mask)").toBe("98******00");
    expect(by("mobile number").mifin).toBe("98******00");
    expect(by("mobile number").tone).toBe("ok");
    expect(by("Name").entered, "the case's own name when nothing was typed").toBe("Test Person");
    expect(by("Name").mifin, "MIFIN's name as it holds it").toBe("TEST PERSON");
    expect(by("Name").result).toBe("Matches");
    expect(by("Date of birth").entered).toBe("01-01-1990");
    expect(by("Date of birth").mifin).toBe("02-01-1990");
    expect(by("Date of birth").result).toBe("Does not match");
    expect(by("Date of birth").tone).toBe("bad");
    expect(by("PAN").mifin).toBe("******678N");
    // no values in the answer (switched off / MIFIN named no one): the sides stay empty, never guessed
    r.history.customer.searched_identifier_matches = false;
    r.history.customer.identity_check = null;
    r.history.customer.identity_values = null;
    const other = C.matchTable(C.viewResult(r, UI_TEXT), { value: "9876500000" }, UI_TEXT);
    expect(other[0].mifin, "a differing MIFIN value is shown only when the answer carries it").toBe(null);
    expect(other[0].result).toBe("Does not match");
    expect(other.find((x) => x.field === "Name")!.result).toBe("Not compared");
    expect(other.find((x) => x.field === "Name")!.entered).toBe(null);
  });

  it("every previous case (2, 3, any number): common applicant, PAN match, a cancelled loan's reason when given", () => {
    for (const n of [2, 3]) {
      const r = clone(REAL);
      r.history.loans = r.history.loans.slice(0, 1);
      while (r.history.loans.length < n) r.history.loans.push(clone(r.history.loans[0]));
      r.history.loans.forEach((l: Json, i: number) => {
        l.prospect_ref = `PR******${i}${i}`;
        l.effective_status = "CANCELED";
        l.applicant_check = { common_applicant: true, pan: "MATCH" };
        l.cancel_reason = i === 0 ? "Customer not interested" : null;
      });
      r.history.common_applicant = { cases: n, same_customer_on_all: true, pan: "MATCH", cancelled_cases: n, cancelled_with_reason: 1 };
      const v = C.viewResult(r, UI_TEXT);
      const rows = C.existingLoanRows(v, UI_TEXT);
      expect(rows.length).toBe(n);
      expect(rows.every((x) => x.common_applicant === "✓ Yes"), "checked on every case").toBeTruthy();
      expect(rows.every((x) => x.pan_match === "✓ Matches" && x.pan_tone === "ok")).toBeTruthy();
      expect(rows[0].cancel_reason).toBe("Customer not interested");
      expect(rows[1].cancel_reason, "no reason from the source: said so, never invented").toBe("Not given by source");
      const d = C.loanDetail(rows[1], UI_TEXT);
      expect(d.find((x) => x.key === "cancel_reason")!.value).toBe("Not given by source");
      expect(v.commonApplicant.cases).toBe(n);
    }
    const live = clone(REAL);
    live.history.loans.forEach((l: Json) => { l.applicant_check = { common_applicant: true, pan: "MISMATCH" }; });
    const rows = C.existingLoanRows(C.viewResult(live, UI_TEXT), UI_TEXT);
    expect(rows.every((x) => x.pan_match === "✗ Differs" && x.pan_tone === "bad")).toBeTruthy();
    const active = rows.find((x) => x.loan_status === "Active")!;
    expect(!C.loanDetail(active, UI_TEXT).some((x) => x.key === "cancel_reason"), "reason row only on a cancelled loan").toBeTruthy();
  });

  it("a cancellation reason never shows a PAN or mobile, even if the source sent one", () => {
    const r = clone(REAL);
    r.history.loans[0].effective_status = "CANCELED";
    r.history.loans[0].cancel_reason = "dup ABCPK4321L call 9876501111";
    const rows = C.existingLoanRows(C.viewResult(r, UI_TEXT), UI_TEXT);
    expect(!/ABCPK4321L|9876501111/.test(rows.map((x) => x.cancel_reason).join(" "))).toBeTruthy();
  });

  it("What matched: PAN checked even when the search was by mobile", () => {
    const r = clone(REAL);
    r.searched_parameter = "MOBILE";
    r.history.customer.identity_check = { pan: "MATCH", name: "NOT_COMPARED", dob: "NOT_COMPARED" };
    const rows = C.matchTable(C.viewResult(r, UI_TEXT), { value: "9876500000" }, UI_TEXT);
    const pan = rows.find((x) => x.field === "PAN")!;
    expect(pan.result).toBe("Matches");
    expect(pan.tone).toBe("ok");
  });

  it("Application Details (0012): Document Received Date never in the future; Co-origination Yes / No, unanswered not sent", () => {
    const schema: Schema = { ...FULL_SCHEMA, fields: [...FULL_SCHEMA.fields,
      { name: "document_received_date", group: "application", label: "Document Received Date", required: false, rules: { date: true, not_future: true } },
      { name: "co_origination", group: "application", label: "Co-origination", required: false, rules: { boolean: true, control: "yes_no" } }] };
    let s = filled();
    s = C.setValue(s, "document_received_date", "2026-06-20");
    s = C.setValue(s, "co_origination", "true");
    expect(C.validate(s, schema, TODAY)).toEqual({});
    const body = C.createBody(s, schema);
    expect(body.application.document_received_date).toBe("2026-06-20");
    expect(body.application.co_origination).toBe(true);
    expect(C.createBody(C.setValue(s, "co_origination", "false"), schema).application.co_origination).toBe(false);
    expect(!("co_origination" in C.createBody(C.setValue(s, "co_origination", ""), schema).application), "unanswered: not sent, never 'no'").toBeTruthy();
    const later = new Date(TODAY); later.setDate(later.getDate() + 1);
    const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    expect(C.validate(C.setValue(s, "document_received_date", ymd(later)), schema, TODAY).document_received_date).toMatch(/future/);
    expect(C.validate(C.setValue(s, "document_received_date", ymd(TODAY)), schema, TODAY).document_received_date).toBe(undefined);
    // Fill sample: a date within the configured window, a yes / no -- only where the schema has them
    const st = C.applySample(C.generateSample(SAMPLE_CFG, schema, seeded(5), TODAY), schema);
    const daysAgo = Math.round((new Date(ymd(TODAY)).getTime() - new Date(st.values.document_received_date).getTime()) / 86400000);
    const [lo, hi] = SAMPLE_CFG.sourcing.document_received_days_ago;
    expect(daysAgo >= lo && daysAgo <= hi, `${daysAgo} days ago`).toBeTruthy();
    expect(["true", "false"].includes(st.values.co_origination)).toBeTruthy();
    expect(C.applySample(C.generateSample(SAMPLE_CFG, FULL_SCHEMA, seeded(5), TODAY), FULL_SCHEMA).values.co_origination).toBe(undefined);
  });

  it("the form layout: no Loan Details section; product and property type in Application Details, LOS order", () => {
    const L = UI_TEXT.form_layout;
    expect(!("loan" in L)).toBeTruthy();
    expect(L.application_details).toEqual(["loan_amount", "product", "property_type", "@customer_type",
      "@dedupe_parameter", "@dedupe_value", "@tenure_years", "loan_purpose", "co_origination",
      "applicant_type", "employment_type", "mobile", "mobile_aadhaar_linked"]);
    // Document Received Date: off the form (owner 2026-10-23) -- hidden, so never shown, filled or sent
    expect(UI_TEXT.form_hidden_fields.includes("document_received_date")).toBeTruthy();
    const schema = C.formSchema({ ...FULL_SCHEMA, fields: [...FULL_SCHEMA.fields,
      { name: "document_received_date", group: "application", required: false, rules: { date: true, not_future: true } }] }, UI_TEXT);
    expect(!schema.fields.some((f) => f.name === "document_received_date")).toBeTruthy();
  });

  it("why this recommendation: 3 points at once; the model's points replace them only when they are sane", () => {
    const r = clone(REAL);
    r.explanation = { ...r.explanation, points: ["Hold for review.", "Found: a possible match.", "Next: check the record."],
      llm_reason_pending: true, fallback_reason: "LLM_DEFERRED", source: "DETERMINISTIC" };
    const v = C.viewResult(r, UI_TEXT);
    expect(v.explanation.points.length).toBe(3);
    expect(v.explanation.pending).toBe(true);
    const llm = C.applyReason(v, { points: ["One.", "Two.", "Three."], source: "LLM" });
    expect(llm.explanation.points).toEqual(["One.", "Two.", "Three."]);
    expect(llm.explanation.pointsSource).toBe("LLM");
    expect(llm.explanation.pending).toBe(false);
    for (const bad of [null, {}, { points: "x" }, { points: [] }, { points: ["1", "2", "3", "4"] }]) {
      const kept = C.applyReason(v, bad);
      expect(kept.explanation.points, JSON.stringify(bad)).toEqual(v.explanation.points);
      expect(kept.explanation.pending).toBe(false);
    }
    const masked = C.applyReason(v, { points: ["PAN ABCPK4321L.", "b.", "c."], source: "LLM" });
    expect(!masked.explanation.points.join(" ").includes("ABCPK4321L"), "never a PAN, even from the model").toBeTruthy();
  });

  it("a cancelled loan always shows its reason column; a live loan's is blank", () => {
    const r = clone(REAL);
    r.history.loans[0].effective_status = "CANCELED";
    r.history.loans[0].cancel_reason = null;
    const rows = C.existingLoanRows(C.viewResult(r, UI_TEXT), UI_TEXT);
    const { shown } = C.loanColumns(UI_TEXT.existing_loan_columns, rows, UI_TEXT);
    expect(shown.some((c) => c.key === "cancel_reason"), "never hidden when a loan is cancelled").toBeTruthy();
    expect(rows.filter((x) => !x.is_cancelled).every((x) => x.cancel_reason === null)).toBeTruthy();
  });

  it("the applicant fully evaluated in a PR's details: role, common applicant, PAN, name, DOB", () => {
    const r = clone(REAL);
    r.history.customer.role_in_source = "APPLICANT";
    r.history.loans.forEach((l: Json) => { l.applicant_check = { common_applicant: true, pan: "MATCH", name: "MISMATCH", dob: "NOT_COMPARED" }; });
    const row = C.existingLoanRows(C.viewResult(r, UI_TEXT), UI_TEXT)[0];
    const d = Object.fromEntries(C.loanDetail(row, UI_TEXT).map((x) => [x.key, x]));
    expect(d.name_match.value).toBe("✗ Differs");
    expect(d.name_match.tone).toBe("bad");
    expect(d.dob_match.value).toBe("Not compared");
    expect(d.pan_match.tone).toBe("ok");
    expect(d.applicant_type.value).toBe("Applicant");
    const customer = UI_TEXT.loan_detail_groups.find((g: Json) => g.title === "Customer").keys;
    expect(customer).toEqual(["ap_code", "applicant_type", "common_applicant", "pan_match", "name_match", "dob_match"]);
  });

  it("the summary in simple words: plain questions, answers only from the facts", () => {
    const r = clone(REAL);
    r.history.common_applicant = { cases: r.history.loans.length, pan: "MATCH" };
    r.dedupe = { invoked: true, status: "POSSIBLE_DUPLICATE", assessment: { duplicate_application: "POSSIBLE" },
      workflow_recommendation: { recommendation: "HOLD_FOR_REVIEW", next_action: "Check the other application." } };
    const v = C.viewResult(r, UI_TEXT);
    const by = Object.fromEntries(v.simple.map((x) => [x.key, x]));
    expect(by.customer.a).toMatch(/^Yes\. They are our customer/);
    expect(by.loans.a).toMatch(new RegExp(`^Yes, ${r.history.loans.length}: `));
    expect(by.pan.a).toMatch(/same PAN/);
    expect(by.duplicate.tone).toBe("warn");
    expect(by.decision.a).toBe("Wait. Someone must check it first.");
    expect(!("next" in by), "no 'what do I do next' row (owner 2026-10-23): point 3 of the reason says it").toBeTruthy();
    expect(v.simple.every((x) => x.q && x.a)).toBeTruthy();
    const fresh = clone(REAL);
    fresh.history.customer.match = "NO_MATCH"; fresh.history.loans = []; fresh.history.history_status = "NOT_APPLICABLE";
    fresh.dedupe = { invoked: false, workflow_recommendation: { recommendation: "PROCEED_TO_NEXT_STAGE" } };
    const s2 = Object.fromEntries(C.viewResult(fresh, UI_TEXT).simple.map((x) => [x.key, x.a]));
    expect(s2.customer).toBe("No. This is a new customer.");
    expect(s2.decision).toBe("Go ahead. Nothing here stops this application.");
    expect(!("pan" in s2), "no PAN line for a new customer").toBeTruthy();
  });

  it("a check waiting for a business limit says 'Limit not set', not a vague 'Not checked'", () => {
    const v = C.ruleView({ rule_id: "H07_EXISTING_LOAN_COUNT", outcome: "NOT_EVALUATED", reason: "THRESHOLD_UNCONFIGURED" }, UI_TEXT);
    expect(v.status).toBe("Limit not set");
    expect(v.reason).toMatch(/business has not set this limit/);
    expect(C.ruleView({ rule_id: "H06_ADVERSE_HISTORY", outcome: "NOT_EVALUATED", reason: "DATA_UNAVAILABLE" }, UI_TEXT).status).toBe("Not checked");
  });

  it("Application Details: Loan Purpose and Applicant Type are drop-downs from config; Fill sample picks from them", () => {
    const fc = UI_TEXT.form_choices;
    expect(fc.loan_purpose.length >= 5 && fc.applicant_type.includes("Individual")).toBeTruthy();
    for (let i = 0; i < 20; i += 1) {
      const st = C.generateSample(SAMPLE_CFG, { ...FULL_SCHEMA, fields: [...FULL_SCHEMA.fields,
        { name: "loan_purpose", group: "application", rules: {} }, { name: "applicant_type", group: "application", rules: {} }] }, seeded(i), TODAY);
      const v: Json = st.values || st;
      if (v.loan_purpose) expect(fc.loan_purpose.includes(v.loan_purpose), v.loan_purpose).toBeTruthy();
      if (v.applicant_type) expect(fc.applicant_type.includes(v.applicant_type), v.applicant_type).toBeTruthy();
    }
  });

  it("a PAN or mobile is shown masked, never in full; Marriage is a loan purpose", () => {
    expect(C.maskShown("PAN", "BCDPM5678N", UI_TEXT)).toBe("******678N");
    expect(C.maskShown("MOBILE", "9876502222", UI_TEXT)).toBe("98******22");
    expect(C.maskShown("PAN", "", UI_TEXT)).toBe(null);
    const r = clone(REAL);
    r.searched_parameter = "PAN";
    r.history.customer.searched_identifier_matches = true;
    const rows = C.matchTable(C.viewResult(r, UI_TEXT), { value: "BCDPM5678N", pan: "BCDPM5678N" }, UI_TEXT);
    expect(!JSON.stringify(rows).includes("BCDPM5678N"), "no full PAN in the table").toBeTruthy();
    expect(UI_TEXT.form_choices.loan_purpose.includes("Marriage")).toBeTruthy();
    expect(SAMPLE_CFG.sourcing.loan_purposes.every((x: string) => UI_TEXT.form_choices.loan_purpose.includes(x)), "sample values are drop-down values").toBeTruthy();
  });

  it("rules: all clear when nothing is found and every check ran", () => {
    const R = ruleWorld();
    // every rule runs now (owner 2026-10-23): R08-R11 read H12 / H13 / H14 / H11
    for (const id of ["R01", "R02", "R03", "R04", "R05", "R06", "R07", "R08", "R09", "R10", "R11"]) {
      expect(R[id].tone, `${id}: ${R[id].reason}`).toBe("pass");
    }
  });

  it("rules: each one says Found for its own evidence -- and only that rule", () => {
    const cases: [string, World][] = [
      ["R01", { search: "MATCH", matches: 2 }],
      ["R01", { scenarios: { S02_EXISTING_CUSTOMER: "DETECTED" } }],
      ["R02", { history: { H06_ADVERSE_HISTORY: { outcome: "TRIGGERED", next_action: "Review the settled loan." } } }],
      ["R02", { history: { H10_DPD: { outcome: "TRIGGERED" } } }],
      ["R03", { scenarios: { S12_DOCUMENT_REUSE: "DETECTED" } }],
      ["R04", { scenarios: { S09_ROLE_CHANGE: "DETECTED" } }],
      ["R05", { history: { H07_EXISTING_LOAN_COUNT: { outcome: "TRIGGERED" } } }],
      ["R05", { history: { H08_TOTAL_EXPOSURE: { outcome: "TRIGGERED" } } }],
      ["R05", { history: { H09_EMI_BURDEN: { outcome: "TRIGGERED" } } }],
      ["R06", { scenarios: { S10_SIMULTANEOUS_APPLICATION: "DETECTED" } }],
      ["R07", { ident: false }],
      ["R07", { scenarios: { S11_IDENTITY_CONFLICT: "DETECTED" } }],
      ["R07", { check: { pan: "MISMATCH", name: "MATCH", dob: "MATCH" } }],
      ["R07", { check: { pan: "MATCH", name: "MISMATCH", dob: "MATCH" } }],
      ["R07", { check: { pan: "MATCH", name: "MATCH", dob: "MISMATCH" } }],
      ["R08", { history: { H12_EMI_BOUNCES: { outcome: "TRIGGERED" } } }],
      ["R09", { history: { H13_FRAUD_HISTORY: { outcome: "TRIGGERED" } } }],
      ["R10", { history: { H14_COLLATERAL_REUSE: { outcome: "TRIGGERED" } } }],
      ["R11", { history: { H11_TOPUP_ELIGIBILITY: { outcome: "TRIGGERED" } } }],
    ];
    for (const [id, world] of cases) {
      const R = ruleWorld(world);
      expect(R[id].tone, `${id} ${JSON.stringify(world)}: ${R[id].reason}`).toBe("fail");
      expect(R[id].status).toBe("Found");
      expect(R[id].reason).toMatch(/^Found: /);
      const others = Object.values(R).filter((b) => b.id !== id && b.tone === "fail").map((b) => b.id);
      expect(others, `${JSON.stringify(world)} also flagged ${others}`).toEqual([]);
    }
    expect(ruleWorld({ history: { H06_ADVERSE_HISTORY: { outcome: "TRIGGERED", next_action: "Review the settled loan." } } }).R02.next,
      "a found check carries its next step").toEqual(["Review the settled loan."]);
  });

  it("rules: a limit the business has not set, or missing data, is never shown as clear", () => {
    const limits = Object.fromEntries(["H07_EXISTING_LOAN_COUNT", "H08_TOTAL_EXPOSURE", "H09_EMI_BURDEN", "H10_DPD"]
      .map((k) => [k, { outcome: "NOT_EVALUATED", reason: "THRESHOLD_UNCONFIGURED" }]));
    const R = ruleWorld({ history: limits });
    expect(R.R05.tone).toBe("skip");                                        // all three limits unset
    expect(R.R05.reason).toMatch(/limit not set by the business/);
    expect(R.R02.tone).toBe("partial");                                     // adverse clear, DPD limit unset
    expect(R.R02.reason).toMatch(/^Clear so far\. Not checked: repayment delays/);
    const noData = ruleWorld({ history: { H06_ADVERSE_HISTORY: { outcome: "NOT_EVALUATED", reason: "DATA_UNAVAILABLE" } } });
    expect(noData.R02.reason).toMatch(/data not available/);
    const noId = ruleWorld({ caseStatus: "INSUFFICIENT_DATA" });             // the case has no PAN / mobile on record
    for (const id of ["R04", "R06"]) expect(noId[id].tone, id).toBe("skip");
    expect(noId.R04.reason).toMatch(/no PAN or mobile on record/);
    const losDown = ruleWorld({ search: "FAILED" });
    expect(losDown.R01.tone).not.toBe("pass");
  });

  it("rules: R07 compares the applicant only against a MIFIN record they matched", () => {
    // no SBFC customer: nothing can disagree -> the comparisons do not apply -> "Nothing found", never "not checked"
    const none = ruleWorld({ match: "NO_MATCH", ident: null, check: {} });
    expect(none.R07.tone).toBe("pass");
    expect(none.R07.reason).toBe("Nothing found.");
    // MIFIN could not answer: genuinely not checked, in ONE short line grouped by why
    const down = ruleWorld({ match: "UNAVAILABLE", ident: null, check: {} });
    expect(down.R07.tone).toBe("partial");
    expect(down.R07.reason).toBe("Clear so far. Not checked: searched PAN / mobile, PAN, name, date of birth (MIFIN could not answer).");
    // a search by customer ID / loan account: the identifier comparison does not apply
    const byAp = clone(REAL);
    byAp.searched_parameter = "AP_CODE";
    byAp.history.customer.searched_identifier_matches = null;
    byAp.history.customer.identity_check = { pan: "MATCH", name: "MATCH", dob: "MATCH" };
    byAp.los_dedupe.case.scenarios = [{ scenario: "S11_IDENTITY_CONFLICT", status: "NOT_DETECTED" }];
    byAp.los_dedupe.case.status = "NO_MATCH";
    expect(C.businessRules(byAp, UI_TEXT).find((x) => x.id === "R07")!.tone).toBe("pass");
    const notEntered = ruleWorld({ check: { pan: "MATCH", name: "NOT_COMPARED", dob: "NOT_COMPARED" } });
    expect(notEntered.R07.tone).toBe("partial");
    expect(notEntered.R07.reason).toMatch(/not entered for this check/);
  });

  it("rules: R06 with a case sharing only the mobile is 'partly checked', never 'clear' and never 'found'", () => {
    const R = ruleWorld({ scenarios: { S11_POSSIBLE_MATCH: "DETECTED" } });
    expect(R.R06.tone).toBe("partial");
    expect(R.R06.reason).toMatch(/shares only this mobile \(same customer not proven – needs a PAN\)/);
  });

  it("Fill sample never picks the demo's MIFIN-error case (it would show 'Loan history unavailable')", () => {
    const all = JSON.stringify(SAMPLE_CFG);
    expect(!all.includes("EFGPS9753T"), "the error PAN is for the E2E negative test only").toBeTruthy();
    for (let i = 0; i < 200; i += 1) {
      const st = C.generateSample(SAMPLE_CFG, FULL_SCHEMA, seeded(i), TODAY);
      expect(st.dedupeValue).not.toBe("EFGPS9753T");
    }
  });

  it("the Status card says where a loan's status came from -- and why it is Disbursed or Unknown", () => {
    const r = clone(REAL);
    const base = r.history.loans[0];
    r.history.loans = [
      { ...clone(base), prospect_ref: "PR******01", effective_status: "ACTIVE", status_source: "LMS", lms_status: "FOUND", source_status: "DISBURSED" },
      { ...clone(base), prospect_ref: "PR******02", effective_status: "DISBURSED", status_source: "MIFIN", lms_status: "NOT_FOUND",
        source_status: "DISBURSED", lms: null, amount_problems: ["SANCTIONED_AMOUNT_NOT_A_NUMBER"] },
      { ...clone(base), prospect_ref: "PR******03", effective_status: "UNKNOWN", status_source: "MIFIN", lms_status: "UNAVAILABLE",
        source_status: "ON HOLD", lms: null },
    ];
    const rows = C.existingLoanRows(C.viewResult(r, UI_TEXT), UI_TEXT);
    const [live, disb, unk] = rows;
    expect(live.status_why).toBe("Confirmed by Leviosa.");
    expect(disb.loan_status).toBe("Disbursed");
    expect(disb.status_why).toMatch(/^Disbursed per MIFIN\. Leviosa has no record of it/);
    expect(disb.lms_record).toBe("No record");
    expect(disb.data_problems).toBe("loan amount is not a number");
    expect(unk.loan_status).toBe("Unknown");
    expect(unk.status_why).toMatch(/MIFIN's status "ON HOLD" is not mapped yet and Leviosa could not be reached/);
    const card = C.loanDetail(disb, UI_TEXT).map((d) => d.key);
    for (const k of ["loan_status", "status_why", "mifin_status", "lms_record", "data_problems"]) expect(card.includes(k), k).toBeTruthy();
  });

  it("no bare 'Partial' anywhere: totals, history and sources say what is missing; the LMS is named", () => {
    const r = clone(REAL);
    r.history.history_status = "PARTIAL";
    r.history.loans.forEach((x: Json, i: number) => { x.resolved = i !== 0; });
    r.history.aggregates.monthly_emi_burden = { status: "PARTIAL", value: null, loans_not_confirmed: ["PR******31", "PR******32"] };
    const v = C.viewResult(r, UI_TEXT);
    expect(v.totals!.emi.label).toBe("Not calculated · 2 loans not confirmed");
    expect(C.sourceLine({ source: "LMS", status: "PARTIAL", provider: "LEVIOSA", loans_resolved: 2, loans_total: 3 }, UI_TEXT))
      .toEqual({ name: "Leviosa", state: "2 of 3 loans found", tone: "warn" });
    expect(C.sourceLine({ source: "LMS", status: "UNAVAILABLE", provider: null }, UI_TEXT).name).toBe("Leviosa");
    const shown = JSON.stringify([v.history.label, v.totals!.emi.label, v.totals!.exposure.label]);
    expect(!/partial/i.test(shown), shown).toBeTruthy();
  });

  it("the officer reads 'Leviosa', never 'LMS' (owner 2026-10-23); the API's ids stay", () => {
    const visible: string[] = [];
    const walk = (o: unknown): void => { if (typeof o === "string") visible.push(o); else if (o && typeof o === "object") Object.values(o).forEach(walk); };
    walk(UI_TEXT);
    expect(visible.filter((x) => /LMS/.test(x))).toEqual([]);
    expect(C.sourceLine({ source: "LMS", status: "AVAILABLE", provider: "LEVIOSA" }, UI_TEXT).name).toBe("Leviosa");
    const r = clone(REAL);
    r.history.history_status = "MIFIN_ONLY";
    expect(C.viewResult(r, UI_TEXT).history.label).toBe("MIFIN only (Leviosa unavailable)");
  });

  it("the page never shows the word 'demo' (owner 2026-10-23)", () => {
    const visible: string[] = [];
    const walk = (o: unknown, key?: string): void => {
      if (typeof o === "string") { if (!/_note$/.test(key || "")) visible.push(o); } else if (o && typeof o === "object") {
        Object.entries(o).forEach(([k, v]) => walk(v, k));
      }
    };
    walk(UI_TEXT);
    expect(visible.filter((x) => /demo/i.test(x))).toEqual([]);
    for (const provider of ["DEMO", "LEVIOSA", null]) {
      expect(C.sourceLine({ source: "LMS", status: "AVAILABLE", provider }, UI_TEXT).name, String(provider)).toBe("Leviosa");
    }
  });

  it("a running loan's top-up result and EMI bounces in its details", () => {
    const r = clone(REAL);
    const live = r.history.loans.find((x: Json) => x.effective_status === "ACTIVE");
    live.topup = { status: "NOT_ELIGIBLE", reasons: ["TOO_SOON_AFTER_DISBURSAL", "OUTSTANDING_ABOVE_LIMIT"] };
    live.lms = { ...(live.lms || {}), emi_bounces_12m: 1 };
    const row = C.existingLoanRows(C.viewResult(r, UI_TEXT), UI_TEXT).find((x) => x.loan_status === "Active")!;
    expect(row.topup).toBe("✗ Not eligible (too soon after disbursal, too much still outstanding)");
    expect(row.topup_tone).toBe("bad");
    expect(row.emi_bounces).toBe("1");
    const d = Object.fromEntries(C.loanDetail(row, UI_TEXT).map((x) => [x.key, x]));
    expect(d.topup.tone).toBe("bad");
    live.topup = { status: "NOT_APPLICABLE", reasons: [] };
    expect(C.existingLoanRows(C.viewResult(r, UI_TEXT), UI_TEXT).find((x) => x.loan_status === "Active")!.topup).toBe(null);
  });

  it("other LOS cases with the same identifier: one counted line, never a list of case IDs", () => {
    const r = clone(REAL);
    r.searched_parameter = "PAN";
    r.los_dedupe.search = { status: "MATCH", matches: [
      ...Array.from({ length: 5 }, () => ({ visible: true, case_id: "CASE-X", role: "CO_APPLICANT", product: "HOME_LOAN" })),
      ...Array.from({ length: 3 }, () => ({ visible: true, case_id: "CASE-Y", role: "CO_APPLICANT", product: "PERSONAL_LOAN" })),
      { visible: false, role: "PRIMARY_APPLICANT", product: "LOAN_AGAINST_PROPERTY" }] };
    const line = C.otherCasesLine(C.viewResult(r, UI_TEXT), UI_TEXT, null, null);
    expect(line).toBe("9 other LOS cases have this PAN · as co applicant 8, primary applicant 1 · Home loan 5, Personal loan 3, Loan against property 1");
    expect(!line.includes("CASE-")).toBeTruthy();
  });

  it("What matched, searched by the customer ID: one row with the ID on both sides and the match (sir, 2026-10-23)", () => {
    const r = clone(REAL);
    r.searched_parameter = "AP_CODE";
    const v = C.viewResult(r, UI_TEXT);
    const rows = C.matchTable(v, { value: v.match.ref }, UI_TEXT);
    const ids = rows.filter((x) => /Customer ID/.test(x.field));
    expect(ids.length, "the customer ID once, not twice").toBe(1);
    expect(ids[0].entered).toBe(v.match.ref);
    expect(ids[0].mifin).toBe(v.match.ref);
    expect(ids[0].result).toBe(v.match.label);
  });

  it("What matched: a loan-account search shows the account on both sides; no MIFIN customer says why", () => {
    const r = clone(REAL);
    r.searched_parameter = "PR_CODE";
    const v = C.viewResult(r, UI_TEXT);
    const pr = C.matchTable(v, { value: "PR02407753" }, UI_TEXT)[0];
    expect([pr.entered, pr.mifin, pr.result]).toEqual(["PR02407753", "PR02407753", v.match.label]);
    for (const [code, said] of [["NO_MATCH", "Not in MIFIN"], ["AMBIGUOUS", "More than one customer in MIFIN"],
      ["SOURCE_ERROR", "MIFIN could not answer"]]) {
      const n = clone(REAL);
      n.searched_parameter = "PAN";
      n.history.customer.match = code;
      const row = C.matchTable(C.viewResult(n, UI_TEXT), { value: "ZZZPZ1111Z" }, UI_TEXT)[0];
      expect(row.result, code).toBe(said);
      expect(row.mifin).toBe(null);
    }
  });

  // ---- All parameters (sir, 2026-10-24) -------------------------------------------------------------------------
  it("All parameters: each value optional, each in its own format; the request names the mode", () => {
    const ok = C.allValues({ pan: "bcdpm5678n", mobile: "+91 98765 02222", ap_code: "", pr_code: "PR02407753" });
    expect(ok.errors).toEqual({});
    expect(ok.body).toEqual({ pan: "BCDPM5678N", mobile: "9876502222", pr_code: "PR02407753" });
    expect(C.allValues({ ap_code: "AP1" }).errors.ap_code, "a malformed customer ID is refused").toBeTruthy();
    expect(C.parameter("All parameters")!.all).toBe(true);
    expect(C.PARAMETER_OPTIONS.some((p) => p.all), "offered in the drop-down").toBeTruthy();
  });

  it("All parameters view: a conflict is said, the combined rules name which parameter found them", () => {
    const a = clone(REAL); a.searched_parameter = "PAN";
    const b = clone(REAL); b.searched_parameter = "MOBILE";
    const data = {
      request_id: "dda_1", checked: ["PAN", "MOBILE"], missing: [{ parameter: "AP_CODE" }, { parameter: "PR_CODE" }],
      rows: [
        { parameter: "PAN", value_shown: "******678N", source: "ENTERED", match: "CONFIRMED_MATCH", customer_code: "AP00745218",
          recommendation: "PROCEED_TO_NEXT_STAGE", rule_findings: [], result: a },
        { parameter: "MOBILE", value_shown: "98******11", source: "CASE_RECORD", match: "CONFIRMED_MATCH", customer_code: "AP00731942",
          recommendation: "HOLD_FOR_REVIEW", rule_findings: ["NAME_DIFFERS_FROM_MIFIN_RECORD"], result: b }],
      consistency: { status: "CONFLICT", customers: ["AP00731942", "AP00745218"],
        by_parameter: [{ parameter: "PAN", customer: "AP00745218" }, { parameter: "MOBILE", customer: "AP00731942" }] },
      combined: { recommendation: "HOLD_FOR_REVIEW", reason_codes: ["PARAMETERS_POINT_TO_DIFFERENT_CUSTOMERS"] } };
    const v = C.allView(data, UI_TEXT);
    expect(v.combined.label).toBe("Hold for review");
    expect(v.consistency.tone).toBe("bad");
    expect(v.consistency.text).toMatch(/different customers: AP00731942 and AP00745218/);
    expect(v.rows.map((r) => r.from)).toEqual(["Entered", "Case record"]);
    expect(v.rows[1].findings[0]).toBe("Name differs from MIFIN");
    expect(v.missing).toEqual(["Customer ID (AP code)", "Loan account (PR code)"]);
    expect(v.rows.every((r) => r.view && r.view.requestId !== undefined), "each row opens its own detailed view").toBeTruthy();
    const ids = v.business.map((x) => x.id);
    expect(new Set(ids).size, "each rule once").toBe(ids.length);
    for (const rule of v.business.filter((x) => x.tone === "fail")) expect(rule.reason).toMatch(/Found via /);
    expect(!JSON.stringify(v.rows.map(({ view, ...r }) => r)).match(/BCDPM5678N|9876501111/), "no full PAN / mobile").toBeTruthy();
  });
});
