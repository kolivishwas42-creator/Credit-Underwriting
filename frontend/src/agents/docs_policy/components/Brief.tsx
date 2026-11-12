// The brief's open items: Critical / Awaiting approval / To collect, each one opening its document. The brief's note
// and the next step are the summary card's points now; Copy brief is an action.
import { briefGroups, firstSentence, slotOf, who } from "../lib/format";
import type { Board, Requirement, Role } from "../types";

interface Props {
  board: Board;
  onOpenDoc: (slot: string, role: Role) => void;
}

export function Brief({ board, onOpenDoc }: Props) {
  const { critical, approval, collect } = briefGroups(board);
  if (!critical.length && !approval.length && !collect.length) return null;
  const list = (items: Requirement[], tone: string) => (
    <>
      {items.slice(0, 6).map((q, i) => {
        const at = slotOf(board, q);
        const text = <><i className={`dot ${tone}`}></i><span>{who(board, q) + firstSentence(q.reason)}</span></>;
        return at ? (
          <button key={i} type="button" className="mini go" data-slot={at.slot} data-role={at.role} title="Open this document"
            onClick={() => onOpenDoc(at.slot, at.role)}>
            {text}<span className="arrow" aria-hidden="true">›</span>
          </button>
        ) : <div key={i} className="mini">{text}</div>;
      })}
      {items.length > 6 && <div className="mini"><span>+ {items.length - 6} more</span></div>}
    </>
  );
  return (
    <aside className="brief" id="brief" aria-label="Open items">
      <div className="card memo fade-in">
        <div className="memo-head"><h3>Open items</h3></div>
        <div className="open-items">
          {critical.length > 0 && <div><div className="list-title">Critical</div>{list(critical, "bad")}</div>}
          {approval.length > 0 && <div><div className="list-title">Awaiting approval</div>{list(approval, "approval")}</div>}
          {collect.length > 0 && <div><div className="list-title">To collect</div>{list(collect, "warn")}</div>}
        </div>
      </div>
    </aside>
  );
}
