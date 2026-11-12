// The filter bar over the checklists: Critical / Approval / To collect / Verified (the basic card's counts), each one
// a "show only" toggle. The route, its text and the underwriting gate are on the basic card now.
import { FILTER_WORD } from "../lib/format";
import { boardCounts } from "../utils/resultView";
import type { Board, Filter } from "../types";

interface Props {
  board: Board | null;
  filter: Filter | null;
  onFilter: (f: Filter) => void;
}

export function Banner({ board, filter, onFilter }: Props) {
  if (!board) return null;
  return (
    <section className="filterbar fade-in" id="banner" aria-label="Document checklist filter">
      <span className="filterbar-k">Show only</span>
      <div className="counts" role="group" aria-label="Show only">
        {boardCounts(board).map(([t, n]) => (
          <button key={t} type="button" className={`count ${t} ${filter === t ? "on" : ""}`} data-filter={t} aria-pressed={filter === t}
            title={filter === t ? "Show every document" : `Show only ${FILTER_WORD[t].toLowerCase()} documents`}
            onClick={() => onFilter(t)}>
            <b>{n}</b><span>{FILTER_WORD[t]}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
