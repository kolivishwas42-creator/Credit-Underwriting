import { PAGE_SIZES, type Paged } from "../hooks/usePagination";

interface Props {
  pager: Paged<unknown>;
  /** what the rows are, for the count line: "cases", "rules" ... */
  noun?: string;
  /** hide the page-size picker */
  fixedSize?: boolean;
}

/** The pages of the window around the current one: 1 … 4 5 [6] 7 8 … 20 */
function windowOf(page: number, count: number): (number | "gap")[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
  const out: (number | "gap")[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(count - 1, page + 1);
  if (start > 2) out.push("gap");
  for (let p = start; p <= end; p += 1) out.push(p);
  if (end < count - 1) out.push("gap");
  out.push(count);
  return out;
}

/** Shared pager for every list and table. Renders nothing when everything fits on one page. */
export function Pagination({ pager, noun = "rows", fixedSize = false }: Props) {
  const { page, pageCount, total, from, to, pageSize, setPage, setPageSize } = pager;
  // nothing to page: one page only (and, with a size picker, too few rows for the smallest size)
  if (pageCount <= 1 && (fixedSize || total <= PAGE_SIZES[0])) return null;
  return (
    <div className="cu-ui cu-pager" role="navigation" aria-label={`${noun} pages`}>
      <span>{from}–{to} of {total} {noun}</span>
      <div className="cu-pager-pages">
        <button type="button" className="cu-pager-btn" onClick={() => setPage(page - 1)} disabled={page <= 1}
          aria-label="Previous page">‹</button>
        {windowOf(page, pageCount).map((p, i) => p === "gap"
          ? <span key={`g${i}`} className="cu-pager-gap">…</span>
          : (
            <button key={p} type="button" className={`cu-pager-btn${p === page ? " is-current" : ""}`}
              aria-current={p === page ? "page" : undefined} onClick={() => setPage(p)}>{p}</button>
          ))}
        <button type="button" className="cu-pager-btn" onClick={() => setPage(page + 1)} disabled={page >= pageCount}
          aria-label="Next page">›</button>
      </div>
      {!fixedSize && (
        <span className="cu-pager-size">
          Per page
          <select aria-label="Rows per page" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
            {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </span>
      )}
    </div>
  );
}
