// New application: the form in the LOS Sourcing screen's order (ui_text.json form_layout): Application Details,
// Primary Applicant, (Co-applicants), Loan Details. Fields, rules and choices come from GET /api/v1/fos/form-schema;
// a backend field the layout does not name goes to Loan Details -- never dropped.
import { useState, type ReactNode } from "react";
import * as C from "../core";
import type { FormSchema, FormState, SchemaField, UiText } from "../types";
import { BusyButton, label } from "./kit";

type Errors = Record<string, string | null>;

export interface ApplyFormProps {
  schema: FormSchema;
  text: UiText;
  form: FormState;
  errors: Errors;
  summary: string;
  busy: boolean;
  /** an edit: the new form state; `clear` names the error slots to clear (the old page's showFieldError(name, null)) */
  onChange: (next: FormState, clear?: string[]) => void;
  onError: (name: string, message: string | null) => void;
  onSubmit: () => void;
  onReset: () => void;
}

const fieldHint = (f: SchemaField): string | null => {
  const r = (f.rules || {}) as Record<string, unknown>;
  if (r.date && "min_age" in r) return `Applicant aged ${r.min_age}–${r.max_age}.`;
  if ("min" in r && "max" in r) return `Between ${r.min} and ${r.max}.`;
  if (f.name === "mobile") return "10-digit mobile (+91 allowed).";
  if (r.number) return "In rupees. Product limits are checked by the backend.";
  return null;
};

/** A PAN / mobile box shows the value MASKED while it is not being edited (ui_text.json display_mask), the full value
 * only while the officer is typing in it. The real value lives in the form state, which is what is sent. */
export function MaskedInput({ value, kind, text, onValue, ...rest }:
  { value: string; kind: string | null; text: UiText; onValue: (v: string) => void } &
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const [focused, setFocused] = useState(false);
  const shown = focused || !kind ? value : (C.maskShown(kind, value, text) || "");
  return (
    <input {...rest} value={shown}
      onFocus={(e) => { setFocused(true); const el = e.currentTarget; if (el.value !== value) requestAnimationFrame(() => el.select()); }}
      onBlur={() => setFocused(false)}
      onChange={(e) => onValue(e.target.value)} />
  );
}

const ErrorSlot = ({ id, message }: { id?: string; message?: string | null }) =>
  <p className="field-error" id={id} role="alert">{message || ""}</p>;

export default function ApplyForm(p: ApplyFormProps) {
  const { schema, text, form, errors } = p;
  const labels = (text.form_labels || {}) as Record<string, string>;
  const layout = (text.form_layout || {}) as Record<string, string[]>;
  const param = C.parameter(form.dedupeParameter);
  const existing = form.customerType === "Existing";
  const maskKind = ({ PAN: "PAN", "Mobile No": "MOBILE" } as Record<string, string>)[form.dedupeParameter] || null;

  const set = (name: string, value: string) => {
    let next = C.setValue(form, name, value);
    if (name === "product") {
      // a product change: a field that depends on it (rules.by_product) is cleared when the new product does not offer it
      for (const raw of (schema.fields || [])) {
        if (!(raw.rules && (raw.rules as Record<string, unknown>).by_product)) continue;
        const f = C.effectiveField(raw, next.values);
        const v = next.values[raw.name];
        if (v && (f.hidden || !((f.choices || []) as string[]).includes(String(v)))) next = C.setValue(next, raw.name, "");
      }
    }
    p.onChange(next, [name]);
  };

  // ---- the page's own controls (placed by "@slot" names in the layout)
  const statics: Record<string, ReactNode> = {
    customer_type: (
      <div className="field" data-slot="customer_type" key="@customer_type">
        <label htmlFor="customer-type">Customer Type <span className="req">*</span></label>
        <select id="customer-type" value={form.customerType || ""}
          onChange={(e) => p.onChange(C.setCustomerType(form, e.target.value),
            e.target.value !== "Existing" ? ["customerType", "dedupeParameter", "dedupeValue"] : ["customerType"])}>
          <option value="">Choose…</option><option value="New">New</option><option value="Existing">Existing</option>
        </select>
        <p className="hint">Existing = already has an AP code / earlier loan.</p>
      </div>
    ),
    dedupe_parameter: (
      <div className="field" data-slot="dedupe_parameter" id="w-dedupe-parameter" hidden={!existing} key="@dedupe_parameter">
        <label htmlFor="dedupe-parameter">Dedupe Parameter <span className="req">*</span></label>
        <select id="dedupe-parameter" value={form.dedupeParameter}
          onChange={(e) => p.onChange(C.setDedupeParameter(form, e.target.value))}>
          <option value="">Choose…</option>
          {C.PARAMETER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <p className="hint" id="dedupe-parameter-hint">{param ? param.hint : ""}</p>
        <ErrorSlot id="err-dedupeParameter" message={errors.dedupeParameter} />
      </div>
    ),
    dedupe_value: (
      <div className="field" data-slot="dedupe_value" id="w-dedupe-value" hidden={!existing || Boolean(param && "all" in param && param.all)} key="@dedupe_value">
        <label htmlFor="dedupe-value">Dedupe Parameter Value <span className="req">*</span></label>
        <MaskedInput id="dedupe-value" autoComplete="off" spellCheck={false} disabled={!param} placeholder={param ? param.hint : ""}
          value={form.dedupeValue} kind={maskKind} text={text}
          onValue={(v) => p.onChange({ ...form, dedupeValue: v }, ["dedupeValue"])} />
        <p className="hint" id="dedupe-value-hint">{param ? param.hint : "Choose a parameter first."}</p>
        <ErrorSlot id="err-dedupeValue" message={errors.dedupeValue} />
      </div>
    ),
    dedupe_all: (
      <div className="field all-values" data-slot="dedupe_all" id="w-dedupe-all" hidden={!existing || !(param && "all" in param && param.all)} key="@dedupe_all">
        <label>Also check (optional)</label>
        <div className="all-grid">
          {([["ap_code", "Customer ID, e.g. AP00012345", "Customer ID"], ["pr_code", "Loan account, e.g. PR00012345", "Loan account"]] as const)
            .map(([field, placeholder, aria]) => (
              <input key={field} id={`dedupe-all-${field}`} placeholder={placeholder} autoComplete="off" spellCheck={false} aria-label={aria}
                value={((form.allValues || {}) as Record<string, string>)[field] || ""}
                onChange={(e) => p.onChange({ ...form, allValues: { ...(form.allValues || {}), [field]: e.target.value } }, ["dedupeAll"])} />
            ))}
        </div>
        <p className="hint">PAN and mobile come from this form. Every parameter with a value is checked.</p>
        <ErrorSlot id="err-dedupeAll" message={errors.dedupeAll} />
      </div>
    ),
  };

  // ---- Loan Tenure (Years): a whole-year choice inside the backend's own tenure_months limits; sent as months
  const tenureYears = (field: SchemaField | undefined) => {
    if (!field) return null;
    const r = (field.rules || {}) as { min?: number; max?: number };
    const lo = Math.max(1, Math.ceil((r.min || 12) / 12));
    const hi = Math.max(lo, Math.floor((r.max || 480) / 12));
    const months = Number(form.values.tenure_months);
    const err = errors.tenure_months;
    return (
      <div className={`field${err ? " invalid" : ""}`} data-field="tenure_months" key="@tenure_years">
        <label htmlFor="f-tenure_years">{labels.tenure_years || "Loan Tenure (Years)"}</label>
        <select id="f-tenure_years" aria-describedby="f-tenure_years-hint f-tenure_months-err" aria-invalid={err ? "true" : "false"}
          value={months && months % 12 === 0 ? String(months / 12) : ""}
          onChange={(e) => p.onChange(C.setValue(form, "tenure_months", e.target.value ? String(Number(e.target.value) * 12) : ""), ["tenure_months"])}>
          <option value="">Choose…</option>
          {Array.from({ length: hi - lo + 1 }, (_, i) => <option key={i} value={String(lo + i)}>{String(lo + i)}</option>)}
        </select>
        <p className="hint" id="f-tenure_years-hint">{`${lo}–${hi} years.`}</p>
        <ErrorSlot id="f-tenure_months-err" message={err} />
      </div>
    );
  };

  // ---- one schema field
  const fieldNode = (raw: SchemaField) => {
    const f = C.effectiveField(raw, form.values) as SchemaField & { hidden?: boolean; defaultValue?: string | null };
    const id = `f-${f.name}`;
    const r = (f.rules || {}) as Record<string, unknown>;
    const err = errors[f.name] || null;
    const now = String(form.values[f.name] ?? "");
    const title = labels[f.name] || f.label;
    if (r.boolean && r.control === "yes_no") {            // Yes / No radios (e.g. Co-origination): none chosen = not sent
      return (
        <div className={`field${err ? " invalid" : ""}`} data-field={f.name} role="radiogroup" aria-labelledby={`${id}-label`} key={f.name}>
          <span className="label" id={`${id}-label`}>{title}</span>
          <div className="yn">
            {([["true", "Yes"], ["false", "No"]] as const).map(([val, word]) => (
              <label className="yn-opt" htmlFor={`${id}-${val}`} key={val}>
                <input type="radio" name={id} value={val} id={`${id}-${val}`} checked={now.toLowerCase() === val}
                  onChange={() => p.onChange(C.setValue(form, f.name, val), [f.name])} />
                <span>{word}</span>
              </label>
            ))}
          </div>
          <ErrorSlot id={`${id}-err`} message={err} />
        </div>
      );
    }
    if (r.boolean) {                                      // a yes / no checkbox, e.g. "Is it Aadhaar Linked Mobile No"
      return (
        <div className={`field check-field${err ? " invalid" : ""}`} data-field={f.name} key={f.name}>
          <label className="check-label" htmlFor={id}>
            <input id={id} name={f.name} type="checkbox" checked={now.toLowerCase() === "true"}
              onChange={(e) => p.onChange(C.setValue(form, f.name, e.target.checked ? "true" : "false"))} />
            <span>{title}</span>
          </label>
          <ErrorSlot id={`${id}-err`} message={err} />
        </div>
      );
    }
    const listed = (textChoices(text)[f.name]) as string[] | undefined;
    const common = {
      id, name: f.name, required: f.required || undefined, value: now, "aria-invalid": (err ? "true" : "false") as "true" | "false",
      onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) => p.onError(f.name, C.validateField(f, e.currentTarget.value)),
    };
    let control: ReactNode;
    if (Array.isArray(f.choices) && f.choices.length) {
      control = (
        <select {...common} aria-describedby={`${id}-hint`} onChange={(e) => set(f.name, e.target.value)}>
          <option value="">Choose…</option>
          {(f.choices as string[]).map((c) => <option key={c} value={c}>{label(c)}</option>)}
        </select>
      );
    } else if (Array.isArray(listed) && listed.length) {         // a free-text field with a configured list
      control = (
        <select {...common} aria-describedby={`${id}-hint`} onChange={(e) => set(f.name, e.target.value)}>
          <option value="">Choose…</option>
          {listed.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      );
    } else {
      const auto = ({ full_name: "name", mobile: "tel", email: "email", address: "street-address" } as Record<string, string>)[f.name] || "off";
      control = (
        <input {...common} type={r.date ? "date" : f.name === "email" ? "email" : "text"}
          inputMode={r.number || r.integer ? "decimal" : f.name === "mobile" ? "tel" : undefined}
          maxLength={f.max_length || undefined} autoComplete={auto} aria-describedby={`${id}-hint ${id}-err`}
          onChange={(e) => set(f.name, e.target.value)} />
      );
    }
    const hint = f.defaultValue ? `Leave blank for ${label(f.defaultValue)}.` : fieldHint(f);
    return (
      <div className={`field${f.name === "address" ? " wide" : ""}${err ? " invalid" : ""}`} data-field={f.name} hidden={f.hidden || undefined} key={f.name}>
        <label htmlFor={id}>{title}{f.required ? <span className="req" aria-hidden="true"> *</span> : null}</label>
        {control}
        <p className="hint" id={`${id}-hint`}>{hint || ""}</p>
        <ErrorSlot id={`${id}-err`} message={err} />
      </div>
    );
  };

  // ---- place everything: the layout's order first, then every field the layout does not name
  const boxes: Record<string, ReactNode[]> = { application_details: [], applicant: [], loan: [] };
  const byName = Object.fromEntries((schema.fields || []).map((f) => [f.name, f]));
  const placed = new Set(["tenure_months"]);
  for (const [section, names] of Object.entries(layout)) {
    if (!boxes[section]) continue;
    for (const name of names || []) {
      if (name.startsWith("@")) {
        const node = name === "@tenure_years" ? tenureYears(byName.tenure_months) : statics[name.slice(1)];
        if (node) boxes[section].push(node);
      } else if (byName[name]) {
        boxes[section].push(fieldNode(byName[name]));
        placed.add(name);
      }
    }
  }
  const rest = layout.loan ? boxes.loan : boxes.application_details;      // never dropped
  for (const f of (schema.fields || [])) {
    if (!placed.has(f.name)) (f.group === "applicant" && !layout.applicant ? boxes.applicant : rest).push(fieldNode(f));
  }

  // ---- co-applicants (schema.co_applicants: the backend's own list and rules, up to its max)
  const sch = C.coApplicantSchema(schema);
  const cos = (form.coApplicants || []) as Record<string, string>[];
  const full = cos.length >= sch.max;

  return (
    <form id="apply-form" className="form-grid" noValidate onSubmit={(e) => { e.preventDefault(); p.onSubmit(); }}>
      <article className="card span-2" aria-labelledby="h-appdetails">
        <header className="card-head"><span className="ico ico-brand"><svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8 M8 12h8 M8 16h5" /></svg></span>
          <div><h2 id="h-appdetails">Application Details</h2><p>Amount, product, customer type and the dedupe identifier.</p></div></header>
        <div className="fields three" id="fields-top">{boxes.application_details}</div>
        <ErrorSlot id="err-customerType" message={errors.customerType} />
      </article>

      <article className="card span-2" aria-labelledby="h-applicant">
        <header className="card-head"><span className="ico ico-violet"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="11" r="2.2" /><path d="M6 16c.8-1.5 2-2.2 3-2.2s2.2.7 3 2.2 M14.5 10h4 M14.5 13h3" /></svg></span>
          <div><h2 id="h-applicant">Primary Applicant KYC Details</h2><p>As on the applicant's KYC documents.</p></div></header>
        <div className="fields three" id="fields-applicant">{boxes.applicant}</div>
      </article>

      {sch.max ? (
        <article className="card span-2" id="coapp-card" aria-labelledby="h-coapp">
          <header className="card-head"><span className="ico ico-violet"><svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5" /><circle cx="17" cy="9" r="2.5" /><path d="M2.5 20c1-3.5 3.8-5.5 6.5-5.5s5.5 2 6.5 5.5 M15 14.8c2.6.2 4.8 1.9 5.6 4.7" /></svg></span>
            <div><h2 id="h-coapp">Co-applicants</h2><p>Optional. Each co-applicant is checked separately by the dedupe agent.</p></div></header>
          <div id="coapp-list" className="coapp-list">
            {cos.map((co, i) => (
              <fieldset className="coapp" key={i}>
                <legend>{`Co-applicant ${i + 1}`}</legend>
                <div className="fields four">
                  {sch.fields.map((f) => {
                    const key = `co_applicants[${i}].${f.name}`;
                    const id = `co-${i}-${f.name}`;
                    const r = (f.rules || {}) as Record<string, unknown>;
                    const err = errors[key] || null;
                    const onValue = (v: string) =>
                      p.onChange(C.setCoApplicantValue(form, i, f.name, r.upper ? v.toUpperCase() : v), [key]);
                    const props = { id, "aria-describedby": `${id}-err`, autoComplete: "off", required: f.required || undefined,
                      maxLength: f.name === "pan" ? 10 : undefined, spellCheck: false, "aria-invalid": (err ? "true" : "false") as "true" | "false" };
                    return (
                      <div className={`field${err ? " invalid" : ""}`} data-field={key} key={f.name}>
                        <label htmlFor={id}>{f.label}{f.required ? <span className="req" aria-hidden="true"> *</span> : null}</label>
                        {f.name === "pan"
                          ? <MaskedInput {...props} type="text" value={co.pan || ""} kind="PAN" text={text} onValue={onValue} />
                          : <input {...props} type={r.date ? "date" : "text"} value={co[f.name] || ""} onChange={(e) => onValue(e.target.value)} />}
                        <ErrorSlot id={`${id}-err`} message={err} />
                      </div>
                    );
                  })}
                </div>
                <button type="button" className="btn ghost small coapp-remove" aria-label={`Remove co-applicant ${i + 1}`}
                  onClick={() => p.onChange(C.removeCoApplicant(form, i))}>Remove</button>
              </fieldset>
            ))}
          </div>
          <button type="button" className="btn ghost small" id="coapp-add" disabled={full}
            onClick={() => {
              p.onChange(C.addCoApplicant(form, schema));
              requestAnimationFrame(() => {
                const first = document.querySelector<HTMLInputElement>("#coapp-list fieldset:last-child input");
                if (first) first.focus();
              });
            }}>
            {full ? `Up to ${sch.max} co-applicant(s)` : "+ Add co-applicant"}
          </button>
        </article>
      ) : null}

      {boxes.loan.length ? (
        <article className="card span-2" id="loan-card" aria-labelledby="h-loan">
          <header className="card-head"><span className="ico ico-teal"><svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 9.5v5 M18 9.5v5" /></svg></span>
            <div><h2 id="h-loan">Loan Details</h2><p>The product (and the property type where the product needs one).</p></div></header>
          <div className="fields three" id="fields-application">{boxes.loan}</div>
        </article>
      ) : null}

      <div className="form-bar span-2">
        <p className="form-bar-note" id="form-summary" aria-live="polite">{p.summary}</p>
        <button type="button" className="btn ghost" id="reset" onClick={p.onReset}>Clear form</button>
        <BusyButton type="submit" className="btn primary" id="submit" busy={p.busy}>
          <span className="spinner" aria-hidden="true" /><span className="label">Open case &amp; run dedupe</span>
        </BusyButton>
      </div>
      {/* the page's own controls the layout does not place stay in the DOM, hidden (as before) */}
      <div hidden id="static-controls">
        {Object.entries(statics).filter(([k]) => !Object.values(layout).some((names) => (names || []).includes(`@${k}`))).map(([, n]) => n)}
      </div>
    </form>
  );
}

/** ui_text.json form_choices: a configured list for a free-text field. */
const textChoices = (text: UiText) => ((text.form_choices || {}) as Record<string, unknown>);
