import type { ResultPageProps, RuleRow } from "./types";

// Example data for the design page (/design) and tests. Synthetic: no real person or case.
const RULE_NAMES = [
  "Applicant name matches the PAN", "Date of birth matches across documents", "Address matches the utility bill",
  "Income within the declared band", "No bounced EMI in the last 6 months", "Property PIN matches the deed",
  "Owner on the deed is a borrower", "Valuation within 10% of the vendor report", "No adverse court record",
  "Bank account in the applicant's name", "FOIR within the policy limit", "LTV within the policy limit",
];
const OUTCOMES: RuleRow["outcome"][] = ["pass", "pass", "review", "pass", "fail", "pass", "pass", "review", "pass", "pass", "pass", "fail"];

export const EXAMPLE_RESULT: ResultPageProps = {
  basic: {
    eyebrow: "Credit underwriting · Example agent",
    title: "Asha Kulkarni",
    subtitle: "Home loan · Branch Pune West",
    icon: "shield",
    decision: { label: "Review required", tone: "review" },
    facts: [
      { label: "Case ID", value: "CASE-EXAMPLE-0001", mono: true },
      { label: "Application", value: "APP-2026-000123", mono: true },
      { label: "Loan amount", value: "₹ 45,00,000" },
      { label: "Checked on", value: "7 Nov 2026, 10:08" },
    ],
    kpis: [
      { label: "Rules run", value: 12, tone: "info" },
      { label: "Passed", value: 8, tone: "pass" },
      { label: "Review", value: 2, tone: "review" },
      { label: "Failed", value: 2, tone: "fail" },
    ],
  },
  summary: {
    source: "AI summary",
    points: [
      "Identity and address are consistent across PAN, Aadhaar-masked copy and the utility bill.",
      "One EMI bounced in August; the rest of the six months are clean.",
      "Valuation is 12% below the vendor report — outside the 10% tolerance, so it needs a review.",
      "LTV is above the policy limit at the requested amount; a lower amount would pass.",
    ],
  },
  rules: {
    rules: RULE_NAMES.map((name, i) => ({
      id: `R${String(i + 1).padStart(2, "0")}`,
      name,
      outcome: OUTCOMES[i],
      severity: OUTCOMES[i] === "fail" ? "High" : OUTCOMES[i] === "review" ? "Medium" : undefined,
      detail: OUTCOMES[i] === "pass" ? "Matched." : "Values differ — see the comparison.",
      values: [{ label: "Application", value: "As on the application" },
               { label: "Document", value: OUTCOMES[i] === "pass" ? "Same as the application" : "Different on the document" }],
    })),
  },
  calculations: {
    rows: [
      { group: "Income", label: "Declared monthly income", value: "₹ 1,20,000" },
      { group: "Income", label: "Assessed monthly income", value: "₹ 1,08,000", hint: "ITR, last 2 years" },
      { group: "Obligations", label: "Existing EMIs", value: "₹ 22,000" },
      { group: "Obligations", label: "Proposed EMI", value: "₹ 38,900", hint: "9.1% · 240 months" },
      { group: "Ratios", label: "FOIR", value: "56.4%", tone: "pass", hint: "limit 60%" },
      { group: "Ratios", label: "LTV", value: "82.0%", tone: "fail", hint: "limit 80%" },
    ],
  },
  actions: [
    { id: "report", label: "Download report", kind: "ghost", icon: "download" },
    { id: "hold", label: "Hold", kind: "warning", icon: "pause" },
    { id: "decline", label: "Decline", kind: "danger", icon: "x" },
    { id: "submit", label: "Submit", kind: "primary", icon: "send" },
  ],
};

/** The example with as many rules / calculated values / summary points as asked — the "tomorrow there are 200 rules"
 *  check: the page must not grow with them (rules 8 per page, values 10 per page, 6 points then "Show all"). */
export function scaledExample(rules: number, calcs: number, points: number): ResultPageProps {
  const tones: RuleRow["outcome"][] = ["pass", "pass", "review", "pass", "fail", "pass", "na"];
  return {
    ...EXAMPLE_RESULT,
    summary: { source: "AI summary", points: Array.from({ length: points }, (_, i) => `Summary point ${i + 1}: what the rules found, in one plain sentence.`) },
    rules: {
      rules: Array.from({ length: rules }, (_, i) => ({
        id: `R${String(i + 1).padStart(3, "0")}`,
        name: `Policy rule ${i + 1}`,
        outcome: tones[i % tones.length],
        detail: "What was compared, in one line.",
        values: [{ label: "Application", value: "—" }, { label: "Document", value: "—" }],
      })),
    },
    calculations: {
      rows: Array.from({ length: calcs }, (_, i) => ({
        group: `Group ${Math.floor(i / 5) + 1}`, label: `Value ${i + 1}`, value: `₹ ${(i + 1) * 1000}`,
      })),
    },
  };
}
