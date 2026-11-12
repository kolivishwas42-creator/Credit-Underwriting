import { useEffect, useState, type ReactNode } from "react";
import { api } from "../services/api";
import { useAsync } from "../hooks/useAsync";
import type { AppConfig, ReportCheck } from "../types/api";
import { AgencyPanel } from "../components/AgencyPanel";
import { BankAccountPanel } from "../components/BankAccountPanel";
import { BankResult } from "../components/BankResult";
import { Flow, type BankTab } from "../components/Flow";
import { ReportPanel } from "../components/ReportPanel";
import { StatementViewer, type Viewing } from "../components/StatementViewer";
import { ReportCheckView } from "../components/ReportCheckView";
import { Card, ErrorNote, Loading, StatusBadge, Value } from "../components/ui";
import { rupees } from "../utils/format";
import { CLOSED, PRODUCTS } from "../utils/resultView";

/** One case, loaded by the search: the result (common result layout), then the case as a form. */
export function CaseDetailPage({ caseId, config }: { caseId: string; config: AppConfig }) {
  const [tick, setTick] = useState(0);
  const detail = useAsync(() => api.caseDetail(caseId), [caseId, tick]);
  const refresh = () => setTick((t) => t + 1);
  const reading = detail.data?.case.status === "READING";
  const [viewing, setViewing] = useState<Viewing | null>(null);
  // a chosen file is a local blob URL: let it go when it is replaced, closed, or the case changes
  const view = (next: Viewing | null) => setViewing((old) => {
    if (old?.url.startsWith("blob:") && old.url !== next?.url) URL.revokeObjectURL(old.url);
    return next;
  });
  useEffect(() => () => view(null), [caseId]); // eslint-disable-line react-hooks/exhaustive-deps
  // TABS (owner 2026-11-11): one screen at a time; a new run opens Verification, a new case opens where it stands
  const [tab, setTab] = useState<BankTab | null>(null);
  const runId = detail.data?.latest_run?.run_id ?? null;
  useEffect(() => { setTab(null); }, [caseId, runId]);
  // a tab switch -- by hand, or to Verification once a run is back -- starts at the top (owner 2026-11-12: after
  // Run verification the result opened half-scrolled, from where the button was at the foot of the form)
  useEffect(() => {
    document.querySelector(".agent-root")?.scrollIntoView?.({ block: "start" });
    window.scrollTo?.({ top: 0 });
  }, [tab, runId]);

  // A LONG / SCANNED STATEMENT IS READ IN THE BACKGROUND: ask again every few seconds until its result is in
  useEffect(() => {
    if (!reading) return;
    const timer = setTimeout(refresh, 3000);
    return () => clearTimeout(timer);
  }, [reading, tick]);

  if (detail.loading && !detail.data) return <Loading what="the case" />;
  if (detail.error) return <ErrorNote error={detail.error} onRetry={detail.reload} />;
  if (!detail.data) return null;
  const d = detail.data;
  const c = d.case;
  const run = d.latest_run;
  const closed = CLOSED.includes(c.status);
  const agencyName = config.agencies.find((a) => a.id === c.assigned_agency)?.name;
  // the agency's report, checked when the agency submitted: full width, under the checks
  const reportCheck = (d.decisions.at(-1)?.outcome as { report_check?: ReportCheck | null } | undefined)?.report_check ?? null;
  const active: BankTab = tab ?? (closed ? "report" : run ? "checks" : "details");

  const panel = (id: BankTab, body: ReactNode) => (
    <div role="tabpanel" id={`bv-panel-${id}`} aria-labelledby={`bv-tab-${id}`} className="bv-tabpanel">{body}</div>
  );

  return (
    <>
      <Flow detail={d} active={active} onSelect={setTab} />

      {active === "checks" && panel("checks", run ? (
        <div id="sec-checks" className="bv-result">
          <BankResult detail={d} config={config} onAgency={() => setTab("agency")}>
            {reportCheck && <div id="sec-report-check"><ReportCheckView check={reportCheck} /></div>}
          </BankResult>
        </div>
      ) : (
        <Card icon="shield" title="Verification">
          <p className="muted">Not run yet. Fill the bank details and press <b>Run verification</b>.</p>
          <button className="btn btn-primary" onClick={() => setTab("details")}>Go to Bank details</button>
        </Card>
      ))}

      {active === "details" && panel("details", (
        <>
          {!viewing && (
            <Card icon="file" title="Application details">
              <div className="form bv-app-grid">
                <Value label="Applicant Name" value={c.applicant_name} />
                <Value label="Applicant ID" value={c.application_ref} />
                <Value label="Case ID" value={c.case_id} />
                <Value label="Product" value={PRODUCTS[c.product] ?? c.product} />
                <Value label="Loan Amount (₹)" value={rupees(c.loan_amount)} />
                <Value label="Stage" value={c.stage} />
                <Value label="Agency" value={agencyName ?? "Not assigned"} />
                <Value label="Status" value={<StatusBadge status={c.status} />} />
              </div>
            </Card>
          )}
          <div className={viewing ? "split viewing" : ""}>
            <div className="col">
              <BankAccountPanel detail={d} config={config} onProcessed={refresh} onView={view} onRan={() => setTab("checks")} />
            </div>
            {viewing && <div className="col"><StatementViewer view={viewing} onClose={() => view(null)} /></div>}
          </div>
        </>
      ))}

      {active === "agency" && panel("agency", (
        <div id="sec-agency" className="bv-narrow"><AgencyPanel detail={d} config={config} onFinalized={refresh} /></div>
      ))}
      {active === "report" && panel("report", (
        <div id="sec-report" className="bv-narrow"><ReportPanel detail={d} refreshKey={run?.run_id ?? "none"} /></div>
      ))}
    </>
  );
}
