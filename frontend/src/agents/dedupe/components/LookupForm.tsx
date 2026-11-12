// Check an existing case: a case ID, who to check (applicant / co-applicant), the customer type and one dedupe
// parameter (or All parameters, each value optional). Builds the POST /api/v1/credit/dedupe(/all) body.
import { useImperativeHandle, useState, forwardRef } from "react";
import * as C from "../core";
import type { DedupeRequest, LookupSampleValues } from "../types";
import { BusyButton } from "./kit";

export interface LookupHandle { fill: (s: LookupSampleValues) => void }

interface Props {
  busy: boolean;
  showSample: boolean;
  onSample: () => void;
  onRun: (body: DedupeRequest) => void;
}

const ALL_INPUTS: [keyof typeof C.ALL_FIELDS, string, string][] = [
  ["pan", "PAN (empty = case record)", "PAN"], ["mobile", "Mobile (empty = case record)", "Mobile"],
  ["ap_code", "Customer ID, e.g. AP00012345", "Customer ID"], ["pr_code", "Loan account, e.g. PR00012345", "Loan account"],
];

const LookupForm = forwardRef<LookupHandle, Props>(function LookupForm({ busy, showSample, onSample, onRun }, ref) {
  const [caseId, setCaseId] = useState("");
  const [party, setParty] = useState("Applicant");
  const [type, setType] = useState("Existing");
  const [parameter, setParameter] = useState("");
  const [value, setValue] = useState("");
  const [all, setAll] = useState<Record<string, string>>({});
  const [err, setErr] = useState<{ case?: string; value?: string; all?: string }>({});
  const p = C.parameter(parameter);
  const isAll = Boolean(p && "all" in p && p.all);

  const choose = (v: string) => { setParameter(v); setValue(""); };   // a new parameter clears the typed value

  useImperativeHandle(ref, () => ({
    fill: (s) => {
      setCaseId(s.caseId); setParty(s.party); setType(s.customerType); choose(s.parameter); setValue(s.value);
      setErr((e) => ({ ...e, case: "", value: "" }));
    },
  }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const id = caseId.trim();
    const next: typeof err = { case: id ? "" : "Enter the case ID." };
    const forApplicant = party === "Applicant" ? { customer_type: type } : {};
    if (isAll) {
      // ALL PARAMETERS: every value optional; PAN / mobile left empty come from the case record
      const raw = Object.fromEntries(Object.keys(C.ALL_FIELDS).map((f) => [f, all[f] || ""]));
      const { errors, body } = C.allValues(raw);
      setErr({ ...next, all: Object.values(errors).join(" ") });
      if (!id || Object.keys(errors).length) return;
      onRun({ case_id: id, party_role: party, mode: "ALL", ...body, ...forApplicant });
      return;
    }
    const single = p && !isAll ? (p as (typeof C.DEDUPE_PARAMETERS)[number]) : null;
    const v = single ? single.normalise(value) : "";
    next.value = !single ? "Choose a parameter and enter its value." : (!single.pattern.test(v) ? `${single.label}: ${single.hint}.` : "");
    setErr(next);
    if (!id || !single || !single.pattern.test(v)) return;
    onRun({ case_id: id, party_role: party, dedupe_parameter: single.value, dedupe_parameter_value: v, ...forApplicant });
  };

  return (
    <>
      <div className="page-head"><div>
        <h1 id="h-lookup">Check an existing case</h1>
        <p className="lead">Run the existing-customer check for a case you already own.</p></div>
        <button type="button" className="btn ghost small sample-btn" id="lk-sample" hidden={!showSample} onClick={onSample}
          title="Fill the check with the last case you opened and a random synthetic identifier"><svg viewBox="0 0 24 24"><path d="M12 3l2.2 5.3L20 9l-4.4 3.8L17 19l-5-3-5 3 1.4-6.2L4 9l5.8-.7z" /></svg>Fill sample</button></div>
      <form className="card narrow" id="lookup-form" noValidate onSubmit={submit}>
        <div className="fields">
          <div className="field"><label htmlFor="lk-case">Case ID <span className="req">*</span></label>
            <input id="lk-case" placeholder="CASE-…" autoComplete="off" spellCheck={false} value={caseId} onChange={(e) => setCaseId(e.target.value)} />
            <p className="field-error" id="err-lk-case" role="alert">{err.case || ""}</p></div>
          <div className="field"><label htmlFor="lk-party">Check for</label>
            <select id="lk-party" value={party} onChange={(e) => setParty(e.target.value)}>
              <option value="Applicant">Applicant</option><option value="Co-Applicant">Co-applicant</option></select>
            <p className="hint">A co-applicant is checked the same way; the customer type applies to the applicant only.</p></div>
          <div className="field"><label htmlFor="lk-type">Customer type</label>
            <select id="lk-type" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="Existing">Existing</option><option value="New">New</option></select></div>
          <div className="field"><label htmlFor="lk-parameter">Dedupe parameter <span className="req">*</span></label>
            <select id="lk-parameter" value={parameter} onChange={(e) => choose(e.target.value)}>
              <option value="">Choose…</option>
              {C.PARAMETER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <p className="hint" id="lk-parameter-hint">{p ? p.hint : ""}</p></div>
          <div className="field" id="w-lk-value" hidden={isAll}><label htmlFor="lk-value">Dedupe parameter value <span className="req">*</span></label>
            <input id="lk-value" autoComplete="off" spellCheck={false} placeholder={p ? p.hint : ""} value={value} onChange={(e) => setValue(e.target.value)} />
            <p className="field-error" id="err-lk-value" role="alert">{err.value || ""}</p></div>
          <div className="field all-values" id="w-lk-all" hidden={!isAll}>
            <label>Values to check (each optional)</label>
            <div className="all-grid">
              {ALL_INPUTS.map(([f, placeholder, aria]) => (
                <input key={f} id={`lk-all-${f}`} placeholder={placeholder} autoComplete="off" spellCheck={false} aria-label={aria}
                  value={all[f] || ""} onChange={(e) => setAll({ ...all, [f]: e.target.value })} />
              ))}
            </div>
            <p className="field-error" id="err-lk-all" role="alert">{err.all || ""}</p></div>
        </div>
        <div className="form-bar inline">
          <BusyButton type="submit" className="btn primary" id="lk-submit" busy={busy}>
            <span className="spinner" aria-hidden="true" /><span className="label">Run check</span></BusyButton>
        </div>
      </form>
    </>
  );
});

export default LookupForm;
