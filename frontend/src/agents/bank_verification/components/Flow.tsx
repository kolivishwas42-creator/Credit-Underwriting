import type { CaseDetail } from "../types/api";

export type BankTab = "details" | "checks" | "agency" | "report";
interface Step { id: BankTab; title: string; note: string; state: "done" | "current" | "todo" }

/** Where the case stands, as TABS (owner 2026-11-11): Bank details | Verification | Agency | Report. A tab opens only
 *  its own screen, so the agency form is seen only when the officer asks for it. */
export function Flow({ detail, active, onSelect }: { detail: CaseDetail; active: BankTab; onSelect: (t: BankTab) => void }) {
  const run = detail.latest_run;
  const final = ["POSITIVE", "NEGATIVE", "WAIVED"].includes(detail.case.status);
  const form = run?.form ?? detail.prefill;
  const filled = Boolean(form?.bank_name && form?.account_number);
  const steps: Step[] = [
    { id: "details", title: "Bank details", note: filled ? "Filled" : "To fill",
      state: filled ? "done" : "current" },
    { id: "checks", title: "Verification",
      note: detail.case.status === "READING" ? "Reading statement…"
        : run ? `${run.checks.checks_passed} of ${run.checks.checks_applicable} passed` : "Not run",
      state: run ? "done" : filled ? "current" : "todo" },
    { id: "agency", title: "Agency", note: final ? (detail.case.status === "WAIVED" ? "Waived" : detail.case.status === "POSITIVE" ? "Positive" : "Negative") : run ? "Awaiting decision" : "After verification",
      state: final ? "done" : run ? "current" : "todo" },
    { id: "report", title: "Report", note: final ? "Ready to download" : "After the decision",
      state: final ? "current" : "todo" },
  ];
  return (
    <div className="flow" role="tablist" aria-label="Verification flow">
      {steps.map((s, i) => (
        <button key={s.id} type="button" role="tab" id={`bv-tab-${s.id}`} aria-controls={`bv-panel-${s.id}`}
                aria-selected={active === s.id} className={`${s.state}${active === s.id ? " is-active" : ""}`}
                onClick={() => onSelect(s.id)}>
          <span className="num">{i + 1}</span>
          <span><b>{s.title}</b><small>{s.note}</small></span>
        </button>
      ))}
    </div>
  );
}
