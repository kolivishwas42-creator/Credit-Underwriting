// The document checklist: one card per person, one row per required document. Click a row for its details.
import { docsFor, FILTER_EMPTY, FILTER_WORD, initials, personName, ROLES, tenth, words } from "../lib/format";
import { Pagination, usePagination } from "../../../shared/components";
import type { Board, Filter, Role } from "../types";

interface Props {
  board: Board;
  filter: Filter | null;
  onClearFilter: () => void;
  onOpenDoc: (slot: string, role: Role) => void;
}

export function People({ board, filter, onClearFilter, onOpenDoc }: Props) {
  const { documents: d, answer: a } = board;
  const people = d.people.length ? d.people : ["PRIMARY_APPLICANT"];
  return (
    <div className={"people" + (people.length === 1 ? " solo" : "")} id="people">
      {people.map((role) => {
        const docs = docsFor(board, role);
        const n = (t: string) => docs.filter((x) => x.look[0] === t).length;
        const total = docs.length || 1;
        const p = (a.summary.people || {})[role] || { open: 0, critical: 0 };
        const job = role === "CO_APPLICANT" ? board.case.co_applicant_employment_type : board.case.employment_type;
        const shown = filter ? docs.filter((x) => x.group === filter) : docs;
        const name = p.name || personName(board, role);
        return (
          <article key={role} className={`person fade-in ${role === "CO_APPLICANT" ? "co" : ""}`}>
            <div className="p-head">
              <div className="avatar" aria-hidden="true">{initials(name)}</div>
              <div className="grow"><div className="p-role">{ROLES[role] || words(role)}</div><div className="p-name">{name || "—"}</div>
                <div className={`job ${job ? "" : "none"}`}>{words(job) || "Employment not captured"}</div></div>
              <div className="p-prog"><span className="n">{n("ok")} of {docs.length} verified</span>
                <span className="bar">{(["ok", "warn", "bad"] as const).map((t) => <i key={t} className={`${t} w${tenth(n(t), total)}`}></i>)}</span></div>
            </div>
            {filter && (
              <div className="filter-note"><span>{shown.length} {FILTER_WORD[filter].toLowerCase()} of {docs.length}</span>
                <button type="button" className="link clear-filter" onClick={onClearFilter}>Show all</button></div>
            )}
            {shown.length ? <PersonDocs shown={shown} role={role} onOpenDoc={onOpenDoc} /> : (
              <div className="docs">
                <div className="empty-note">{docs.length && filter ? `${FILTER_EMPTY[filter]} for this person.` : "No document requirements for this person."}</div>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

/** one person's document rows, a page at a time */
function PersonDocs({ shown, role, onOpenDoc }: {
  shown: ReturnType<typeof docsFor>; role: Role; onOpenDoc: (slot: string, role: Role) => void;
}) {
  const pager = usePagination(shown);
  return (
    <>
      <div className="docs">
        {pager.rows.map(({ row, cell, look }) => (
          <button key={row.slot} className={`doc ${look[0]}`} data-slot={row.slot} data-role={role} onClick={() => onOpenDoc(row.slot, role)}>
            <span className="st">{look[1]}</span>
            <span className="grow"><div className="t">{row.label}</div><div className="s">{look[2]}</div></span>
            {look[0] === "bad" ? <span className="tag bad">Critical</span>
              : cell.state === "AWAITING_APPROVAL" ? <span className="tag approval">Approval</span>
              : look[0] === "warn" ? <span className="tag warn">To collect</span> : null}
          </button>
        ))}
      </div>
      <Pagination pager={pager} noun="documents" />
    </>
  );
}
