// The screen's pure logic: money, error wording, the entry prefill and the request body.
import type { CasePayload, Entry, FieldSpec, Form, Inputs } from "../types";

export const inr = (v: unknown) =>
  v === null || v === undefined || v === ""
    ? "—"
    : "₹" + Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 });

export const pretty = (s: string | null | undefined) => (s || "").replace(/_/g, " ");

/** a value / limit cell of the checks table */
export const lim = (x: unknown) =>
  x === null || x === undefined ? "—" : typeof x === "object" ? JSON.stringify(x) : String(x);

/** FastAPI validation lists, the LOS error shape, else the status */
export function errorText(e: unknown): string {
  const err = e as { status?: number; data?: unknown } | null;
  const d = err?.data as { detail?: unknown; error?: { message?: string } } | null | undefined;
  if (d && Array.isArray(d.detail)) {
    return (d.detail as { loc?: unknown[]; msg?: string }[])
      .map((x) => `${(x.loc || []).slice(1).join(".")}: ${String(x.msg || "").replace(/^Value error, /, "")}`)
      .join(" · ");
  }
  const detail = d?.detail as { message?: string } | undefined;
  if (detail && typeof detail === "object" && detail.message) return detail.message;
  if (d?.error?.message) return d.error.message;
  return `Request failed (${err?.status || "network"})`;
}

/** a number field ("", "12.5"); text and select fields are kept as strings */
export const isNumeric = (f: FieldSpec) => f.type !== "text" && f.type !== "select";

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

function valuesOf(fields: FieldSpec[], source: Record<string, unknown> | undefined): Record<string, string> {
  return Object.fromEntries(fields.map((f) => [f.key, str(source?.[f.key])]));
}

export function fieldsFor(form: Form, kind: "income" | "topup", chosen: string): FieldSpec[] {
  const spec = (kind === "income" ? form.income_methods : form.topup_types)[chosen];
  return spec?.fields || [];
}

export function emptyGroup(form: Form, kind: "income" | "topup", chosen: string) {
  return valuesOf(fieldsFor(form, kind, chosen), undefined);
}

/** the entry prefilled from the saved entries, else the case */
export function initialEntry(form: Form, payload: CasePayload): Entry {
  const c = payload.case || {};
  const saved = payload.saved?.inputs || {};
  const wanted = String(saved.product || c.product || "");
  const incomeMethod = String(saved.income?.method || "");
  const topupType = String(saved.topup?.type || "");
  const loan: Record<string, string> = {};
  for (const f of form.editable || []) loan[f.key] = str(saved[f.key] ?? c[f.key]);
  return {
    // a product the list does not carry shows (and sends) the first one, as a plain <select> would
    product: form.products.includes(wanted) ? wanted : form.products[0] || "",
    loan,
    incomeMethod,
    income: valuesOf(fieldsFor(form, "income", incomeMethod), saved.income),
    topupType,
    topup: valuesOf(fieldsFor(form, "topup", topupType), saved.topup),
    collateral: str(saved.collateral_type),
    occupancy: str(saved.occupancy_type),
    existingExposure: str(saved.existing_exposure),
  };
}

function num(v: string | undefined): number | null {
  const t = (v ?? "").trim();
  return t === "" ? null : Number(t);
}

function group(fields: FieldSpec[], values: Record<string, string>, into: Record<string, unknown>) {
  for (const f of fields) {
    if (isNumeric(f)) {
      const v = num(values[f.key]);
      if (v !== null) into[f.key] = v;
    } else {
      const v = (values[f.key] ?? "").trim();
      if (v !== "") into[f.key] = v;
    }
  }
}

/** the request body: only what is filled in */
export function collect(form: Form, e: Entry): Inputs {
  const body: Inputs = { product: e.product || null };
  for (const f of form.editable || []) {
    const v = num(e.loan[f.key]);
    if (v !== null) body[f.key] = v;
  }
  if (e.incomeMethod) {
    body.income = { method: e.incomeMethod };
    group(fieldsFor(form, "income", e.incomeMethod), e.income, body.income);
  }
  if (e.topupType) {
    body.topup = { type: e.topupType };
    group(fieldsFor(form, "topup", e.topupType), e.topup, body.topup);
  }
  if (e.collateral) body.collateral_type = e.collateral;
  if (e.occupancy) body.occupancy_type = e.occupancy;
  const ex = num(e.existingExposure);
  if (ex !== null) body.existing_exposure = ex;
  return body;
}

/** a read-only case value: money fields (label carries ₹) as rupees */
export function caseValue(label: string, v: unknown): string {
  if (v === null || v === undefined) return "not on record";
  return /₹/.test(label) ? inr(v) : String(v);
}
