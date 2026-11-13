// CUSTOM RULES FOR EVERY AGENT (owner 2026-11-13: "add rule sab ke liye"): an officer's rule on any value the agent
// shows under Calculations -- "FOIR > 55 -> Review". Kept in the database (backend shared/api/custom_rules.py); applied
// on the agent's result page beside its own rules.
import { useEffect, useState } from "react";
import { withoutDevNames } from "../lib/people";
import type { CalcRow, RuleRow, Tone } from "../components/result/types";

export interface CustomRule {
  id: string;
  name: string;
  description?: string | null;
  enabled: boolean;
  severity: string | null;
  params: { field: string; operator: string; value: number; outcome: "review" | "fail" };
  updated_by?: string;
  updated_at?: string;
}

const base = (agent: string) => `/api/v1/rule-settings/custom/${encodeURIComponent(agent)}`;
const TOKEN_KEY = "los_access_token";

async function call(url: string, init: RequestInit = {}): Promise<any> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  let token: string | null = null;
  try { token = localStorage.getItem(TOKEN_KEY); } catch { /* storage blocked */ }
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(url, { ...init, headers, credentials: "same-origin" });
  let body: any = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) {
    const d = body?.detail;
    throw new Error((typeof d === "string" ? d : d?.message) || body?.error?.message || `HTTP ${res.status}`);
  }
  return withoutDevNames(body);
}

export const customApi = {
  list: async (agent: string): Promise<CustomRule[]> => (await call(base(agent))).rules ?? [],
  add: (agent: string, rule: { rule_id: string; name: string; description?: string; field: string; operator: string;
    value: number; outcome: string; severity: string }) => call(base(agent), { method: "POST", body: JSON.stringify(rule) }),
  change: (agent: string, id: string, change: Partial<{ enabled: boolean; value: number; operator: string; outcome: string;
    severity: string }>) => call(`${base(agent)}/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(change) }),
  remove: (agent: string, id: string) => call(`${base(agent)}/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

/** the number in a value as shown ("62.4%", "₹1,20,000", "3 found") -- null when there is none */
export function numberIn(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const m = value.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

const holds = (v: number, op: string, limit: number) =>
  op === "gt" ? v > limit : op === "ge" ? v >= limit : op === "lt" ? v < limit : op === "le" ? v <= limit
    : op === "eq" ? v === limit : op === "ne" ? v !== limit : false;

export const OPERATOR_SIGN: Record<string, string> = { gt: ">", ge: "≥", lt: "<", le: "≤", eq: "=", ne: "≠" };
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** each switched-on custom rule as a rule of the result: fires (Review / Fail) when the named value meets it, passes
 *  when it does not, "not evaluated" (grey) when the result has no such value */
export function applyCustomRules(rules: CustomRule[], calcs: CalcRow[]): RuleRow[] {
  return rules.filter((r) => r.enabled).map((r) => {
    const { field, operator, value: limit, outcome } = r.params;
    const row = calcs.find((c) => norm(c.label) === norm(field) && numberIn(c.value) !== null);
    const v = row ? numberIn(row.value) : null;
    const tone: Tone = v === null ? "na" : holds(v, operator, limit) ? (outcome === "fail" ? "fail" : "review") : "pass";
    const shown = row ? String(row.value) : "—";
    return {
      id: r.id,
      name: r.name,
      outcome: tone,
      outcomeLabel: tone === "na" ? "Not evaluated" : undefined,
      severity: r.severity ?? undefined,
      detail: v === null ? `No "${field}" in this result` : `${field}: ${shown} (custom rule ${OPERATOR_SIGN[operator] ?? operator} ${limit})`,
      values: [{ label: "Value", value: shown }, { label: "Limit", value: `${OPERATOR_SIGN[operator] ?? operator} ${limit}` }],
    };
  });
}

const cache = new Map<string, { at: number; rules: CustomRule[] }>();
const TTL_MS = 30_000;

/** the agent's custom rules for a result page (cached briefly; none when they cannot be read -- the result stands) */
export function useCustomRules(agent: string | null): CustomRule[] {
  const [rules, setRules] = useState<CustomRule[]>(() => (agent && cache.get(agent)?.rules) || []);
  useEffect(() => {
    if (!agent) return;
    const hit = cache.get(agent);
    if (hit && Date.now() - hit.at < TTL_MS) { setRules(hit.rules); return; }
    let alive = true;
    customApi.list(agent).then((r) => { cache.set(agent, { at: Date.now(), rules: r }); if (alive) setRules(r); })
      .catch(() => { if (alive) setRules([]); });
    return () => { alive = false; };
  }, [agent]);
  return rules;
}

/** forget the cache after a change on the Rules screen */
export function forgetCustomRules(agent?: string) { if (agent) cache.delete(agent); else cache.clear(); }
