import type { CasePayload, CaseRow, Form } from "../types";
import { caseValue, pretty } from "../utils/logic";
import { Msg } from "./fields";

/** 1. Case: pick (auto-fetch) or type an id, then the case's read-only figures */
export function CaseCard({ form, cases, picked, typed, msg, payload, onPick, onType, onFetch }: {
  form: Form | null; cases: CaseRow[]; picked: string; typed: string; msg: { text: string; ok: boolean } | null;
  payload: CasePayload | null; onPick: (id: string) => void; onType: (v: string) => void; onFetch: () => void;
}) {
  const c = payload?.case || {};
  return (
    <div className="card">
      <h2>1. Case</h2>
      <div className="row">
        <div>
          <label htmlFor="case-select">Pick a case</label>
          <select id="case-select" value={picked} onChange={(e) => onPick(e.target.value)}>
            <option value="">— select —</option>
            {cases.map((x) => (
              <option key={x.case_id} value={x.case_id}>
                {x.case_id} · {pretty(x.product)}{x.label ? " · " + x.label : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="case-id">or type a case id</label>
          <input id="case-id" placeholder="CASE-…" value={typed} onChange={(e) => onType(e.target.value)} />
        </div>
        <div style={{ flex: "0 0 auto" }}><button id="load" onClick={onFetch}>Fetch case</button></div>
      </div>
      <Msg msg={msg} />
      <div id="case-data" className="grid" style={{ marginTop: 12 }}>
        {payload && form && (form.case_fields || []).map((f) => (
          <div key={f.key}>
            <label htmlFor={`case-${f.key}`}>{f.label}</label>
            <input id={`case-${f.key}`} readOnly value={caseValue(f.label, c[f.key])} />
          </div>
        ))}
      </div>
    </div>
  );
}
