import { useEffect, useRef, useState } from "react";
import { OUTGOING, VENDOR_FIELDS, VENDOR_SECTIONS, VISIT_TYPES } from "../config/forms";
import { api } from "../services/api";
import type { Application, FormValues, Property, ValuationResult } from "../types";
import { blankVendor, collectVendor, prefillOutgoing, propertyLabel, propertySummary } from "../utils/result";
import { FormField } from "./FormField";
import { ResultView } from "./ResultView";
import { useAgentLoader } from "../../../shared/components";

type AppMessage = { kind: "hint" | "loading" | "ok" | "error"; text: string; name?: string; count?: number };

const HINT: AppMessage = { kind: "hint", text: "Enter an application number to load the applicant and the property details." };
const RUN_LABEL = "Save vendor response & run agent";
/** the vendor's figures listed with the result: the number fields of the response form */
const FIGURE_FIELDS = VENDOR_FIELDS.filter((f) => f.kind === "number");

/** Valuation workflow: fetch the application, pick a property, check what goes to the vendor, enter the vendor's
 *  response, save it and run the agent. */
export function ValuationTab({ toast }: { toast: (m: string) => void }) {
  const [appNo, setAppNo] = useState("");
  const [message, setMessage] = useState<AppMessage>(HINT);
  const [app, setApp] = useState<Application | null>(null);
  const [selected, setSelected] = useState<Property | null>(null);
  const [outgoing, setOutgoing] = useState<FormValues>({});
  const [vendor, setVendor] = useState<FormValues>(() => blankVendor(VENDOR_FIELDS));
  const [visitType, setVisitType] = useState("INITIAL_VISIT");
  const [running, setRunning] = useState(false);
  useAgentLoader(running, "run");
  useAgentLoader(message.kind === "loading", "fetch");
  const [result, setResult] = useState<ValuationResult | null>(null);
  // what the shown result was run on: the property and the vendor response sent
  const [sent, setSent] = useState<{ property: Property; response: Record<string, unknown> } | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (result) resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [result]);

  function selectProperty(p: Property) {
    setSelected(p);
    setOutgoing(prefillOutgoing(OUTGOING, p.vendor_request_prefill));
    setVendor(blankVendor(VENDOR_FIELDS));
    setVisitType("INITIAL_VISIT");
  }

  async function loadApplication() {
    const no = appNo.trim();
    if (!no) { toast("Enter an application number."); return; }
    setMessage({ kind: "loading", text: "Fetching application from LOS…" });
    setApp(null);
    setSelected(null);
    setResult(null);
    try {
      const a = await api.application(no);
      setApp(a);
      setMessage({ kind: "ok", text: "", name: a.applicant_name || "Not available", count: a.properties.length });
      if (a.properties.length) selectProperty(a.properties[0]);
    } catch (e) {
      setMessage({ kind: "error", text: (e as Error).message });
    }
  }

  async function run() {
    if (!app || !selected) return;
    const response = collectVendor(vendor);
    if (!response["Final Status"]) { toast("Select the vendor Final Status."); return; }
    setRunning(true);
    try {
      const out = await api.runValuation(app.application_number, selected.collateral_property_id, {
        collateral_property_id: selected.collateral_property_id,
        vendor_name: String(outgoing["Verification Agency"] || "") || "Manual Vendor Entry",
        verification_type: visitType,
        submitted_data: outgoing,
        vendor_response: response,
        verified_at: new Date().toISOString(),
      });
      setResult(out);
      setSent({ property: selected, response });
      toast("Vendor response and agent result saved.");
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <section id="valuation">
      <div className="card">
        <h2 className="section-title">Find loan application</h2>
        <div className="row">
          <div className="field grow">
            <label htmlFor="appNo">Application Number</label>
            <input id="appNo" placeholder="e.g. LOS-DUMMY-0008" autoComplete="off" value={appNo}
                   onChange={(e) => setAppNo(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") loadApplication(); }} />
          </div>
          <button className="btn" onClick={loadApplication}>Fetch application</button>
        </div>
        <div id="appMessage" className="muted small" style={{ marginTop: 10 }}>
          {message.kind === "ok"
            ? <>Applicant: <b>{message.name}</b> · {message.count} linked property record(s)</>
            : message.kind === "error" ? <span style={{ color: "var(--error-text)" }}>{message.text}</span>
            : message.text}
        </div>
        <div className="property-list">
          {(app?.properties || []).map((p) => (
            <button key={String(p.collateral_property_id)} className={"property-pill" + (p === selected ? " active" : "")}
                    onClick={() => selectProperty(p)}>
              {propertyLabel(p)}
            </button>
          ))}
        </div>
      </div>

      {app && selected && (
        <div id="workflow">
          <div className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>
                <h2 className="section-title">Selected property</h2>
                <div className="muted">{propertySummary(selected)}</div>
              </div>
              <span className="status">Property ID {String(selected.collateral_property_id)}</span>
            </div>
          </div>

          <div className="card">
            <h2 className="section-title">A. Information sent to vendor</h2>
            <p className="muted small">
              Applicant and property fields are prefilled from LOS. Verify the values and complete agency/contact details before sending.
            </p>
            <div className="grid">
              {OUTGOING.map((f, i) => (
                <FormField key={f.key} def={f} id={`out-${i}`} value={outgoing[f.key] ?? ""} wrapCheck
                           onChange={(v) => setOutgoing((o) => ({ ...o, [f.key]: v }))} />
              ))}
            </div>
          </div>

          <div className="card">
            <h2 className="section-title">B. Vendor inspection and valuation response</h2>
            <p className="muted small">
              For now, enter the vendor API response manually. The same structure can later be populated directly from the vendor API.
            </p>
            {VENDOR_SECTIONS.map((s, si) => {
              const fields = (
                <div className={s.grid}>
                  {s.fields.map((f) => (
                    <FormField key={f.key} def={f} id={`vendor-${VENDOR_FIELDS.indexOf(f)}`} value={vendor[f.key] ?? ""}
                               onChange={(v) => setVendor((o) => ({ ...o, [f.key]: v }))} />
                  ))}
                </div>
              );
              return si === 0
                ? <div key={s.title}><h3 className="section-title">{s.title}</h3>{fields}</div>
                : <div key={s.title} className="subsection"><h3 className="section-title">{s.title}</h3>{fields}</div>;
            })}
            <div className="row" style={{ justifyContent: "space-between", marginTop: 18 }}>
              <div className="field">
                <label htmlFor="visitType">Visit Type</label>
                <select id="visitType" value={visitType} onChange={(e) => setVisitType(e.target.value)}>
                  {Object.entries(VISIT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <button className="btn" disabled={running} onClick={run}>{running ? "Saving and evaluating…" : RUN_LABEL}</button>
            </div>
          </div>

          {result && (
            <ResultView ref={resultRef} out={result}
                        ctx={{ application: app, property: sent?.property ?? selected, vendorResponse: sent?.response,
                              figureFields: FIGURE_FIELDS }} />
          )}
        </div>
      )}
    </section>
  );
}
