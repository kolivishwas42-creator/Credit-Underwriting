// The document readiness API on the LOS server, called on the page's own origin (the dev/preview proxy or the
// deployment's reverse proxy forwards /api/v1/credit/document-readiness/* only). No token is stored here: the
// browser's own Authorization (SSO) passes through; the backend uses bearer tokens, not cookies.
import { withoutDevNames } from "../../../shared/lib/people";
import type { Board } from "../types";

export const API = "/api/v1/credit/document-readiness";

interface ErrorBody { detail?: { message?: string; code?: string; error?: string } }

async function call<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(API + path, { headers: { "content-type": "application/json" }, cache: "no-store", ...opts });
  const body = (await res.json().catch(() => ({}))) as ErrorBody & T;
  if (!res.ok) {
    const d = (body as ErrorBody).detail || {};
    const known: Record<number, string> = {
      403: "No case with this ID, or you are not allowed to see it.", 404: "No case with this ID.",
      422: d.message || "This case cannot be checked: " + (d.code || "invalid request"),
      502: "The LOS backend is not reachable.", 504: "The LOS backend took too long to answer.",
    };
    throw new Error(known[res.status] || d.message || d.error || `Request failed (${res.status})`);
  }
  return withoutDevNames(body as T);
}

/** the case, the readiness answer, all 11 rules with their sections, and the document checklist */
export const fetchBoard = (caseId: string) => call<Board>(`/${encodeURIComponent(caseId)}/rules`, { method: "POST" });
