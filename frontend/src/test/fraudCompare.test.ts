import { describe, expect, it } from "vitest";
import { toRules } from "../agents/fraud_screening/utils/resultView";

describe("fraud rules: side-by-side boxes", () => {
  it("turns a rule's compare lines into a table with the two sides", () => {
    const rows = toRules({
      application_number: "A1",
      rule_results: [{ rule_key: "Rule2", rule: "Rule 2", name: "Identity swap", triggered: true, enabled: true, severity: "HIGH",
        message: "Same PAN", compare: [{ field: "PAN", application: "ABCDE1234F", other: "ABCDE1234F" }, { field: "Name", application: "A", other: "B" }] },
        { rule_key: "Rule5", rule: "Rule 5", name: "Other", triggered: false, enabled: true, message: "OK" }],
    } as never);
    expect(rows[0].compare).toEqual([{ field: "PAN", left: "ABCDE1234F", right: "ABCDE1234F" }, { field: "Name", left: "A", right: "B" }]);
    expect(rows[0].detailOnOpen).toBe(true);          // the message waits behind the click
    expect(rows[1].compare).toBeUndefined();
  });

  it("says whose data a rule checks when the applicant and the co-applicant share a rule number", () => {
    const rows = toRules({
      application_number: "A1",
      rule_results: [
        { rule_key: "Rule6_Shared_Bank_Account", rule: "Rule 6", name: "Primary shared bank account", triggered: false, enabled: true, message: "OK" },
        { rule_key: "Rule6_CoApp_Shared_Bank_Account", rule: "Rule 6", name: "Co-applicant shared bank account", triggered: false, enabled: true, message: "OK" },
        { rule_key: "Rule9_Age_DOB_Mismatch", rule: "Rule 9", name: "Age does not match DOB", triggered: false, enabled: true, message: "OK" },
        { rule_key: "Rule9_DOB_Conflict", rule: "Rule 9", name: "DOB conflict with existing profile", triggered: false, enabled: true, message: "OK" },
      ],
    } as never);
    expect(rows.map((r) => r.name)).toEqual([
      "Primary shared bank account", "Co-applicant shared bank account",
      "Age does not match DOB (Applicant and co-applicant)", "DOB conflict with existing profile (Applicant)",
    ]);
  });

  it("turns a rule's records into labelled lines, one value per key", () => {
    const rows = toRules({
      application_number: "A1",
      rule_results: [{ rule_key: "Rule15_Address_Reuse", rule: "Rule 15", name: "Address reuse", triggered: true, enabled: true,
        message: "2 earlier applications use this address with no family link",
        records: [{ score: 0.93, application: "LOS-DUMMY-0183", customer_id: null, family_link: "None found", address: "Flat 759" }] }],
    } as never);
    expect(rows[0].records).toEqual([[
      { label: "Match score", value: "0.93" }, { label: "Application", value: "LOS-DUMMY-0183" }, { label: "Customer ID", value: "—" },
      { label: "Family link", value: "None found" }, { label: "Address", value: "Flat 759" },
    ]]);
  });
});
