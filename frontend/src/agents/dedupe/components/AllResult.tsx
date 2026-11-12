// ALL PARAMETERS in the common result layout: one decision (basic card), whether the identifiers agree (summary),
// R01-R11 combined (rules), a decision per parameter (calculations), and the parameter table (value, where it came
// from, MIFIN, customer, findings, decision, Details) with what was not checked.
import { useEffect, useRef, type ReactNode } from "react";
import { Pagination, ResultPage, usePagination } from "../../../shared/components";
import type { AllView, DedupeView, Entered, UiText } from "../types";
import { toAllResultPage } from "../utils/resultView";
import { Dash, Icon } from "./kit";

export default function AllResult({ a, text, entered, onDetails, onRerun }: {
  a: AllView; text: UiText; entered?: Entered; onDetails: (view: DedupeView) => void; onRerun?: () => void;
}) {
  const t = (text.all_parameters || {}) as Record<string, string>;
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { root.current?.scrollIntoView({ block: "start" }); }, [a]);
  const tone3 = (tone: string) => (tone === "ok" ? "ok" : tone === "bad" ? "bad" : "na");
  // the checked parameters, then the ones not checked: one list, a page at a time
  const lines: ReactNode[] = [
    ...a.rows.map((r, i) => (
      <tr key={i} className={`mt-row-${tone3(r.tone)}`}>
        <th scope="row">{r.label}</th>
        <td className="mono">{r.value || <Dash />}</td>
        <td>{r.from}</td>
        <td>{r.match}</td>
        <td className="mono">{r.customer || <Dash />}</td>
        <td>{r.found.length || r.findings.length ? [...r.found, ...r.findings].join(", ") : "Nothing"}</td>
        <td><span className={`mt-res mt-${r.tone === "ok" ? "ok" : r.tone === "bad" ? "bad" : "warn"}`}>{r.decision}</span></td>
        <td><button className="btn ghost small" type="button" onClick={() => onDetails(r.view)}>Details</button></td>
      </tr>
    )),
    ...a.missing.map((m) => (
      <tr key={m} className="mt-row-na"><th scope="row">{m}</th>
        <td colSpan={7}><span className="mt-res mt-na">{t.missing || "Not checked"}</span></td></tr>
    )),
  ];
  const pager = usePagination(lines);
  return (
    <div id="result" ref={root}>
      <ResultPage {...toAllResultPage(a, { text, entered, onRerun })}>
        <section className="panel">
          <div className="panel-head"><div className="t"><Icon name="user" className="ico ico-teal" />
            <div><h2>Checked parameters</h2><p>Each identifier, what MIFIN found, and what it means</p></div></div></div>
          <div className="panel-body"><div className="table-wrap"><table className="mt-table all-table">
            <thead><tr>{["Parameter", "Value", "From", "MIFIN", "Customer ID", "Found", "Decision", ""].map((x, i) => <th key={i} scope="col">{x}</th>)}</tr></thead>
            <tbody>{pager.rows}</tbody>
          </table></div>
          <Pagination pager={pager} noun="parameters" /></div>
        </section>
      </ResultPage>
    </div>
  );
}
