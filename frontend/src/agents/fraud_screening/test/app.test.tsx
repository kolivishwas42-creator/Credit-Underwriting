import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import type { Evaluation, RuleConfig } from "../types";
import { riskTone, toResultPage } from "../utils/resultView";
import { gaugeColour, gaugePoint, ruleCounts, ruleRow, screenCount, threshold } from "../utils/screening";

// Synthetic answers in the API's documented shape (FraudEvaluateResponse / RuleConfigOut); no real person.
const rules: RuleConfig[] = [
  { rule_key: "R1", rule_id: "FR-001", rule_name: "Mobile shared with another application", severity: "HIGH", enabled: true, is_implementable: true },
  { rule_key: "R2", rule_id: "FR-002", rule_name: "Device fingerprint reuse", severity: "MEDIUM", enabled: false, is_implementable: false },
];
const record = (name: string, pct: number) => ({
  name, agency: "SAMPLE_AGENCY", list_type: "SANCTIONS_LIST", match_percent: pct, matched_fields: ["Name"], partial_fields: ["DOB"],
  comparison: [{ field: "Name", applicant: ["Test Applicant"], record: [name], status: "match" },
               { field: "DOB", applicant: ["1990-01-01"], record: ["1990"], status: "partial", note: "Year only" }],
  facts: [{ label: "Listed on", value: "2020-01-01" }], source_links: ["https://example.org/list/1", "javascript:alert(1)"],
});
const evaluation: Evaluation = {
  application_number: "APP-TEST-0001", application_id: 7, result_id: 42, risk_level: "HIGH", is_potential_fraud: true,
  fraud_warning: "One high severity rule triggered.", skipped_rules: ["R9"],
  rule_results: [
    { rule_key: "R1", rule: "FR-001", name: "Mobile shared", severity: "HIGH", triggered: true, enabled: true, message: "Shared with APP-TEST-0002" },
    { rule_key: "R3", rule: "FR-003", name: "Email domain", severity: "LOW", triggered: false, enabled: true, message: "" },
    { rule_key: "R2", rule: "FR-002", name: "Device reuse", severity: "MEDIUM", triggered: false, enabled: false },
  ],
  aml: { source: "mock", threshold_percent: 70, total_records: 3, summary: "1 record at or above 70%.", request_id: "req-1",
         strong_matches: [record("Sample Person A", 85)], other_matches: [record("Sample Person B", 40), record("Sample Person C", 20)] },
  pep: { error: "PEP vendor timed out" },
};

const calls: { url: string; init?: RequestInit }[] = [];
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
let patchStatus = 200;

beforeEach(() => {
  calls.length = 0;
  patchStatus = 200;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith("/rules")) return json(rules);
    if (init?.method === "PATCH") return patchStatus === 200 ? json(rules[0]) : json({ detail: "Rule is locked" }, patchStatus);
    if (url.endsWith("/fraud/evaluate")) {
      const body = JSON.parse(String(init?.body));
      return body.application_number === "APP-MISSING" ? json({ detail: "Application APP-MISSING not found" }, 404) : json(evaluation);
    }
    return json({}, 404);
  }));
  vi.stubGlobal("alert", vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

async function evaluate(num = "APP-TEST-0001") {
  render(<App />);
  fireEvent.change(screen.getByLabelText("Application number"), { target: { value: num } });
  fireEvent.click(screen.getByRole("button", { name: "Evaluate" }));
}

describe("the screen", () => {
  it("asks for an application number", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Evaluate" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter an application number.");
  });

  it("evaluates and shows the risk, counts and rule results", async () => {
    await evaluate();
    expect(await screen.findByText("One high severity rule triggered.")).toBeInTheDocument();
    const card = screen.getByRole("region", { name: "Summary card" });
    expect(within(card).getByText("HIGH risk")).toHaveClass("cu-r-decision", "is-fail");
    expect(within(card).getByText("APP-TEST-0001", { selector: "dd" })).toBeInTheDocument();
    expect(Array.from(card.querySelectorAll("dd")).map((d) => d.textContent)).toEqual(["APP-TEST-0001", "Yes"]);   // no internal ids
    expect(screen.queryByText("Done")).toBeNull();          // no "Done" after Evaluate
    // header: the common rule counts; the screen's own counters (triggered, skipped …) are Key figures
    expect(Array.from(card.querySelectorAll(".cu-r-kpi")).map((k) => k.textContent?.replace(/\d+/, ""))).toEqual(["Rules", "Passed", "Review", "Failed"]);
    const figures = screen.getByRole("region", { name: "Calculations" });
    expect(within(figures).getByText("Key figures")).toBeInTheDocument();
    // a rule is collapsed to its name: the message shows when it is clicked
    const row = screen.getByText("Mobile shared", { selector: ".cu-r-rule-text b" }).closest(".cu-r-rule")!;
    expect(within(row as HTMLElement).queryByText("Shared with APP-TEST-0002")).toBeNull();
    fireEvent.click(within(row as HTMLElement).getByRole("button", { name: /Mobile shared/ }));
    expect(within(row as HTMLElement).getByText("Shared with APP-TEST-0002")).toBeInTheDocument();
    expect(row).toHaveClass("is-fail");
    expect(within(row as HTMLElement).getByText("Triggered")).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText("High")).toBeInTheDocument();
    expect(JSON.parse(String(calls.find((c) => c.url.endsWith("/evaluate"))!.init!.body)))
      .toEqual({ application_number: "APP-TEST-0001", run_aml: true, run_pep: true });
  });

  it("shows the AML comparison one record per page and the PEP error", async () => {
    await evaluate();
    const amlTab = await screen.findByRole("tab", { name: /AML screening/ });
    expect(within(amlTab).getByText("1")).toHaveClass("cu-r-tab-count");
    fireEvent.click(amlTab);
    const pane = document.getElementById("tab-aml")!;
    expect(within(pane).getByText("POSSIBLE MATCH")).toBeInTheDocument();
    expect(within(pane).getByText(/AML_API_URL is not set/)).toBeInTheDocument();
    expect(within(pane).getByRole("img", { name: "Match score 85% (threshold 70%)" })).toBeInTheDocument();
    expect(within(pane).getAllByRole("link").map((a) => a.textContent)).toEqual(["example.org"]);
    expect(within(pane).queryAllByText("Sample Person C")).toHaveLength(0);
    // one record to a page: the lower-scoring records follow on the next pages
    expect(within(pane).getByText("1–1 of 3 records")).toBeInTheDocument();
    fireEvent.click(within(pane).getByRole("button", { name: "Next page" }));
    fireEvent.click(within(pane).getByRole("button", { name: "Next page" }));
    expect(within(pane).getAllByText("Sample Person C").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("tab", { name: /PEP check/ }));
    fireEvent.click(screen.getByRole("tab", { name: /AML screening/ }));
    expect(within(pane).getByText("3–3 of 3 records")).toBeInTheDocument();       // the page survives a tab switch
    expect(document.getElementById("tab-pep")).toHaveTextContent("PEP vendor timed out");
  });

  it("shows the server's error", async () => {
    await evaluate("APP-MISSING");
    expect(await screen.findByRole("alert")).toHaveTextContent("Application APP-MISSING not found");
  });

  it("toggles a rule and puts it back when the save fails", async () => {
    await evaluate();
    fireEvent.click(await screen.findByRole("tab", { name: "Rule configuration" }));
    const sw = screen.getByLabelText("Enable Mobile shared with another application") as HTMLInputElement;
    expect(screen.getByLabelText("Enable Device fingerprint reuse")).toBeDisabled();
    patchStatus = 409;
    fireEvent.click(sw);
    await vi.waitFor(() => expect(window.alert).toHaveBeenCalledWith("Rule is locked"));
    await vi.waitFor(() => expect(sw.checked).toBe(true));
    const patch = calls.find((c) => c.init?.method === "PATCH")!;
    expect(patch.url).toBe("/api/v1/credit/fraud-screening/rules/R1");
    expect(JSON.parse(String(patch.init!.body))).toEqual({ enabled: false });
  });
});

describe("the logic", () => {
  it("counts and classes the rules", () => {
    expect(ruleCounts(evaluation)).toEqual({ trig: 1, pass: 1, skip: 2 });
    expect(ruleRow({ triggered: true, severity: "CRITICAL" })).toEqual({ cls: "s-triggered sev-critical", resCls: "triggered", resTxt: "Triggered" });
    expect(ruleRow({ enabled: false, triggered: true }).resTxt).toBe("Disabled");
    expect(screenCount(evaluation.pep)).toBe(0);
    expect(screenCount(evaluation.aml)).toBe(1);
  });

  it("puts the evaluation into the common result layout", () => {
    const page = toResultPage(evaluation);
    expect(page.basic.title).toBe("APP-TEST-0001");
    expect(page.basic.decision).toEqual({ label: "HIGH risk", tone: "fail" });
    expect(page.basic.kpis!.map((k) => k.value)).toEqual([2, 1, 1, 2]);         // rules run: the enabled ones only
    expect(page.rules!.rules.map((r) => [r.id, r.outcome, r.outcomeLabel])).toEqual([
      ["FR-001", "fail", "Triggered"], ["FR-003", "pass", "Passed"], ["R9", "na", "Skipped"],      // the disabled FR-002 is not listed
    ]);
    expect(page.summary!.points).toEqual([
      "One high severity rule triggered.", "AML screening: 1 record at or above 70%.",
      "PEP check could not run: PEP vendor timed out.", "Mobile shared: Shared with APP-TEST-0002",
    ]);
    const calc = page.calculations!.rows;
    expect(calc.filter((r) => r.group === "AML screening").map((r) => [r.label, r.value])).toEqual([
      ["At or above 70%", 1], ["Below 70%", 2], ["Highest match score", "85%"], ["Records from vendor", 3], ["Source", "Sample data"],
    ]);
    expect(calc.find((r) => r.group === "PEP check")).toMatchObject({ label: "Status", value: "Could not run" });
    expect(page.actions!.every((a) => !a.onClick)).toBe(true);
    expect(["LOW", "MEDIUM", "CRITICAL", undefined].map(riskTone)).toEqual(["pass", "review", "fail", "na"]);
    expect(toResultPage({ application_number: "X", aml: null }).calculations!.rows.find((r) => r.group === "AML screening"))
      .toMatchObject({ value: "Not run" });
  });

  it("colours and draws the gauge", () => {
    expect(gaugeColour(70, 70)).toBe("g-red");
    expect(gaugeColour(50, 70)).toBe("g-yellow");
    expect(gaugeColour(49, 70)).toBe("g-green");
    expect(gaugePoint(0, 40)).toEqual(["10.00", "50.00"]);
    expect(gaugePoint(100, 40)).toEqual(["90.00", "50.00"]);
    expect(threshold(undefined)).toBe(70);
    expect(threshold("80")).toBe(80);
  });
});
