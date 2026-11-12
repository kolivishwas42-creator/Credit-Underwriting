// The eligibility API on the LOS server (same origin; the LOS login decides who the caller is, this client sends no
// token). Errors are thrown as HttpError with the parsed body so errorText() can word them.
import { withoutDevNames } from "../../../shared/lib/people";
import type { CasePayload, CaseRow, CheckResult, Form, Inputs, Saved } from "../types";

export const API = "/api/v1/eligibility";

export class HttpError extends Error {
  constructor(public status: number, public data: unknown) {
    super(`Request failed (${status || "network"})`);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API + path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch {
    throw new HttpError(0, null);
  }
  let data: unknown = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) throw new HttpError(res.status, data);
  return withoutDevNames(data as T);
}

const q = encodeURIComponent;

export const api = {
  form: () => call<Form>("GET", "/form"),
  cases: () => call<{ cases: CaseRow[] }>("GET", "/cases"),
  getCase: (id: string) => call<CasePayload>("GET", `/cases/${q(id)}`),
  save: (id: string, inputs: Inputs) => call<Saved>("PUT", `/cases/${q(id)}/inputs`, inputs),
  check: (caseId: string, inputs: Inputs) => call<CheckResult>("POST", "/check", { case_id: caseId, ...inputs }),
};
