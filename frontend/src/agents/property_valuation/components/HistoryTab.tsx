import { useState } from "react";
import { api } from "../services/api";
import type { History } from "../types";
import { Pagination, usePagination } from "../../../shared/components";

/** History & analytics: an application's vendor visits and agent results */
export function HistoryTab({ toast }: { toast: (m: string) => void }) {
  const [no, setNo] = useState("");
  const [state, setState] = useState<{ loading: boolean; data: History | null; error: string | null }>(
    { loading: false, data: null, error: null });

  async function load() {
    const n = no.trim();
    if (!n) { toast("Enter an application number."); return; }
    setState({ loading: true, data: null, error: null });
    try {
      setState({ loading: false, data: await api.history(n), error: null });
    } catch (e) {
      setState({ loading: false, data: null, error: (e as Error).message });
    }
  }

  const d = state.data;
  const visits = usePagination(d?.verifications);
  const results = usePagination(d?.agent_results);
  return (
    <div className="card">
      <h2 className="section-title">Valuation history and insights</h2>
      <div className="row">
        <div className="field grow">
          <label htmlFor="historyAppNo">Application Number</label>
          <input id="historyAppNo" placeholder="Enter application number" value={no} onChange={(e) => setNo(e.target.value)} />
        </div>
        <button className="btn" onClick={load}>Load history</button>
      </div>
      <div id="historyContent" style={{ marginTop: 16 }}>
        {state.loading && "Loading…"}
        {state.error && <div className="alert error">{state.error}</div>}
        {d && (
          <>
            <h3 className="section-title">Vendor visits ({d.verifications.length})</h3>
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Verification</th><th>Property</th><th>Type</th><th>Vendor status</th><th>Created</th></tr></thead>
              <tbody>
                {visits.rows.map((v) => (
                  <tr key={v.verification_id}>
                    <td>#{v.verification_id}</td><td>{v.collateral_property_id}</td><td>{v.verification_type}</td>
                    <td>{v.vendor_status || "—"}</td><td>{v.created_at || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            <Pagination pager={visits} noun="visits" />
            <h3 className="section-title" style={{ marginTop: 22 }}>Agent result history ({d.agent_results.length})</h3>
            <div className="table-wrap"><table className="table">
              <thead>
                <tr><th>Result</th><th>Property</th><th>Vendor status</th><th>Agent status</th><th>Triggered</th><th>Critical</th><th>Created</th></tr>
              </thead>
              <tbody>
                {results.rows.map((r) => (
                  <tr key={r.result_id}>
                    <td>#{r.result_id}</td><td>{r.collateral_property_id}</td><td>{r.vendor_status || "—"}</td>
                    <td><span className={"status " + r.agent_status}>{r.agent_status}</span></td>
                    <td>{r.total_rules_triggered}</td><td>{r.critical_issues_count}</td><td>{r.created_at || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            <Pagination pager={results} noun="results" />
          </>
        )}
      </div>
    </div>
  );
}
