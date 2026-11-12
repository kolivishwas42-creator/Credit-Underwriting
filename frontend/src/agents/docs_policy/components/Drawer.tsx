// The details drawer: one document, or one rule. Esc, the scrim or ✕ closes it.
import { useEffect, useRef, type ReactNode } from "react";
import { Pagination, usePagination } from "../../../shared/components";
import { firstSentence, rest } from "../lib/format";

export interface DrawerContent {
  kicker: string;
  title: string;
  help?: string;
  stat: ReactNode;
  body: ReactNode;
}

/** one line of the drawer: the first sentence, the rest under it, an optional tag */
export function Line({ text, tone, tag }: { text: string; tone: string; tag?: string }) {
  const more = rest(text);
  return (
    <div className="line fade-in"><span className={`edge ${tone}`}></span>
      <div className="grow"><div className="t">{firstSentence(text)}</div>{more ? <div className="d">{more}</div> : null}</div>
      {tag ? <span className={`tag ${tone}`}>{tag}</span> : null}</div>
  );
}

/** a list of drawer lines, a page at a time (the pager shows only past one page) */
export function PagedLines({ items, noun }: { items: ReactNode[]; noun: string }) {
  const pager = usePagination(items);
  return <>{pager.rows}<Pagination pager={pager} noun={noun} /></>;
}

interface Props {
  open: boolean;
  content: DrawerContent | null;
  onClose: () => void;
}

export function Drawer({ open, content, onClose }: Props) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (open) close.current?.focus(); }, [open, content]);
  return (
    <>
      <div className="scrim" id="scrim" hidden={!open} onClick={onClose}></div>
      <aside className={`drawer${open ? " open" : ""}`} id="drawer" aria-hidden={open ? "false" : "true"} aria-labelledby="drawer-title" role="dialog">
        <div className="drawer-head">
          <div>
            <div className="drawer-kicker" id="drawer-kicker">{content?.kicker}</div>
            <h2 id="drawer-title">{content?.title}</h2>
            <p className="drawer-help" id="drawer-help">{content?.help || ""}</p>
          </div>
          <button className="icon-btn" type="button" id="drawer-close" aria-label="Close" ref={close} onClick={onClose}>✕</button>
        </div>
        <div className="drawer-stat" id="drawer-stat">{content?.stat}</div>
        <div className="drawer-body" id="drawer-body">{content?.body}</div>
      </aside>
    </>
  );
}
