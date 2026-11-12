import { forwardRef } from "react";
import { Pagination, ResultPage, usePagination } from "../../../shared/components";
import type { ValuationResult } from "../types";
import { buildComparisonRows } from "../utils/result";
import { toResultPage, type ValuationContext } from "../utils/resultView";

/** the side-by-side values of the triggered rules' discrepancies: field, LOS, vendor, severity, reason (paged) */
function SideBySide({ out }: { out: ValuationResult }) {
  const rows = buildComparisonRows(out.evaluation?.results || []);
  const pager = usePagination(rows);
  return (
    <div className="card pv-side" role="region" aria-label="Side-by-side comparison">
      <h3 className="section-title">Side-by-side comparison</h3>
      <p className="section-subtitle">These are the actual field values returned in the triggered rule discrepancies.</p>
      {rows.length ? (
        <>
          <div className="comparison-wrap">
            <table className="comparison-table">
              <thead><tr><th>Field</th><th>LOS / Recorded value</th><th>Vendor value</th><th>Severity</th><th>Reason</th></tr></thead>
              <tbody>
                {pager.rows.map((r, i) => (
                  <tr key={pager.from + i} className="mismatch">
                    <td><b>{r.field}</b></td>
                    <td className="value">{r.los}</td>
                    <td className="value">{r.vendor}</td>
                    <td><span className={"criticality-pill " + r.severity}>{r.severity}</span></td>
                    <td>{r.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination pager={pager} noun="fields" />
        </>
      ) : (
        <div className="empty-note">No triggered rule supplied a side-by-side discrepancy. No comparison values have been invented.</div>
      )}
    </div>
  );
}

/** the property valuation assessment in the console's common result layout, the side-by-side table under it */
export const ResultView = forwardRef<HTMLDivElement, { out: ValuationResult; ctx?: ValuationContext }>(
  function ResultView({ out, ctx }, ref) {
    return (
      <div id="resultArea" ref={ref}>
        <ResultPage {...toResultPage(out, ctx)}>
          <SideBySide out={out} />
        </ResultPage>
      </div>
    );
  });
