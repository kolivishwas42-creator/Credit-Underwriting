// The adapter from the dedupe view (core viewResult / allView) to the common result layout. Pure: no DOM.
import { describe, expect, it, vi } from "vitest";
import * as C from "../core";
import type { AllView, DedupeView } from "../types";
import { businessRules, historyRules, toAllResultPage, toResultPage, toTone } from "../utils/resultView";
import uiText from "../../../../public/dedupe/ui_text.json";
import REAL from "./fixtures/dedupe_existing_complete.json";

const view = () => C.viewResult(REAL as Parameters<typeof C.viewResult>[0], uiText) as DedupeView;

describe("toTone", () => {
  it("maps the agent's tones to the layout's", () => {
    expect(["ok", "pass", "bad", "fail", "warn", "skip", "partial", "brand", "na", undefined].map(toTone))
      .toEqual(["pass", "pass", "fail", "fail", "review", "review", "review", "info", "na", "na"]);
  });
});

describe("toResultPage", () => {
  it("fills the four sections from the real answer", () => {
    const v = view();
    const p = toResultPage(v, { text: uiText, entered: { name: "Asha Kulkarni" } });
    // 1. basic card: the applicant, the dedupe status as the decision, the case and request
    expect(p.basic.title).toBe("Asha Kulkarni");
    const head = v.dedupe ? v.dedupe.label : (v.headline || v.outcomeView).title;
    expect(p.basic.decision?.label).toBe(head);
    const facts = Object.fromEntries((p.basic.facts || []).map((f) => [f.label, f.value]));
    expect(facts["Case ID"]).toBe(REAL.case_id);
    expect(facts.Request).toBe(REAL.request_id);
    expect(p.basic.kpis?.map((k) => k.label)).toEqual(["Previous loans", "Rules found", "Not fully checked", "Rules clear"]);
    // 2. summary: the officer note + the reason points, never empty when the answer has words
    expect(p.summary?.points.length).toBeGreaterThan(0);
    // 3a. rules: R01-R11 and the loan-history checks, red before amber before green
    expect(p.rules?.rules).toHaveLength(v.business.length + v.rules.length);
    const order = { fail: 0, review: 1, info: 2, pass: 3, na: 4 } as const;
    const biz = p.rules!.rules.slice(0, v.business.length).map((r) => order[r.outcome]);
    expect(biz).toEqual([...biz].sort((a, b) => a - b));
    // 3b. calculations: match, loans, checks, sources, policy
    const groups = new Set(p.calculations?.rows.map((r) => r.group));
    for (const g of ["Match", "Existing loans", "Checks", "Policy"]) expect(groups.has(g)).toBe(true);
    if (v.sources.length) expect(groups.has("Sources")).toBe(true);
    // 4. actions: presentational, except the page's own re-run
    expect(p.actions?.map((a) => a.id)).toEqual(["report", "hold", "decline", "submit"]);
    expect(p.actions?.every((a) => !a.onClick)).toBe(true);
  });

  it("wires Run check again only to the page's own handler", () => {
    const onRerun = vi.fn();
    const p = toResultPage(view(), { text: uiText, onRerun });
    const rerun = p.actions!.find((a) => a.id === "rerun")!;
    rerun.onClick!();
    expect(onRerun).toHaveBeenCalledOnce();
  });

  it("falls back to the case when no name was entered, and never shows a full PAN", () => {
    const p = toResultPage(view(), { text: uiText });
    expect(p.basic.title).toBe(`Case ${REAL.case_id}`);
    expect(JSON.stringify(p, (_k, val) => (typeof val === "function" ? undefined : val))).not.toMatch(/\b[A-Z]{5}\d{4}[A-Z]\b/);
  });

  it("rule rows carry the agent's own words and tones", () => {
    const b = businessRules([{ id: "R01", name: "Same PAN", what: "PAN on other cases", tone: "partial", status: "Partly checked",
      reason: "One source did not answer.", next: ["Re-run later"], via: ["PAN"] }]);
    expect(b[0]).toMatchObject({ id: "R01", outcome: "review", outcomeLabel: "Partly checked", detail: "One source did not answer." });
    expect(b[0].values?.map((x) => x.label)).toEqual(["What it checks", "Next", "Found via"]);
    const h = historyRules(view());
    expect(h.every((r) => ["pass", "fail", "review", "na", "info"].includes(r.outcome))).toBe(true);
  });
});

describe("toAllResultPage", () => {
  it("one decision, a row per parameter, what was not checked", () => {
    const v = view();
    const a: AllView = {
      requestId: "ddp_all_1", checked: ["PAN"], missing: ["Mobile"],
      rows: [{ parameter: "PAN", label: "PAN", value: "ABCDE****F", from: "Case", match: "Confirmed", matchCode: "CONFIRMED_MATCH",
        customer: "C-1", decision: "Existing customer", tone: "ok", found: [], findings: [], view: v }],
      consistency: { status: "CONSISTENT", tone: "ok", text: "All identifiers point to one customer.", byParameter: [] },
      combined: { code: "EXISTING", label: "Existing customer", tone: "ok", reasons: ["Same customer on PAN."] },
      business: [],
    };
    const p = toAllResultPage(a, { text: uiText });
    expect(p.basic.decision).toEqual({ label: "Existing customer", tone: "pass" });
    expect(p.summary?.points).toEqual(["All identifiers point to one customer.", "Same customer on PAN."]);
    expect(p.calculations?.rows.map((r) => [r.label, r.tone])).toEqual([["PAN", "pass"], ["Mobile", "na"]]);
    expect(p.basic.facts?.find((f) => f.label === "Request")?.value).toBe("ddp_all_1");
  });
});
