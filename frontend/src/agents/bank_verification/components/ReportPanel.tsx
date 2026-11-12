import { api } from "../services/api";
import { useAsync } from "../hooks/useAsync";
import type { CaseDetail } from "../types/api";
import { when } from "../utils/format";
import { Card, ErrorNote, Loading } from "./ui";
import { Pagination, usePagination } from "../../../shared/components";

/** Case history in plain words; housekeeping events are not shown. */
const EVENTS: Record<string, string> = {
  CASE_SEEDED: "Case opened", CASE_OPENED: "Case opened", STATEMENT_RECEIVED: "Statement uploaded", STATEMENT_READ: "Statement read",
  STATEMENT_REJECTED: "Statement not accepted", VERIFICATION_RUN: "Verification completed",
  AGENCY_ASSIGNED: "Agency assigned", REPORT_UPLOADED: "Agency report uploaded",
  RULES_RERUN_WITH_AGENCY_INPUT: "Checks updated with the branch result", AGENCY_UPDATE: "Agency update saved",
  FINAL_DECISION: "Final decision recorded", FINALIZE_REFUSED: "Decision not accepted, items missing",
  STATEMENT_QUEUED: "Statement reading started", STATEMENT_READ_FAILED: "Statement could not be read",
};

/** The case history (the report itself is downloaded / printed from the result's actions). */
export function ReportPanel({ detail, refreshKey }: { detail: CaseDetail; refreshKey: string }) {
  const id = detail.case.case_id;
  const history = useAsync(() => api.history(id), [id, refreshKey]);
  const events = (history.data?.events ?? []).filter((e) => EVENTS[e.event]).reverse();
  const pager = usePagination(events);
  return (
    <Card icon="file" title="Report and history">
      <div className="stack">
        <p className="muted" style={{ margin: 0 }}>
          {detail.latest_run ? "Download the report, print it or open the agency's report from the actions under the result."
                             : "The report is ready after verification."}</p>
        {history.loading && !history.data && <Loading what="history" />}
        {history.error && <ErrorNote error={history.error} onRetry={history.reload} />}
        {history.data && (
          <>
          <ol className="timeline">
            {pager.rows.map((e, i) => <li key={`${e.event}-${e.at}-${i}`}><div><b>{EVENTS[e.event]}</b><span>{when(e.at)}</span></div></li>)}
          </ol>
          <Pagination pager={pager} noun="events" />
          </>
        )}
      </div>
    </Card>
  );
}
