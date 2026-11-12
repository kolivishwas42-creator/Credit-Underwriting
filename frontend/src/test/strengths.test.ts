import { describe, expect, it } from "vitest";
import { concernProof, strengthProof, usefulStrengths } from "../shared/components/result/ResultPage";
import type { RuleRow } from "../shared/components/result/types";

// owner 2026-11-12: "strength me jo dikha rahe ho, woh useful hona chahiye" -- a strength shows its proof
const rule = (id: string, name: string, extra: Partial<RuleRow> = {}): RuleRow => ({ id, name, outcome: "pass", ...extra });

describe("useful strengths", () => {
  it("shows the two compared values as the proof", () => {
    const r = rule("R1", "FOIR within policy", { detail: "Passed", values: [{ label: "Value", value: "42%" }, { label: "Limit", value: "60%" }] });
    expect(strengthProof(r)).toBe("Actual 42% · Policy limit 60%");
  });
  it("uses the reason line when it says more than 'passed'", () => {
    expect(strengthProof(rule("R2", "Name match", { detail: "Account holder name matches the PAN name." })))
      .toBe("Account holder name matches the PAN name.");
  });
  it("has no proof when the rule only says it passed", () => {
    expect(strengthProof(rule("R3", "PAN format", { detail: "Passed." }))).toBe("");
    expect(strengthProof(rule("R4", "Bureau check", { detail: "Bureau check" }))).toBe("");
  });
  it("lists proof with numbers first, at most four; the rest are only counted", () => {
    const passed = [
      rule("A", "Name match", { detail: "Name on the statement matches the application." }),
      rule("B", "PAN format", { detail: "Passed" }),
      rule("C", "Salary credits", { detail: "6 salary credits of ₹95,000 found." }),
      rule("D", "Bounces", { values: [{ label: "Bounces in 6 months", value: "0 of 3 allowed" }] }),
      rule("E", "Account type", { detail: "Savings account, as declared." }),
      rule("F", "Statement period", { detail: "Covers 6 months." }),
    ];
    const { listed, rest } = usefulStrengths(passed);
    expect(listed.map((s) => s.rule.id)).toEqual(["C", "D", "F", "A"]);
    expect(rest.map((r) => r.id)).toEqual(["B", "E"]);
  });
});

// owner 2026-11-12: "concerns me bhi aisa hi proof dikhao"
describe("concern proof", () => {
  it("shows the values compared, then the reason", () => {
    const r = rule("C1", "FOIR within policy", { outcome: "fail", detail: "EMIs take too much of the income.",
      values: [{ label: "Value", value: "72%" }, { label: "Limit", value: "60%" }] });
    expect(concernProof(r)).toEqual({ proof: "Actual 72% · Policy limit 60%", why: "EMIs take too much of the income." });
  });
  it("drops a reason that only repeats the outcome", () => {
    const r = rule("C2", "Bounces", { outcome: "fail", detail: "Failed", values: [{ label: "Bounces in 6 months", value: "4" }] });
    expect(concernProof(r)).toEqual({ proof: "Bounces in 6 months: 4", why: "" });
  });
});
