// The fraud screening API on the LOS server (same origin; the LOS login decides who the caller is, this client sends
// no token). Errors are thrown with the server's own message when it gave one.
import { withoutDevNames } from "../../../shared/lib/people";
import type { Evaluation, RuleConfig } from "../types";

export const API = "/api/v1/credit/fraud-screening";

/** the message of an error body: {"detail": "..."}, {"detail": {"message"}} or {"error": {"message"}} */
export function detailText(body: unknown, fallback: string): string {
  const b = body as { detail?: unknown; error?: { message?: string } } | null;
  if (b && typeof b.detail === "string" && b.detail) return b.detail;
  const d = b?.detail as { message?: string } | undefined;
  if (d && typeof d === "object" && d.message) return d.message;
  if (b?.error?.message) return b.error.message;
  return fallback;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(API + path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
    credentials: "same-origin",
  });
  let data: unknown = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) throw new Error(detailText(data, res.statusText || `HTTP ${res.status}`));
  return withoutDevNames(data as T);
}

export const api = {
  rules: () => call<RuleConfig[]>("/rules"),
  setRule: (key: string, enabled: boolean) =>
    call<RuleConfig>(`/rules/${encodeURIComponent(key)}`, { method: "PATCH", body: JSON.stringify({ enabled }) }),
  evaluate: (applicationNumber: string, runAml: boolean, runPep: boolean) =>
    call<Evaluation>("/fraud/evaluate", {
      method: "POST",
      body: JSON.stringify({ application_number: applicationNumber, run_aml: runAml, run_pep: runPep }),
    }),
};
