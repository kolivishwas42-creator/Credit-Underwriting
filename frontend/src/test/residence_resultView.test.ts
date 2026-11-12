import { orderRules, recommendationTone, toPoints, toResultPage } from "../agents/residence_office_verification/utils/resultView";

const RESULT = {
  result_id: 41,
  overall_recommendation: "Refer",
  overall_criticality: "HIGH",
  rules_evaluated: 4,
  rules_triggered: 2,
  summary: "Address not confirmed by the neighbour. Name plate missing.",
  vendor: { name: "Manual Vendor Entry", status: "Negative", final_status: "Refer" },
  rules: [
    { rule_key: "RULE_01", rule_id: "R01", rule_name: "Address confirmed", triggered: false, status: "PASS", criticality: "HIGH", weight: 10 },
    { rule_key: "RULE_02", rule_id: "R02", rule_name: "Neighbour check", triggered: true, status: "FAIL", criticality: "HIGH", finding: "Neighbour did not confirm", weight: 8 },
    { rule_key: "RULE_03", rule_id: "R03", rule_name: "Name plate", triggered: true, status: "FAIL", criticality: "LOW", weight: 2 },
    { rule_key: "RULE_10", rule_id: "R10", rule_name: "Roll-up", triggered: true, status: "FAIL", criticality: "HIGH" },
  ],
};
const FORM = {
  application_id: 2, participant_id: 7, verification_type: "RESIDENCE", vendor_name: "Manual Vendor Entry",
  vendor_response: { status: "Negative", final_status: "Refer", neighbour_check: "No", corrected_address: "" },
};

describe("residence / office result adapter", () => {
  it("maps the run onto the common layout", () => {
    const page = toResultPage(RESULT, FORM, "");
    expect(page.basic.decision).toEqual({ label: "Refer", tone: "review" });
    expect(page.basic.facts?.find((f) => f.label === "Participant")?.value).toBe(7);
    expect(page.basic.kpis?.map((k) => k.value)).toEqual([4, 1, 1, 1]);
    expect(page.summary?.source).toBe("Rules summary");
    expect(page.summary?.points).toEqual(["Address not confirmed by the neighbour.", "Name plate missing."]);
    expect(page.rules?.rules.map((r) => [r.id, r.outcome])).toEqual([["R02", "fail"], ["R03", "review"], ["R01", "pass"]]);
    expect(page.calculations?.rows.find((r) => r.label === "Neighbour check")?.value).toBe("No");
    expect(page.calculations?.rows.some((r) => r.label === "Corrected address")).toBe(false);
  });

  it("prefers the AI summary when there is one", () => {
    const page = toResultPage(RESULT, FORM, "Risky area.\nNeighbour unsure.");
    expect(page.summary?.source).toBe("AI summary");
    expect(page.summary?.points).toEqual(["Risky area.", "Neighbour unsure."]);
  });

  it("orders, tones and splits", () => {
    expect(orderRules(RESULT.rules).map((r) => r.rule_key)).toEqual(["RULE_02", "RULE_03", "RULE_01"]);
    expect(recommendationTone("Approved")).toBe("pass");
    expect(recommendationTone("Rejected")).toBe("fail");
    expect(toPoints("• one thing\n- another")).toEqual(["one thing", "another"]);
  });
});
