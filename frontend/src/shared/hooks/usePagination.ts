import { useEffect, useMemo, useState } from "react";

export const PAGE_SIZES = [10, 20, 50];

export interface Paged<T> {
  /** the rows of the current page */
  rows: T[];
  page: number;
  pageSize: number;
  pageCount: number;
  total: number;
  /** 1-based index of the first / last row shown (0 when empty) */
  from: number;
  to: number;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
}

/**
 * Client-side pagination of a list the screen already has. The page resets to 1 when the list changes length
 * (a new search / result) and is clamped when rows disappear.
 */
export function usePagination<T>(items: readonly T[] | null | undefined, initialSize = PAGE_SIZES[0]): Paged<T> {
  const list = items ?? [];
  const [page, setPageState] = useState(1);
  const [pageSize, setSize] = useState(initialSize);
  const total = list.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => { setPageState(1); }, [total]);
  const current = Math.min(page, pageCount);

  const rows = useMemo(
    () => list.slice((current - 1) * pageSize, current * pageSize),
    [list, current, pageSize],
  );
  return {
    rows,
    page: current,
    pageSize,
    pageCount,
    total,
    from: total ? (current - 1) * pageSize + 1 : 0,
    to: Math.min(current * pageSize, total),
    setPage: (p: number) => setPageState(Math.min(Math.max(1, p), pageCount)),
    setPageSize: (s: number) => { setSize(s); setPageState(1); },
  };
}
