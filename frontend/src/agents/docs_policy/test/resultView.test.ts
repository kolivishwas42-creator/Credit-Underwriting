// The adapter from the readiness board to the common result layout. Pure: no DOM.
import { describe, expect, it, vi } from "vitest";
import type { Board } from "../types";
import { boardCounts, policyRules, sentences, toResultPage, toTone } from "../utils/resultView";
import fixtures from "./fixtures.json";

const board = () => JSON.parse(JSON.stringify(fixtures.board)) as Board;

describe("toResultPage", () => {
  it("basic card: the applicant, the route as the decision, the counts as kpis", () => {
    const p = toResultPage(board(), { checkedAt: null });
    expect(p.basic.title).toBe("Asha Kulkarni");
    expect(p.basic.subtitle).toBe("& Vikram Kulkarni · Home loan · CREDIT");
    expect(p.basic.decision).toEqual({ label: "Refer to higher authority", tone: "fail" });
    expect(p.basic.kpis).toEqual([
      { label: "Critical", value: 2, tone: "fail" }, { label: "Approval", value: 1, tone: "review" },
      { label: "To collect", value: 2, tone: "review" }, { label: "Verified", value: 3, tone: "pass" },
    ]);
    const facts = Object.fromEntries(p.basic.facts!.map((f) => [f.label, f.value]));
    expect(facts).toMatchObject({ "Case ID": "CASE-D0C500000003", "Loan amount": "₹25,00,000", Underwriting: "Not yet", Checked: "—" });
  });

  it("summary: the brief's note as points, the route, the next step and the authority", () => {
    const b = board();
    const p = toResultPage(b);
    expect(p.summary?.source).toBe("AI summary");
    expect(p.summary?.points).toEqual([
      ...sentences(b.answer.summary.ai_summary.text), b.answer.summary.route.text,
      `Next step: ${b.answer.summary.next_step}`, "Higher authority: ACM",
    ]);
    b.answer.summary.ai_summary.source = "rules";
    b.answer.summary.route.decision = "MOVE_AHEAD";
    const q = toResultPage(b);
    expect(q.summary?.source).toBe("Rules summary");
    expect(q.summary?.points.some((x) => x.startsWith("Higher authority"))).toBe(false);
    expect(q.basic.decision?.tone).toBe("pass");
  });

  it("rules: the eleven policy rules, the desk's words, tones mapped", () => {
    const rules = policyRules(board());
    expect(rules.map((r) => r.id)).toEqual(Array.from({ length: 11 }, (_, i) => `RULE-${String(i + 1).padStart(2, "0")}`));
    const by = Object.fromEntries(rules.map((r) => [r.id, r]));
    expect(by["RULE-01"]).toMatchObject({ outcome: "pass", outcomeLabel: "Pass" });
    expect(by["RULE-02"]).toMatchObject({ outcome: "fail", outcomeLabel: "Critical", detail: "2 of 3 checks passed" });
    expect(by["RULE-06"]).toMatchObject({ outcome: "review", outcomeLabel: "To collect" });
    expect(by["RULE-04"].outcome).toBe("na");
    expect(by["RULE-02"].values?.some((v) => v.label === "Open")).toBe(true);
  });

  it("calculations: documents per person, per status, rules per status", () => {
    const rows = toResultPage(board()).calculations!.rows;
    const groups = [...new Set(rows.map((r) => r.group))];
    expect(groups).toEqual(["Applicant · Asha Kulkarni", "Co-applicant · Vikram Kulkarni", "All documents", "Rules"]);
    const all = rows.filter((r) => r.group === "All documents").map((r) => [r.label, r.value]);
    expect(all).toEqual([["Critical", 2], ["Approval", 1], ["To collect", 2], ["Verified", 3], ["Total", 8]]);
    const rules = Object.fromEntries(rows.filter((r) => r.group === "Rules").map((r) => [r.label, r.value]));
    expect(rules).toEqual({ Pass: 4, "To collect": 2, Critical: 3, "Not applicable": 2 });
  });

  it("actions: only the desk's own handlers are wired", () => {
    const onRecheck = vi.fn();
    const p = toResultPage(board(), { onRecheck });
    const wired = p.actions!.filter((a) => a.onClick).map((a) => a.id);
    expect(wired).toEqual(["recheck"]);
    expect(p.actions!.some((a) => /copy/i.test(a.label))).toBe(false);   // no copy buttons
    p.actions!.find((a) => a.id === "recheck")!.onClick!();
    expect(onRecheck).toHaveBeenCalledOnce();
    expect(toResultPage(board()).actions!.every((a) => !a.onClick)).toBe(true);
  });

  it("counts and tones", () => {
    expect(boardCounts(board()).map(([f]) => f)).toEqual(["bad", "approval", "warn", "ok"]);
    expect(["ok", "warn", "bad", "na", "approval", undefined].map(toTone)).toEqual(["pass", "review", "fail", "na", "review", "na"]);
  });
});
