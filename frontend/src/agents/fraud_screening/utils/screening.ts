// The screen's pure logic: rule counts and row classes, the match-score gauge, the AML / PEP wording.
import type { Evaluation, RuleResult, ScreenKind, Screening } from "../types";

export const AML_LABEL: Record<string, string> = {
  match: "Match", partial: "Partial", mismatch: "Differs", unavailable: "Not comparable",
};

export const SCREENS: Record<ScreenKind, { title: string; recordLabel: string; sampleFile: string; urlVar: string; badge: string }> = {
  aml: { title: "AML screening", recordLabel: "AML record", sampleFile: "AML.json", urlVar: "AML_API_URL", badge: "POSSIBLE MATCH" },
  pep: { title: "PEP check", recordLabel: "PEP record", sampleFile: "PEP.json", urlVar: "PEP_API_URL", badge: "POSSIBLE PEP MATCH" },
};

/** Triggered / Passed / Skipped-or-disabled, as the stat tiles show them */
export function ruleCounts(data: Evaluation) {
  const results = data.rule_results || [];
  const trig = results.filter((r) => r.triggered).length;
  const disabled = results.filter((r) => r.enabled === false).length;
  return { trig, pass: Math.max(0, results.length - trig - disabled), skip: disabled + (data.skipped_rules || []).length };
}

/** a rule result row: its class, the result word and its class */
export function ruleRow(r: RuleResult) {
  if (r.enabled === false) return { cls: "s-disabled", resCls: "disabled", resTxt: "Disabled" };
  if (r.triggered) return { cls: "s-triggered sev-" + (r.severity || "").toLowerCase(), resCls: "triggered", resTxt: "Triggered" };
  return { cls: "", resCls: "passed", resTxt: "Passed" };
}

/** the strong-match count on a screening tab (0 when not run or failed) */
export function screenCount(data: Screening | null | undefined): number {
  if (!data || data.error) return 0;
  return (data.strong_matches || []).length;
}

// Score as a semicircle gauge. Higher match = higher risk: green below (threshold - 20), yellow up to the
// threshold, red at or above it.
export const GAUGE_YELLOW_BAND = 20;

export function gaugeColour(p: number, t: number) {
  return p >= t ? "g-red" : p >= Math.max(0, t - GAUGE_YELLOW_BAND) ? "g-yellow" : "g-green";
}

/** 0% = left end, 100% = right end of the semicircle (centre 50,50) */
export function gaugePoint(pct: number, r: number): [string, string] {
  const a = (Math.PI * pct) / 100;
  return [(50 - r * Math.cos(a)).toFixed(2), (50 - r * Math.sin(a)).toFixed(2)];
}

export function threshold(t: unknown): number {
  const n = Number(t);
  return isNaN(n) ? 70 : n;
}

/** only real http(s) links become clickable */
export function linkHost(u: string): string | null {
  if (!/^https?:\/\//i.test(u)) return null;
  try { return new URL(u).hostname; } catch { return u; }
}

export const plural = (n: number) => (n === 1 ? "" : "s");
