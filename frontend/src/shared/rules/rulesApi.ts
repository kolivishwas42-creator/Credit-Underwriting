// Rules settings: one way to read and save any agent's rules, driven by config/rulesSettings.ts.
import type { RulesSource } from "../../config/rulesSettings";
import { withoutDevNames } from "../lib/people";

export type Row = Record<string, unknown>;

export interface RuleView {
  /** stable id inside the screen */
  key: string;
  name: string;
  code: string;
  description: string;
  severity: string | null;
  enabled: boolean;
  /** always on (an overall rule that sums the others up): the switch is shown locked */
  locked: boolean;
  /** the numbers that can be changed: [field or "numbersIn.key", label, value] */
  numbers: { id: string; label: string; value: number; step?: number }[];
  row: Row;
}

const TOKEN_KEY = "los_access_token";

async function call(url: string, init: RequestInit = {}): Promise<unknown> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  let token: string | null = null;
  try { token = localStorage.getItem(TOKEN_KEY); } catch { /* storage blocked */ }
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(url, { ...init, headers, credentials: "same-origin" });
  let body: unknown = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) {
    const b = body as { detail?: unknown; error?: { message?: string } } | null;
    const d = b?.detail;
    const msg = typeof d === "string" ? d : (d as { message?: string } | undefined)?.message || b?.error?.message;
    throw new Error(msg || `HTTP ${res.status}`);
  }
  return withoutDevNames(body);
}

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const pretty = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** one rule row -> what the screen shows */
export function toView(src: RulesSource, row: Row): RuleView {
  const name = src.name.map((f) => str(row[f])).find(Boolean) || "";
  const numbers: RuleView["numbers"] = [];
  for (const n of src.numbers ?? []) {
    const v = row[n.field];
    if (typeof v === "number") numbers.push({ id: n.field, label: n.label, value: v, step: n.step });
  }
  if (src.numbersIn) {
    const obj = row[src.numbersIn];
    if (obj && typeof obj === "object") {
      for (const [k, v] of Object.entries(obj as Row)) {
        if (typeof v === "number") numbers.push({ id: `${src.numbersIn}.${k}`, label: pretty(k), value: v });
      }
    }
  }
  return {
    key: src.key.map((f) => str(row[f])).join(":"),
    name: name.includes("_") && !name.includes(" ") ? pretty(name) : name,
    code: src.code ? str(row[src.code]) : "",
    description: src.description ? str(row[src.description]) : "",
    severity: src.severity ? str(row[src.severity]) || null : null,
    enabled: Boolean(row[src.enabled]),
    locked: src.locked ? Boolean(row[src.locked]) : false,
    numbers,
    row,
  };
}

/** the base of one group: the group's value in the path (a rule set per group) or the plain base */
export function baseOf(src: RulesSource, group?: string): string {
  return src.groups?.inPath && group ? `${src.base}${encodeURIComponent(group)}` : src.base;
}

export interface Template {
  title: string;
  fields: string[];
  signals: string[];
  operators: string[];
  severities: string[];
}

export interface RuleSet {
  rules: RuleView[];
  /** the templates a new rule can be made from (empty: no Add rule) */
  templates: Record<string, Template>;
  /** the set's own word for "on" (Crime: "Sends to review") */
  onLabel: string | null;
}

export async function loadSet(src: RulesSource, group?: string): Promise<RuleSet> {
  const q = src.groups && group && !src.groups.inPath ? `?${encodeURIComponent(src.groups.param)}=${encodeURIComponent(group)}` : "";
  const data = await call(`${baseOf(src, group)}${src.list}${q}`);
  const rows = (src.rowsAt ? (data as Row)?.[src.rowsAt] : data) as Row[] | undefined;
  if (!Array.isArray(rows)) throw new Error("The agent's rules list has an unexpected shape.");
  const templates = (src.templatesAt ? (data as Row)?.[src.templatesAt] : null) as Record<string, Template> | null;
  const onLabel = src.onLabelAt ? str((data as Row)?.[src.onLabelAt]) || null : null;
  return { rules: rows.map((r) => toView(src, r)), templates: templates ?? {}, onLabel };
}

export async function loadRules(src: RulesSource, group?: string): Promise<RuleView[]> {
  return (await loadSet(src, group)).rules;
}

/** add a rule from a template (POST <base>/rules {template, values}) -- the server checks it before saving */
export async function addRule(src: RulesSource, template: string, values: Row, group?: string): Promise<void> {
  await call(`${baseOf(src, group)}/rules`, { method: "POST", body: JSON.stringify({ template, values }) });
}

export interface RuleChange {
  enabled?: boolean;
  severity?: string;
  /** number id (field, or "numbersIn.key") -> new value */
  numbers?: Record<string, number>;
}

/** the body an agent's API expects for this change (only what changed, plus the rule's key fields) */
export function saveBody(src: RulesSource, rule: RuleView, change: RuleChange, group?: string): Row {
  const body: Row = {};
  for (const f of src.key) body[f] = rule.row[f];
  if (change.enabled !== undefined) body[src.enabled] = change.enabled;
  if (change.severity !== undefined && src.severity) body[src.severity] = change.severity;
  const inner: Row = {};
  for (const [id, v] of Object.entries(change.numbers ?? {})) {
    if (src.numbersIn && id.startsWith(`${src.numbersIn}.`)) inner[id.slice(src.numbersIn.length + 1)] = v;
    else body[id] = v;
  }
  if (src.numbersIn && Object.keys(inner).length) {
    // the rule store API takes only what changed; the other APIs replace the whole object
    body[src.numbersIn] = src.numbersPartial ? inner : { ...((rule.row[src.numbersIn] as Row) ?? {}), ...inner };
  }
  if (src.save.wrap) return { [src.save.wrap.groupField]: group, [src.save.wrap.listField]: [body] };
  return body;
}

export function savePath(src: RulesSource, rule: RuleView): string {
  return src.save.path.replace(/\{(\w+)\}/g, (_, f: string) => encodeURIComponent(str(rule.row[f])));
}

export async function saveRule(src: RulesSource, rule: RuleView, change: RuleChange, group?: string): Promise<void> {
  await call(`${baseOf(src, group)}${savePath(src, rule)}`, { method: src.save.method, body: JSON.stringify(saveBody(src, rule, change, group)) });
}
