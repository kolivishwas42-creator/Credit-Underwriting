import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { OUTGOING, VENDOR_FIELDS } from "../config/forms";
import type { Application, RuleConfig, ValuationResult } from "../types";
import { assess, buildComparisonRows, collectVendor, prefillOutgoing, severityBand } from "../utils/result";
import { statusTone, toResultPage } from "../utils/resultView";

// Synthetic answers in the API's shape; no real person.
const application: Application = {
  application_number: "APP-TEST-0001", applicant_name: "Test Applicant",
  properties: [
    { collateral_property_id: 11, property_owner: "Test Owner", property_type: "Residential", city: "Testpur", state: "Test State",
      pincode: "100001", vendor_request_prefill: { "Applicant Name": "Test Applicant", "Property Documents Provided": "No",
                                                   "Approved Map": true, City: "Testpur" } },
    { collateral_property_id: 12, collateral_type: "Shop", city: "Testpur" },
  ],
};
const outcome: ValuationResult = {
  result_id: 5, verification_id: 9, vendor_status: "Positive",
  summary: { agent_status: "HIGH_RISK", total_rules_checked: 3, total_rules_triggered: 2, total_rules_passed: 1,
             recommended_actions: ["Re-inspect the property"] },
  evaluation: { results: [
    { rule_id: "RULE_3", rule_number: 3, rule_name: "Area tolerance", severity: "MINOR", triggered: true, issue: "Area differs",
      discrepancies: [{ field: "Built up Area", applicant_value: 1000, source_value: 1200, reason: "20% over" }] },
    { rule_id: "RULE_1", rule_number: 1, rule_name: "Registration", severity: "MAJOR", triggered: false },
    { rule_id: "RULE_2", rule_number: 2, rule_name: "Owner name", severity: "CRITICAL", triggered: true,
      issue: "Owner differs", recommended_action: "Collect the sale deed",
      discrepancies: [{ field: "Owner", applicant_value: "Test Owner", source_value: "Other Owner" },
                      { field: "Owner", applicant_value: "Test Owner", source_value: "Other Owner" }] },
  ] },
};
const rules: RuleConfig[] = [
  { rule_key: "RULE_2", original_id: "PROP-013", name: "Owner Name Consistency", description: "Owner match", enabled: true,
    sequence: 2, severity: "CRITICAL", fields: { owner: "Owner" }, settings: { min: 80 } },
];

const calls: { url: string; init?: RequestInit }[] = [];
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith("/health")) return json({ status: "ok" });
    if (url.endsWith("/valuation")) return json(outcome);
    if (url.endsWith("/history")) return json({ verifications: [{ verification_id: 9, collateral_property_id: 11, verification_type: "INITIAL_VISIT", vendor_status: "Positive", created_at: "2026-11-07" }],
                                                agent_results: [{ result_id: 5, collateral_property_id: 11, agent_status: "HIGH_RISK", total_rules_triggered: 2, critical_issues_count: 1 }] });
    if (url.endsWith("/applications/APP-TEST-0001")) return json(application);
    if (url.includes("/rules/")) return json(rules[0]);
    if (url.endsWith("/rules")) return json(rules);
    return json({ detail: "Application not found" }, 404);
  }));
});
afterEach(() => vi.unstubAllGlobals());

async function fetchApp() {
  render(<App />);
  fireEvent.change(screen.getByLabelText("Application Number", { selector: "#appNo" }), { target: { value: "APP-TEST-0001" } });
  fireEvent.click(screen.getByRole("button", { name: "Fetch application" }));
  await screen.findByText("Selected property");
}

describe("the screen", () => {
  it("says nothing about the API when it is up, and loads an application with its first property selected", async () => {
    await fetchApp();
    expect(screen.queryByText("Connected")).toBeNull();                       // no backend words on the screen
    expect(screen.queryByText("Service not available right now")).toBeNull();
    expect(document.getElementById("appMessage")).toHaveTextContent("Applicant: Test Applicant · 2 linked property record(s)");
    expect(screen.getByRole("button", { name: "Property 11 · Residential" })).toHaveClass("active");
    expect(screen.getByText("Test Owner · Residential · Testpur · Test State · 100001")).toBeInTheDocument();
    expect((screen.getByLabelText("Applicant Name") as HTMLInputElement).value).toBe("Test Applicant");
    expect((screen.getByLabelText("Property Documents Provided") as HTMLSelectElement).value).toBe("No");
    fireEvent.click(screen.getByRole("button", { name: "Property 12 · Shop" }));
    expect(screen.getByText("Property ID 12")).toBeInTheDocument();
  });

  it("needs the Final Status, then saves the vendor response and shows the assessment", async () => {
    await fetchApp();
    const run = screen.getByRole("button", { name: "Save vendor response & run agent" });
    fireEvent.click(run);
    expect(screen.getByRole("status")).toHaveTextContent("Select the vendor Final Status.");
    fireEvent.change(screen.getByLabelText("Final Status / Status"), { target: { value: "Positive" } });
    fireEvent.change(screen.getByLabelText("Remarks"), { target: { value: "  fine  " } });
    fireEvent.click(screen.getByLabelText("Demarcation"));
    fireEvent.click(run);
    const card = await screen.findByRole("region", { name: "Summary card" });
    expect(within(card).getByText("HIGH RISK")).toHaveClass("cu-r-decision", "is-fail");
    expect(within(card).getByRole("heading", { name: "Test Applicant" })).toBeInTheDocument();
    expect(screen.getByText("Critical valuation issue detected.")).toBeInTheDocument();
    expect(screen.getByText("1 critical, 0 medium and 1 low severity rule(s) triggered. Review the highlighted findings before proceeding.")).toBeInTheDocument();
    const rules = document.querySelectorAll(".cu-r-rule");
    expect(Array.from(rules).map((r) => r.querySelector(".cu-r-rule-text b")!.textContent)).toEqual(["Owner name", "Area tolerance", "Registration"]);
    expect(rules[0]).toHaveClass("is-fail");
    fireEvent.click(within(rules[0] as HTMLElement).getByRole("button"));
    expect(within(rules[0] as HTMLElement).getByText("Collect the sale deed")).toBeInTheDocument();
    const side = screen.getByRole("region", { name: "Side-by-side comparison" });
    expect(within(side).getByText("1200")).toBeInTheDocument();
    expect(document.getElementById("toast")).toHaveTextContent("Vendor response and agent result saved.");
    const post = calls.find((c) => c.url.endsWith("/valuation"))!;
    expect(post.url).toBe("/api/v1/credit/property-valuation/applications/APP-TEST-0001/properties/11/valuation");
    const body = JSON.parse(String(post.init!.body));
    expect(body).toMatchObject({ collateral_property_id: 11, vendor_name: "Manual Vendor Entry", verification_type: "INITIAL_VISIT" });
    expect(body.vendor_response).toMatchObject({ "Final Status": "Positive", Remarks: "fine", Demarcation: true, "Land Rate": "" });
    expect(body.submitted_data).toMatchObject({ "Approved Map": true, "Copy Of Latest Deed provided": false, City: "Testpur" });
  });

  it("shows a fetch error", async () => {
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText("e.g. LOS-DUMMY-0008"), { target: { value: "NOPE" } });
    fireEvent.keyDown(screen.getByPlaceholderText("e.g. LOS-DUMMY-0008"), { key: "Enter" });
    expect(await screen.findByText("Application not found")).toBeInTheDocument();
  });

  it("loads the rules when the tab opens and saves one", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Rule configuration" }));
    expect(await screen.findByText("RULE_2 · Owner Name Consistency")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Order"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("RULE_2 saved to database.")).toBeInTheDocument();
    const put = calls.find((c) => c.init?.method === "PUT")!;
    expect(JSON.parse(String(put.init!.body))).toEqual({ enabled: true, severity: "CRITICAL", sequence: 4,
                                                         settings: { min: 80 }, fields: { owner: "Owner" } });
  });

  it("loads the history", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "History & analytics" }));
    fireEvent.change(screen.getByPlaceholderText("Enter application number"), { target: { value: "APP-TEST-0001" } });
    fireEvent.click(screen.getByRole("button", { name: "Load history" }));
    expect(await screen.findByText("Vendor visits (1)")).toBeInTheDocument();
    const table = screen.getByText("Agent result history (1)").nextElementSibling as HTMLElement;
    expect(within(table).getByText("HIGH_RISK")).toHaveClass("status", "HIGH_RISK");
  });
});

describe("the logic", () => {
  it("bands severities", () => {
    expect(["HIGH", "critical", "MAJOR", "medium", "MINOR", "", null].map(severityBand))
      .toEqual(["CRITICAL", "CRITICAL", "MEDIUM", "MEDIUM", "LOW", "LOW", "LOW"]);
  });

  it("keeps each side-by-side row once and only from triggered rules", () => {
    const rows = buildComparisonRows(outcome.evaluation!.results!);
    expect(rows).toEqual([
      { field: "Built up Area", los: "1000", vendor: "1200", reason: "20% over", severity: "LOW" },
      { field: "Owner", los: "Test Owner", vendor: "Other Owner", reason: "Owner differs", severity: "CRITICAL" },
    ]);
  });

  it("assesses a clear result", () => {
    const a = assess({ summary: { agent_status: "clear" }, evaluation: { results: [{ triggered: false }] } });
    expect([a.status, a.bannerClass, a.icon, a.checked, a.passedCount]).toEqual(["CLEAR", "CLEAR", "✓", 1, 1]);
    expect(a.bannerText).toBe("All executed rules passed. No discrepancies were identified by the configured rules.");
  });

  it("puts the assessment into the common result layout", () => {
    const page = toResultPage(outcome, {
      application, property: application.properties[0],
      vendorResponse: { "Current Market Value": "4500000", "Land Rate": "", Demarcation: true },
      figureFields: VENDOR_FIELDS.filter((f) => f.kind === "number"),
    });
    expect(page.basic.title).toBe("Test Applicant");
    expect(page.basic.subtitle).toBe("Test Owner · Residential · Testpur · Test State · 100001");
    expect(page.basic.decision).toEqual({ label: "HIGH RISK", tone: "fail" });
    expect(page.basic.facts!.map((f) => f.value)).toEqual(["APP-TEST-0001", "11", "Positive"]);   // no result / verification numbers
    expect(page.basic.kpis!.map((k) => k.value)).toEqual([3, 1, 2, 1, 0, 1]);
    expect(page.rules!.rules.map((r) => [r.id, r.outcome, r.outcomeLabel, r.severity])).toEqual([
      ["RULE_2", "fail", "Triggered", "Critical"], ["RULE_3", "review", "Triggered", "Low"], ["RULE_1", "pass", "Passed", undefined],
    ]);
    expect(page.rules!.rules[0].values!.map((v) => v.label)).toEqual(["Recommended action"]);
    expect(page.rules!.rules[0].table!.columns.slice(0, 3)).toEqual(["Field", "Application value", "Vendor value"]);
    expect(page.rules!.rules[0].table!.rows.map((r) => r[0])).toEqual(["Owner", "Owner"]);
    expect(page.rules!.rules[2].table).toBeUndefined();
    expect(page.summary!.points).toContain("Recommended: Re-inspect the property");
    expect(page.calculations!.rows).toEqual([
      { group: "LOS vs vendor", label: "Owner", value: "Other Owner", hint: "LOS Test Owner", mono: true, tone: "fail" },
      { group: "LOS vs vendor", label: "Built up Area", value: "1200", hint: "LOS 1000", mono: true, tone: "review" },
      { group: "Vendor valuation (as submitted)", label: "Current Market Value (₹)", value: "4500000", mono: true },
    ]);
    expect(page.actions!.every((a) => !a.onClick)).toBe(true);
    expect(["CLEAR", "REVIEW", "HIGH_RISK"].map(statusTone)).toEqual(["pass", "review", "fail"]);
    expect(toResultPage({ result_id: 1 }).basic.title).toBe("Result #1");
  });

  it("prefills and collects the forms", () => {
    const v = prefillOutgoing(OUTGOING, { "Approved Map": 1, City: "X" });
    expect([v["Approved Map"], v.City, v["Property Documents Provided"], v.Landmark]).toEqual([true, "X", "Yes", ""]);
    expect(collectVendor({ a: " x ", b: true })).toEqual({ a: "x", b: true });
  });
});
