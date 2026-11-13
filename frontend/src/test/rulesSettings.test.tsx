import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RULES_SETTINGS_VISIBLE, RULES_SOURCES } from "../config/rulesSettings";
import { AiSummary, ruleOfPoint } from "../shared/components/result/ResultPage";
import { Home } from "../shared/components/Home";
import { RulesSettings } from "../shared/components/RulesSettings";
import { baseOf, saveBody, savePath, toView } from "../shared/rules/rulesApi";

// owner 2026-11-12 / 13: rules on / off and editable for every agent -- its OWN section of the Overview, apart from
// the agents
describe("rules settings", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is on, and every agent of the console has its rules there (11)", () => {
    expect(RULES_SETTINGS_VISIBLE).toBe(true);
    expect(Object.keys(RULES_SOURCES).sort()).toEqual(["bank_verification", "collateral_verification", "crime_verification",
      "dedupe", "docs_policy", "eligibility", "fraud_screening", "itr_verification", "legal_verification",
      "property_valuation", "residence_office_verification"]);
  });

  it("the Overview has a Rules settings tab; it lists the agents by stage and opens one's rules", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(String(url).includes("/custom/")
      ? { rules: [{ id: "C_HIGH_FOIR", name: "FOIR above 55%", enabled: true, severity: "HIGH",
          params: { field: "FOIR", operator: "gt", value: 55, outcome: "review" } }] }
      : { rules: [{ id: "AGE", name: "Age limits", enabled: true, locked: false, params: { min_age: 21 } }], templates: {} }), { status: 200 })));
    const onView = vi.fn();
    const { rerender } = render(<Home onOpen={() => {}} view="agents" onView={onView} />);
    fireEvent.click(screen.getByRole("tab", { name: "Rules settings" }));
    expect(onView).toHaveBeenCalledWith("rules");
    rerender(<Home onOpen={() => {}} view="rules" onView={onView} />);
    const list = screen.getByRole("navigation", { name: "Agents" });
    expect(list.querySelectorAll(".cu-rules-agent")).toHaveLength(11);
    fireEvent.click(screen.getByRole("button", { name: "Eligibility" }));
    expect(await screen.findByText("Age limits")).toBeInTheDocument();
    // every agent: its custom rules under its own, with Add custom rule
    expect(await screen.findByText("FOIR above 55%")).toBeInTheDocument();
    expect(screen.getByText("When FOIR is greater than 55 → Review")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Add custom rule" })).toBeInTheDocument();
  });

  it("rule store sets: one set per group in the path, only changed numbers sent", () => {
    const src = RULES_SOURCES.dedupe;
    expect(baseOf(src, "customer_history_policy")).toBe("/api/v1/rule-settings/customer_history_policy");
    expect(baseOf(RULES_SOURCES.docs_policy, "home_loan.credit.json")).toBe("/api/v1/rule-settings/docs_policy%3Ahome_loan.credit.json".replace("%3A", ":"));
    const rule = toView(RULES_SOURCES.eligibility, { id: "AGE", name: "AGE", enabled: true, locked: false,
      params: { min_age: 21, max_age: 65 } });
    expect(saveBody(RULES_SOURCES.eligibility, rule, { numbers: { "params.max_age": 60 } }))
      .toEqual({ id: "AGE", params: { max_age: 60 } });
    expect(savePath(RULES_SOURCES.eligibility, rule)).toBe("/rules/AGE");
  });

  it("shows a locked rule as Always on and adds a rule from a template", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const reply = { rules: [
      { id: "P05_DUPLICATE_WINDOW", name: "Same product again soon", enabled: true, locked: false, params: { threshold: 720 } },
      { id: "R10", name: "Overall", enabled: true, locked: true, params: {} }],
      templates: { threshold_rule: { title: "t", fields: ["rule_id", "description", "signal", "operator", "threshold"],
        signals: ["history.active_loans"], operators: ["gt"], severities: [] } }, on_label: null };
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(init?.method === "POST" ? { added: "P20_X" } : reply), { status: 200 });
    }));
    render(<RulesSettings agent="dedupe" />);
    const locked = await screen.findByRole("switch", { name: /Overall: Always on/ });
    expect(locked).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "+ Add rule" }));
    const form = screen.getByRole("form", { name: "Add a rule" });
    const inputs = form.querySelectorAll("input, select");
    fireEvent.change(inputs[0], { target: { value: "P20_X" } });
    fireEvent.change(inputs[1], { target: { value: "Many live loans" } });
    fireEvent.change(inputs[2], { target: { value: "history.active_loans" } });
    fireEvent.change(inputs[3], { target: { value: "gt" } });
    fireEvent.change(inputs[4], { target: { value: "3" } });
    fireEvent.submit(form);
    await waitFor(() => expect(calls.some((c) => c.init?.method === "POST")).toBe(true));
    const post = calls.find((c) => c.init?.method === "POST")!;
    expect(post.url).toBe("/api/v1/rule-settings/dedupe_policy/rules");
    expect(JSON.parse(String(post.init!.body))).toEqual({ template: "threshold_rule", values: {
      rule_id: "P20_X", description: "Many live loans", signal: "history.active_loans", operator: "gt", threshold: 3 } });
  });

  it("ITR: on / off and a tolerance go back with the rule's key fields", () => {
    const src = RULES_SOURCES.itr_verification;
    const rule = toView(src, { category: "income", field: "gross_total_income", enabled: true, tolerance_pct: 5, weight: 1, severity: "HIGH", label: "Gross total income" });
    expect(rule.name).toBe("Gross total income");
    expect(rule.numbers.map((n) => n.id)).toEqual(["tolerance_pct", "weight"]);
    expect(saveBody(src, rule, { enabled: false, numbers: { tolerance_pct: 3 } }))
      .toEqual({ category: "income", field: "gross_total_income", enabled: false, tolerance_pct: 3 });
    expect(savePath(src, rule)).toBe("/rules");
  });

  it("Fraud: the rule key goes in the path and a setting is merged into config_json", () => {
    const src = RULES_SOURCES.fraud_screening;
    const rule = toView(src, { rule_key: "R7_DPD", rule_id: "R7", rule_name: "dpd_limit", enabled: true, severity: "HIGH", config_json: { max_dpd: 30, window: "12m" } });
    expect(rule.numbers).toEqual([{ id: "config_json.max_dpd", label: "Max Dpd", value: 30 }]);
    expect(savePath(src, rule)).toBe("/rules/R7_DPD");
    expect(saveBody(src, rule, { numbers: { "config_json.max_dpd": 60 } }))
      .toEqual({ rule_key: "R7_DPD", config_json: { max_dpd: 60, window: "12m" } });
  });

  it("Residence / Office: saved inside its verification type", () => {
    const src = RULES_SOURCES.residence_office_verification;
    const rule = toView(src, { rule_key: "ADDRESS_MATCH", name: "Address match", enabled: true, criticality: "HIGH", weight: 10 });
    expect(saveBody(src, rule, { enabled: false }, "OFFICE"))
      .toEqual({ verification_type: "OFFICE", rules: [{ rule_key: "ADDRESS_MATCH", enabled: false }] });
  });
});

// owner 2026-11-12: Crime's "at a glance" indicator back, under the AI summary
describe("at a glance under the AI summary", () => {
  it("shows each person with their level in words", () => {
    render(<AiSummary points={["Two people checked."]} glanceTitle="At a glance" glance={[
      { id: "A", who: "Applicant", name: "Ravi Kumar", level: "Low risk", tone: "pass" },
      { id: "C1", who: "Co-Applicant 1", name: "Sita Devi", level: "High risk", tone: "fail" },
    ]} />);
    const row = screen.getByRole("group", { name: "At a glance" });
    expect(row).toHaveTextContent("Applicant");
    expect(row).toHaveTextContent("Low risk");
    expect(row).toHaveTextContent("High risk");
    expect(row.querySelector(".cu-r-glance-chip.is-fail")).not.toBeNull();
  });
});

// owner 2026-11-12 UI pass: a point about "Co-Applicant 1" links to that person, not to "Applicant"
describe("summary point -> rule", () => {
  it("prefers the rule whose whole name is in the point, the longest first", () => {
    const rules = [{ id: "P1", name: "Applicant", outcome: "pass" as const }, { id: "P2", name: "Co-Applicant 1", outcome: "pass" as const }];
    expect(ruleOfPoint("Co-Applicant 1 has low risk with one case found.", rules)?.id).toBe("P2");
    expect(ruleOfPoint("Applicant has low risk with one case found.", rules)?.id).toBe("P1");
  });
});

// the point names the person; rule ids "APPLICANT" / "CO_APPLICANT_1" must not pull "Co-Applicant 1" onto "Applicant"
describe("summary point -> rule, with role ids", () => {
  it("links a co-applicant point to the co-applicant even when the applicant's id is APPLICANT", () => {
    const rules = [{ id: "APPLICANT", name: "Applicant", outcome: "fail" as const }, { id: "CO_APPLICANT_1", name: "Co-Applicant 1", outcome: "fail" as const }];
    expect(ruleOfPoint("Co-Applicant 1 has a total of 4 cases found.", rules)?.id).toBe("CO_APPLICANT_1");
  });
});


// custom rules on a result page: fire on the named Calculations value, pass when not met, grey when missing
import { applyCustomRules, numberIn } from "../shared/rules/customRules";
describe("custom rules on a result", () => {
  const rule = (field: string, operator: string, value: number, outcome: "review" | "fail" = "review") =>
    ({ id: "C_X", name: "x", enabled: true, severity: "HIGH", params: { field, operator, value, outcome } });
  it("reads the number in a shown value", () => {
    expect(numberIn("62.4%")).toBe(62.4);
    expect(numberIn("₹1,20,000")).toBe(120000);
    expect(numberIn("—")).toBeNull();
  });
  it("fires, passes, or says not evaluated", () => {
    const calcs = [{ label: "FOIR", value: "62%" }, { label: "Cases found", value: 0 }];
    expect(applyCustomRules([rule("foir", "gt", 55)], calcs)[0].outcome).toBe("review");
    expect(applyCustomRules([rule("FOIR", "gt", 70, "fail")], calcs)[0].outcome).toBe("pass");
    expect(applyCustomRules([rule("Cases found", "ge", 1, "fail")], calcs)[0].outcome).toBe("pass");
    expect(applyCustomRules([rule("LTV", "gt", 80)], calcs)[0].outcome).toBe("na");
    expect(applyCustomRules([{ ...rule("FOIR", "gt", 55), enabled: false }], calcs)).toEqual([]);
  });
});
