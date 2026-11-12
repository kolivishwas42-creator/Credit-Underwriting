// The Dedupe & loan history result: everything shown is from the backend answer (core viewResult); a value the answer
// does not carry is shown as unavailable -- never zero, never guessed.
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import * as C from "../core";
import type { DedupeView, Entered, LoanRow, UiText } from "../types";
import { BusyButton, Dash, Icon, Pill, label } from "./kit";
import { Pagination, ResultPage, usePagination } from "../../../shared/components";
import { makeRoleWord, toResultPage } from "../utils/resultView";

interface Ctx { text: UiText; roleWord: (code: string | null | undefined, group?: string) => string }

export { makeRoleWord };

// ---------------------------------------------------------------- the officer's decision on a possible match
/** A POSSIBLE match: the officer decides, in two steps (choose, then record). The decision is saved on the case with
 * the officer's name and every later check on this case uses it. */
function ConfirmBox({ v, onDecide }: { v: DedupeView; onDecide: (decision: string, candidate: unknown) => Promise<void> }) {
  const [decision, setDecision] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ic = (v.identityCheck || {}) as Record<string, string | undefined>;
  const tick = (what: string, state: string | undefined) => (
    <span className={`idc idc-${String(state || "NOT_COMPARED").toLowerCase()}`}>
      {state === "MATCH" ? "✓" : state === "MISMATCH" ? "✗" : "–"}{` ${what}`}</span>
  );
  if (!decision) {
    return (
      <div className="decide">
        <p className="d-q">Is this the same customer?</p>
        <div className="idcs">{tick(C.searchedLabel(v.searched), ic.searched_identifier)}{tick("Name", ic.name)}{tick("Date of birth", ic.dob)}</div>
        <p className="hint">Compared with MIFIN's record (✓ same, ✗ different, – not compared). Check the KYC documents too.</p>
        <div className="d-actions">
          <button type="button" className="btn primary small" onClick={() => setDecision("SAME_CUSTOMER")}>Yes, same customer</button>
          <button type="button" className="btn ghost small" onClick={() => setDecision("NOT_SAME_CUSTOMER")}>No, different person</button>
        </div>
      </div>
    );
  }
  return (
    <div className="decide">
      <p className="d-q">{decision === "SAME_CUSTOMER"
        ? "Record: this IS the same customer. Their loans will be used for this case."
        : "Record: this is a DIFFERENT person. The case continues as a new customer."}</p>
      <p className="hint">Saved on the case with your name.</p>
      <div className="d-actions">
        <BusyButton type="button" className="btn primary small" busy={busy}
          onClick={async () => { setBusy(true); try { await onDecide(decision, v.confirmation.candidate); } finally { setBusy(false); } }}>
          Record decision</BusyButton>
        <button type="button" className="btn ghost small" onClick={() => setDecision(null)}>Back</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Dedupe Assessment Summary (inside the loans panel)
function SummaryBox({ v }: { v: DedupeView }) {
  const sm = v.summary;
  if (!sm) return null;
  // compact: the decision, the facts as chips, one line per party, why / next; the long lines behind "Details"
  const get = (k: string) => sm.rows.find((x) => x.key === k);
  const rec = get("recommendation");
  const chip = (row: { tone: string; value: string } | undefined, prefix?: string) =>
    (row ? <span className={`das-chip t-${row.tone}`}>{prefix ? <i>{`${prefix} `}</i> : null}{row.value}</span> : null);
  const conflicts = get("conflicts");
  const parties = sm.rows.filter((x) => x.key === "applicant" || /^co\d*$/.test(x.key));
  const line = (k: string, title: string) => (get(k) ? <div className="das-line"><b>{title}</b><span>{get(k)!.value}</span></div> : null);
  const easy = v.simple || [];
  return (
    <div className={`das das-${rec ? rec.tone : "na"}`}>
      <div className="das-head"><h3>{sm.title}</h3>
        {rec ? <span className={`das-rec t-${rec.tone}`}><span className="dd-dot" aria-hidden="true" />{rec.value}</span> : null}</div>
      {easy.length ? (
        <ol className="easy">{easy.map((x) => (
          <li key={x.key} className={`easy-${x.key} t-${x.tone}`}><span className="easy-q">{x.q}</span><span className="easy-a">{x.a}</span></li>
        ))}</ol>
      ) : null}
      <div className="das-chips">
        {chip(get("overall"))}{chip(get("existing"), "Existing:")}{chip(get("duplicate"), "Duplicate:")}
        {chip(get("complete"), "Search:")}{conflicts && conflicts.tone === "bad" ? chip({ ...conflicts, value: "Conflict found" }) : null}
      </div>
      {parties.length ? (
        <ul className="das-parties">{parties.map((p) => (
          <li key={p.key}><span className={`dd-dot t-${p.tone}`} aria-hidden="true" /><b>{p.label.replace(" result", "")}</b><span>{p.value}</span></li>
        ))}</ul>
      ) : null}
      {line("reason", "Why")}{line("question", "Open question")}
      <details className="das-more"><summary>Details</summary>
        <dl className="das-grid">{sm.rows.filter((x) => ["lookup", "agent", "evidence", "conflicts"].includes(x.key))
          .flatMap((x) => [<dt key={`${x.key}-t`}>{x.label}</dt>, <dd key={`${x.key}-d`} className={`t-${x.tone}`}>{x.value}</dd>])}</dl></details>
      {sm.note ? <p className="das-note"><Icon name="info" />{sm.note}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------- Existing Loan Details (+ the side panel)
function LoansPanel({ v, ctx, openLoan, onOpen }: { v: DedupeView; ctx: Ctx; openLoan: string | null; onOpen: (row: LoanRow, id: string) => void }) {
  const head = (
    <div className="panel-head"><div className="t"><Icon name="list" className="ico ico-brand" />
      <div><h2>Existing Loan Details</h2><p>{`${v.history.count} loan(s) with SBFC · ${v.history.label}`}</p></div></div></div>
  );
  const who = v.match.ref && v.match.ref !== "—" ? (
    <div className="cust-strip">
      <div><span className="k">Customer ID</span><b className="mono">{v.match.ref}</b></div>
      <div><span className="k">Role in MIFIN</span><b>{v.match.role ? ctx.roleWord(v.match.role) : "Not given by MIFIN"}</b></div>
      <div><span className="k">Checked for</span><b>{ctx.roleWord(v.checkedParty, "parties")}</b></div>
      <div><span className="k">Match</span><b>{v.match.label}</b></div>
    </div>
  ) : null;
  if (!v.loans.length) {
    const text = ({
      NO_PREVIOUS_LOANS: ["No previous loans", "MIFIN lists no earlier loan for this customer."],
      NOT_APPLICABLE: ["No earlier customer record", "No SBFC customer was found, so there is no loan history."],
      NOT_ATTRIBUTED: ["Hidden until the customer is confirmed",
        `${v.history.withheld || 0} loan(s) belong to a possible match. Confirm the customer to see them.`],
      UNAVAILABLE: ["Loan history unavailable", "The source could not answer. This is unknown, not zero loans."],
      UNKNOWN: ["Loan history unknown", "MIFIN did not send its loan section. This is unknown, not zero loans."],
    } as Record<string, string[]>)[v.history.status] || ["No records", ""];
    return <section className="panel">{head}<SummaryBox v={v} />{who}<div className="empty"><div className="big">{text[0]}</div><div>{text[1]}</div></div></section>;
  }
  // Existing Loan Details: the Loan Existing screen's columns (ui_text.json existing_loan_columns), sources verified
  const all = (ctx.text.existing_loan_columns || []) as Parameters<typeof C.loanColumns>[0];
  const rows = C.existingLoanRows({ ...v, loans: C.sortLoans(v.loans, "status", "asc") }, ctx.text) as LoanRow[];
  const { shown: cols, empty } = C.loanColumns(all, rows, ctx.text);
  const cell = (c: { key: string; num?: boolean; source?: string }, row: LoanRow) => {
    const val = row[c.key] as string | null | undefined;
    if (val === null || val === undefined || val === "") {
      return <td key={c.key} className={c.num ? "num" : ""}><Dash title={`Not available (source: ${c.source})`} /></td>;
    }
    if (c.key === "loan_status") return <td key={c.key}><Pill tone={row.status_tone as string}>{val}</Pill></td>;
    if (c.key === "pan_match") return <td key={c.key}><span className={`mt-res mt-${row.pan_tone}`}>{val}</span></td>;
    if (c.key === "cancel_reason") return <td key={c.key} className="reason"><span title={val}>{val}</span></td>;
    if (c.key === "match_found") {
      return <td key={c.key}><span className={`mf ${val.includes("This loan") ? "mf-this" : "mf-same"}`} title={(row.match_found_why as string) || ""}>{val.replace(/^✓ /, "")}</span></td>;
    }
    if (c.key === "product_name") {
      return <td key={c.key} className="prod"><span title={row.product_code && row.product_code !== val ? `MIFIN scheme: ${row.product_code}` : "MIFIN scheme name, as sent"}>{val}</span></td>;
    }
    return <td key={c.key} className={`${c.num ? "num" : ""}${c.key === "prospect_code" ? " mono" : ""}`}>{String(val)}</td>;
  };
  return (
    <section className="panel">{head}<SummaryBox v={v} />{who}<CommonLine v={v} ctx={ctx} />
      <LoanTable rows={rows} cols={cols} cell={cell} openLoan={openLoan} onOpen={onOpen} />
      <p className="eld-note">
        {empty.length ? <span><b>Not available from the source for these loans: </b>{`${empty.join(", ")}. `}</span> : null}
        Click a loan to see its details. — = not available for that loan. AP Code and Applicant Type are in the strip above. Hover a column for its source.
      </p>
    </section>
  );
}

type LoanCol = { key: string; num?: boolean; source?: string; label?: string };

/** The existing-loan table, a page at a time (rows keep their global index so ids stay stable). */
function LoanTable({ rows, cols, cell, openLoan, onOpen }: {
  rows: LoanRow[]; cols: LoanCol[]; cell: (c: LoanCol, row: LoanRow) => ReactNode;
  openLoan: string | null; onOpen: (row: LoanRow, id: string) => void;
}) {
  const indexed = rows.map((row, i) => ({ row, id: (row.prospect_code as string) || `loan-${i}` }));
  const pager = usePagination(indexed);
  return (
    <>
      <div className="table-wrap eld"><table>
        <caption className="skip">Existing loan details</caption>
        <thead><tr><th scope="col" className="pr-arrow"><span className="skip">Details</span></th>
          {cols.map((c) => <th key={c.key} scope="col" className={c.num ? "num" : ""} title={`Source: ${c.source}`}>{c.label}</th>)}</tr></thead>
        <tbody>{pager.rows.map(({ row, id }) => {
          // a loan's details open in the side panel: the table stays one clean line per loan
          return (
            <tr key={id} className={`loan-row${openLoan === id ? " pr-selected" : ""}`} data-loan={id} onClick={() => onOpen(row, id)}>
              <td className="pr-arrow"><button type="button" className="pr-toggle" aria-haspopup="dialog"
                aria-label={`Show details of ${row.prospect_code || "this loan"}`}
                onClick={(e) => { e.stopPropagation(); onOpen(row, id); }}>▸</button></td>
              {cols.map((c) => cell(c, row))}
            </tr>
          );
        })}</tbody>
      </table></div>
      <Pagination pager={pager} noun="loans" />
    </>
  );
}

/** One line over the table: is the applicant common to every case, does the PAN match, cancelled with a reason. */
function CommonLine({ v, ctx }: { v: DedupeView; ctx: Ctx }) {
  const c = v.commonApplicant;
  if (!c || !c.cases) return null;
  const pan = ((((ctx.text.match_table || {}) as { checks?: Record<string, string> }).checks) || {})[c.pan] || c.pan;
  const tone = ({ MATCH: "ok", MISMATCH: "bad" } as Record<string, string>)[c.pan] || "na";
  return (
    <div className="common-line">
      <span><b>Common applicant: </b>{c.same_customer_on_all
        ? `✓ all ${c.cases} case${c.cases > 1 ? "s" : ""} are under one customer${v.match.ref !== "—" ? ` (${v.match.ref})` : ""}` : "not the same customer on every case"}</span>
      <span><b>PAN: </b><span className={`mt-res mt-${tone}`}>{pan}</span>{c.pan === "NOT_COMPARED" ? " (no PAN on this case yet)" : ` on all ${c.cases}`}</span>
      {c.cancelled_cases ? <span><b>Cancelled: </b>{`${c.cancelled_cases} `
        + (c.cancelled_with_reason === c.cancelled_cases ? "(reason given)" : c.cancelled_with_reason
          ? `(reason given for ${c.cancelled_with_reason})` : "(no reason given)")}</span> : null}
    </div>
  );
}

/** One PR's details (core loanDetail): grouped cards (ui_text.json loan_detail_groups); a field in no group is still shown, last. */
function LoanDetailBox({ row, text }: { row: LoanRow; text: UiText }) {
  const all = C.loanDetail(row, text);
  const groups = (text.loan_detail_groups || []) as { title: string; tone?: string; keys: string[] }[];
  const used = new Set(groups.flatMap((g) => g.keys));
  const rest = all.filter((d) => !used.has(d.key));
  type D = (typeof all)[number];
  const value = (d: D): ReactNode => (d.value === null ? <span className="dash">{d.note || "Not in source"}</span>
    : /_match$/.test(d.key) || d.key === "topup" ? <span className={`mt-res mt-${d.tone}`}>{d.value}</span>
      : d.tone ? <Pill tone={d.tone}>{d.value}</Pill> : d.value);
  const card = (title: string, tone: string, items: D[], key: string) => (items.length ? (
    <section key={key} className={`pr-card pr-${tone}`}><h5>{title}</h5>
      <dl>{items.map((d) => (
        <div key={d.key} className="pr-row" title={`Source: ${d.source}`}><dt>{d.label}</dt>
          <dd className={`${d.num ? "num " : ""}${d.key === "ap_code" || d.key === "product_code" ? "mono" : ""}`}>{value(d)}</dd></div>
      ))}</dl></section>
  ) : null);
  return (
    <div className="pr-cards">
      {groups.map((g, i) => card(g.title, g.tone || "na", g.keys.map((k) => all.find((d) => d.key === k)).filter(Boolean) as D[], `g${i}`))}
      {card("More", "na", rest, "more")}
    </div>
  );
}

/** One loan's details in a side panel from the right. Esc, the close button or a click outside closes it; focus
 * returns to what opened it. */
function LoanDrawer({ row, text, onClose }: { row: LoanRow; text: UiText; onClose: () => void }) {
  const t = (text.pr_panel || {}) as Record<string, string>;
  const [on, setOn] = useState(false);
  const closeRef = (el: HTMLButtonElement | null) => { if (el && !on) el.focus(); };
  useEffect(() => { const id = requestAnimationFrame(() => setOn(true)); return () => cancelAnimationFrame(id); }, []);
  return createPortal(
    <>
      <div className={`drawer-shade${on ? " on" : ""}`} id="pr-shade" onClick={onClose} />
      <aside className={`drawer${on ? " on" : ""}`} id="pr-drawer" role="dialog" aria-modal="true" aria-labelledby="pr-drawer-title" tabIndex={-1}
        onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
        <header className="drawer-head">
          <div>
            <div className="drawer-kicker">{t.title || "Loan details"}</div>
            <h3 id="pr-drawer-title" className="mono">{(row.prospect_code as string) || "Loan"}</h3>
            <div className="drawer-sub">
              {row.product_name ? <span>{row.product_name as string}</span> : null}
              {row.loan_amount ? <span>{row.loan_amount as string}</span> : null}
              {row.loan_status ? <Pill tone={row.status_tone as string}>{row.loan_status as string}</Pill> : null}
            </div>
          </div>
          <button type="button" className="drawer-close" aria-label={t.close || "Close"} onClick={onClose} ref={closeRef}>✕</button>
        </header>
        <div className="drawer-body"><LoanDetailBox row={row} text={text} /></div>
      </aside>
    </>,
    document.body,
  );
}

// ---------------------------------------------------------------- What matched
function MatchTableBox({ v, entered, text }: { v: DedupeView; entered: Entered; text: UiText }) {
  const t = (text.match_table || {}) as Record<string, string>;
  const rows = C.matchTable(v, entered, text);
  const pager = usePagination(rows);
  if (!rows.length) return null;
  return (
    <div className="mt"><h4>{t.title || "Field by field"}</h4>
      <div className="table-wrap"><table className="mt-table">
        <thead><tr>{["Field", "You entered", "MIFIN record", "Result"].map((x) => <th key={x} scope="col">{x}</th>)}</tr></thead>
        <tbody>{pager.rows.map((r, i) => (
          <tr key={pager.from + i} className={`mt-row-${r.tone}`}><th scope="row">{r.field}</th>
            <td className="mono">{r.entered || <Dash />}</td>
            <td className="mono">{r.mifin || <Dash />}</td>
            <td><span className={`mt-res mt-${r.tone}`}>{r.result}</span></td></tr>
        ))}</tbody>
      </table></div>
      <Pagination pager={pager} noun="fields" />
      {t.note ? <p className="mt-note">{t.note}</p> : null}
    </div>
  );
}

function CustomerPanel({ v, ctx, entered }: { v: DedupeView; ctx: Ctx; entered: Entered }) {
  const iconFor: Record<string, string> = { ok: "ok", brand: "user", warn: "warn", bad: "bad", na: "info" };
  return (
    <section className="panel">
      <div className="panel-head"><div className="t"><Icon name="user" className="ico ico-teal" />
        <div><h2>What matched</h2><p>{`Searched by ${C.searchedLabel(v.searched)}, in MIFIN and the LOS`}</p></div></div></div>
      <div className="panel-body">
        <ul className="matched">{v.matched.map((m, i) => <li key={i} className={`m-${m.tone}`}><Icon name={iconFor[m.tone] || "info"} /><span>{m.text}</span></li>)}</ul>
        <MatchTableBox v={v} entered={entered} text={ctx.text} />
        {/* a match on other LOS cases: one line with the counts (by role, by product) -- not a list of case IDs */}
        {v.otherCases.length ? <p className="match-line"><Icon name="warn" />{C.otherCasesLine(v, ctx.text, ctx.roleWord, label)}</p> : null}
      </div>
    </section>
  );
}

function LosPanel({ v }: { v: DedupeView }) {
  const items: ReactNode[] = [];
  const recs = ((v.los.recommendations || []) as string[]).filter((r) => !["CONTINUE_STANDARD_ONBOARDING", "LINK_EXISTING_CUSTOMER", "PARTIAL_ANALYSIS", "DATA_UNAVAILABLE"].includes(r));
  recs.forEach((r) => items.push(<li key={r}><Icon name="warn" />{label(r)}</li>));
  if (v.los.documentsReused) items.push(<li key="reuse"><Icon name="warn" />{`${v.los.documentsReused} file(s) also on another customer's case`}</li>);
  if (!items.length) items.push(<li key="ok" className="ok"><Icon name="ok" />{v.los.status === "INSUFFICIENT_DATA"
    ? "No PAN or mobile on this case's records yet: the LOS check has little to compare." : "No issue in the LOS's own records."}</li>);
  return (
    <section className="panel">
      <div className="panel-head"><div className="t"><Icon name="shield" className="ico ico-warn" /><div><h2>LOS records</h2><p>Role swaps, file reuse, parallel applications</p></div></div></div>
      <div className="panel-body"><ul className="findings">{items}</ul></div>
    </section>
  );
}

// ---------------------------------------------------------------- the whole result (the common result layout)
export interface ResultProps {
  v: DedupeView;
  text: UiText;
  entered: Entered;
  showBackToAll: boolean;
  onBackToAll: () => void;
  onDecide: (decision: string, candidate: unknown) => Promise<void>;
  /** the page's own "run the same check again" */
  onRerun?: () => void;
}

export default function Result({ v, text, entered, showBackToAll, onBackToAll, onDecide, onRerun }: ResultProps) {
  const [open, setOpen] = useState<{ row: LoanRow; id: string; opener: Element | null } | null>(null);
  const ctx: Ctx = { text, roleWord: makeRoleWord(text) };
  // a new answer: the side panel closes
  useEffect(() => { setOpen(null); }, [v.requestId]);
  const close = () => {
    const opener = open?.opener as HTMLElement | null | undefined;
    setOpen(null);
    if (opener && document.contains(opener)) opener.focus();
  };
  const page = toResultPage(v, { text, entered, onRerun });
  return (
    <div id="result">
      {showBackToAll ? <button className="btn ghost small back-all" type="button" onClick={onBackToAll}>← Back to all parameters</button> : null}
      <ResultPage {...page}>
        {v.confirmation.required ? (
          <section className="panel confirm-panel" aria-labelledby="h-confirm">
            <div className="panel-head"><div className="t"><Icon name="warn" className="ico ico-warn" />
              <div><h2 id="h-confirm">Possible match</h2><p>Your decision is saved on the case and used by every later check</p></div></div></div>
            <div className="panel-body"><ConfirmBox v={v} onDecide={onDecide} /></div>
          </section>
        ) : null}
        <LoansPanel v={v} ctx={ctx} openLoan={open?.id ?? null}
          onOpen={(row, id) => setOpen({ row, id, opener: document.activeElement })} />
        <CustomerPanel v={v} ctx={ctx} entered={entered} />
        <LosPanel v={v} />
      </ResultPage>
      {open ? <LoanDrawer row={open.row} text={text} onClose={close} /> : null}
    </div>
  );
}
