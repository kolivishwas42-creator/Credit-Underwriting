import type { Entry, Form } from "../types";
import { fieldsFor, pretty } from "../utils/logic";
import { Field, Msg, OptionSelect } from "./fields";

/** 2-5: loan, income working, top-up, property; Save and Trigger */
export function EntryCard({ form, entry, onChange, onMethod, onTopup, saveNote, msg, busy, onSave, onTrigger }: {
  form: Form; entry: Entry; onChange: (patch: Partial<Entry>) => void; onMethod: (m: string) => void;
  onTopup: (t: string) => void; saveNote: string; msg: { text: string; ok: boolean } | null; busy: boolean;
  onSave: () => void; onTrigger: () => void;
}) {
  const products = Object.fromEntries(form.products.map((p) => [p, pretty(p)]));
  const methods = Object.fromEntries(Object.entries(form.income_methods).map(([k, v]) => [k, v.label]));
  const topups = Object.fromEntries(Object.entries(form.topup_types).map(([k, v]) => [k, v.label]));
  return (
    <div className="card" id="entry">
      <h2>2. Loan</h2>
      <div className="grid" id="loan-fields">
        <div>
          <label htmlFor="product">Product</label>
          <OptionSelect id="product" options={products} value={entry.product} onChange={(v) => onChange({ product: v })} />
        </div>
        {(form.editable || []).map((f) => (
          <Field key={f.key} spec={f} id={f.key} value={entry.loan[f.key] ?? ""}
                 onChange={(v) => onChange({ loan: { ...entry.loan, [f.key]: v } })} />
        ))}
      </div>

      <div className="pair">
      <section>
      <h2 style={{ marginTop: 16 }}>3. Income working</h2>
      <div className="row">
        <div>
          <label htmlFor="income-method">Income method</label>
          <OptionSelect id="income-method" options={methods} value={entry.incomeMethod} onChange={onMethod}
                        noneLabel="Use the declared income" />
        </div>
      </div>
      <div className="grid" id="income-fields" style={{ marginTop: 10 }}>
        {fieldsFor(form, "income", entry.incomeMethod).map((f) => (
          <Field key={f.key} spec={f} id={"income-" + f.key} value={entry.income[f.key] ?? ""}
                 onChange={(v) => onChange({ income: { ...entry.income, [f.key]: v } })} />
        ))}
      </div>

      </section>
      <section>
      <h2 style={{ marginTop: 16 }}>4. Top-up</h2>
      <div className="row">
        <div>
          <label htmlFor="topup-type">Top-up</label>
          <OptionSelect id="topup-type" options={topups} value={entry.topupType} onChange={onTopup} noneLabel="No top-up" />
        </div>
      </div>
      <div className="grid" id="topup-fields" style={{ marginTop: 10 }}>
        {fieldsFor(form, "topup", entry.topupType).map((f) => (
          <Field key={f.key} spec={f} id={"topup-" + f.key} value={entry.topup[f.key] ?? ""}
                 onChange={(v) => onChange({ topup: { ...entry.topup, [f.key]: v } })} />
        ))}
      </div>

      </section>
      </div>

      <h2 style={{ marginTop: 16 }}>5. Property</h2>
      <div className="grid" id="property-fields">
        <div>
          <label htmlFor="collateral">Collateral type</label>
          <OptionSelect id="collateral" options={form.collateral_types} value={entry.collateral}
                        onChange={(v) => onChange({ collateral: v })} noneLabel="Product default" />
        </div>
        <div>
          <label htmlFor="occupancy">Occupancy</label>
          <OptionSelect id="occupancy" options={form.occupancy_types} value={entry.occupancy}
                        onChange={(v) => onChange({ occupancy: v })} noneLabel="Product default" />
        </div>
        <Field spec={{ key: "existing_exposure", label: form.existing_exposure_label }} id="existing_exposure"
               value={entry.existingExposure} onChange={(v) => onChange({ existingExposure: v })} />
      </div>

      <div className="actions" style={{ marginTop: 16 }}>
        <button id="save" onClick={onSave}>Save</button>
        <button id="trigger" className="primary" disabled={busy} onClick={onTrigger}>Trigger eligibility</button>
        <span id="save-note" className="note">{saveNote}</span>
      </div>
      {msg && <div style={{ marginTop: 10 }}><Msg msg={msg} /></div>}
    </div>
  );
}
