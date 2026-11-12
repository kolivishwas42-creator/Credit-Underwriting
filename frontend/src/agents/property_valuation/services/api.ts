import { withoutDevNames } from "../../../shared/lib/people";
// The property valuation API on the LOS server (same origin; the LOS login decides who the caller is, this client
// sends no token). Errors are thrown with the server's own message when it gave one.
import type { Application, History, RuleConfig, ValuationResult } from "../types";

export const API_BASE = "/api/v1/credit/property-valuation";

/** {"detail": "..."}, {"detail": {"message"}}, {"message"} or {"error": {"message"}} */
export function errorMessage(data: unknown, status: number): string {
  const d = data as { detail?: unknown; message?: string; error?: { message?: string } } | null;
  if (d && typeof d.detail === "string" && d.detail) return d.detail;
  const det = d?.detail as { message?: string } | undefined;
  if (det && typeof det === "object" && det.message) return det.message;
  return d?.message || d?.error?.message || `HTTP ${status}`;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(API_BASE + path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
    credentials: "same-origin",
  });
  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = { detail: text }; }
  if (!res.ok) throw new Error(errorMessage(data, res.status));
  return withoutDevNames(data as T);
}

const q = encodeURIComponent;

export interface ValuationRequest {
  collateral_property_id: number | string;
  vendor_name: string;
  verification_type: string;
  submitted_data: Record<string, unknown>;
  vendor_response: Record<string, unknown>;
  verified_at: string;
}

export interface RuleUpdate {
  enabled: boolean;
  severity: string;
  sequence: number;
  settings: unknown;
  fields: unknown;
}

export const api = {
  health: () => call<{ status: string }>("/health"),
  application: (no: string) => call<Application>(`/applications/${q(no)}`),
  runValuation: (no: string, propertyId: number | string, body: ValuationRequest) =>
    call<ValuationResult>(`/applications/${q(no)}/properties/${propertyId}/valuation`, {
      method: "POST", body: JSON.stringify(body),
    }),
  rules: () => call<RuleConfig[]>("/rules"),
  saveRule: (key: string, body: RuleUpdate) => call<RuleConfig>(`/rules/${key}`, { method: "PUT", body: JSON.stringify(body) }),
  history: (no: string) => call<History>(`/applications/${q(no)}/history`),
};
