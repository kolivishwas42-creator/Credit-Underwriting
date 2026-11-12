import pathlib
P = pathlib.Path(r"C:\Users\ET0002183\Downloads\credit_underwriting_work\clean\credit_underwriting\frontend\src\agents\bank_verification\pages\CaseDetailPage.tsx")
t = P.read_text(encoding="utf-8")
E = [
 ('import { Flow } from "../components/Flow";', 'import { Flow, type BankTab } from "../components/Flow";'),
 ('  useEffect(() => () => view(null), [caseId]); // eslint-disable-line react-hooks/exhaustive-deps\n',
  '  useEffect(() => () => view(null), [caseId]); // eslint-disable-line react-hooks/exhaustive-deps\n'
  '  // TABS (owner 2026-11-11): one screen at a time; a new run opens Verification, a new case opens where it stands\n'
  '  const [tab, setTab] = useState<BankTab | null>(null);\n'
  '  const runId = detail.data?.latest_run?.run_id ?? null;\n'
  '  useEffect(() => { setTab(null); }, [caseId, runId]);\n'),
 ('  const showChecks = () =>\n    window.setTimeout(() => document.getElementById("sec-checks")?.querySelector("[aria-label=\'Verification checks\']")\n      ?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);\n',
  '  const showChecks = () => setTab("checks");\n'
  '  const active: BankTab = tab ?? (closed ? "report" : run ? "checks" : "details");\n'),
]
for a, b in E:
    assert t.count(a) == 1, a[:50]
    t = t.replace(a, b)
start = t.index("  // with a statement open")
end = t.index("  );\n}\n", start)
t = t[:start] + '''  const panel = (id: BankTab, body: React.ReactNode) => (
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
      {run && failed.length > 0 && closedFor !== run.run_id && (
        <FailPopup rules={failed} onClose={() => setClosedFor(run.run_id)}
                   onShow={() => { setClosedFor(run.run_id); showChecks(); }} />
      )}

      {active === "details" && panel("details", (
        <div className={viewing ? "split viewing" : "split is-details"}>
          <div className="col">
            <BankAccountPanel detail={d} config={config} onProcessed={refresh} onView={view} />
          </div>
          <div className="col">
            {viewing ? <StatementViewer view={viewing} onClose={() => view(null)} /> : (
              <Card icon="file" title="Application details">
                <div className="form">
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
          </div>
        </div>
      ))}

      {active === "agency" && panel("agency", (
        <div id="sec-agency" className="bv-narrow"><AgencyPanel detail={d} config={config} onFinalized={refresh} /></div>
      ))}
      {active === "report" && panel("report", (
        <div id="sec-report" className="bv-narrow"><ReportPanel detail={d} refreshKey={run?.run_id ?? "none"} /></div>
      ))}
    </>
''' + t[end:]
P.write_text(t, encoding="utf-8")

B = P.parent.parent / "components" / "BankResult.tsx"
s = B.read_text(encoding="utf-8")
for a, b in [
  ('export function BankResult({ detail, config, children }: { detail: CaseDetail; config: AppConfig; children?: ReactNode }) {',
   'export function BankResult({ detail, config, children, onAgency }:\n  { detail: CaseDetail; config: AppConfig; children?: ReactNode; onAgency?: () => void }) {'),
  ('    goToAgency: () => document.getElementById("sec-agency")?.scrollIntoView({ behavior: "smooth", block: "start" }),',
   '    goToAgency: onAgency ?? (() => document.getElementById("sec-agency")?.scrollIntoView({ behavior: "smooth", block: "start" })),'),
]:
    assert s.count(a) == 1, a[:50]
    s = s.replace(a, b)
B.write_text(s, encoding="utf-8")

A = P.parent.parent / "components" / "BankAccountPanel.tsx"
s = A.read_text(encoding="utf-8")
a = '<button className={mode === "AA_FAILURE" ? "is-on" : ""} disabled={closed}'
b = '<button className={mode === "AA_FAILURE" ? "is-on" : ""} disabled={closed || hasAA}\n                          title={hasAA ? "AA data was received for this case" : undefined}'
assert s.count(a) == 1
s = s.replace(a, b)
A.write_text(s, encoding="utf-8")

C = P.parent.parent / "styles.css"
s = C.read_text(encoding="utf-8")
if "bv-tabpanel" not in s:
    s += '''
/* ---------------------------------------------------------------- tabs (owner 2026-11-11): one screen at a time */
.flow { position: sticky; top: 64px; z-index: 5; }
.flow button.is-active { background: var(--accent-soft); color: var(--ink); box-shadow: inset 0 -3px 0 #1E40AF; }
.flow button.current:not(.is-active) { background: none; }
.bv-tabpanel { display: flex; flex-direction: column; gap: 16px; min-width: 0; animation: bv-tab-in .18s ease-out; }
@keyframes bv-tab-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
.split.is-details { grid-template-columns: minmax(0, 1fr) 360px; }
.bv-narrow { max-width: 860px; width: 100%; margin: 0 auto; }
@media (max-width: 1100px) { .split.is-details { grid-template-columns: 1fr; } }
@media (max-width: 760px) {
  .flow { grid-template-columns: repeat(4, minmax(0, 1fr)); padding: 4px; gap: 4px; top: 56px; }
  .flow button { flex-direction: column; gap: 4px; padding: 8px 4px; text-align: center; }
  .flow small { display: none; }
}
@media (prefers-reduced-motion: reduce) { .bv-tabpanel { animation: none; } }
'''
    C.write_text(s, encoding="utf-8")
print("ok")
