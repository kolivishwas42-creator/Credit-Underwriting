/**
 * RULES SETTINGS (owner 2026-11-12: "rules config hona chahiye: on/off, disable, add"). DATA ONLY: for each agent,
 * where its rules API is and which of its fields mean what. The shared Rules screen (shared/components/RulesSettings)
 * reads this; nothing about an agent's rules is written in the component.
 *
 * An agent missing here has no rules API yet: its sidebar shows no "Rules settings".
 */

export interface NumberField {
  /** field on the rule row */
  field: string;
  label: string;
  step?: number;
}

export interface RulesSource {
  /** API base of the agent (the console proxies it to the right backend) */
  base: string;
  /** GET path of the list */
  list: string;
  /** the list is under this key of the reply; empty = the reply is the list */
  rowsAt?: string;
  /** rules come in groups chosen by a query parameter (Residence / Office), or -- `inPath` -- by the group's value
   *  added to `base` (one rule set per group: Dedupe / Customer history, a policy file per loan product) */
  groups?: { param: string; values: { value: string; label: string }[]; inPath?: boolean };
  /** field saying a rule is always on (its switch is shown locked) */
  locked?: string;
  /** the reply's templates a new rule can be made from (Add rule); none = no Add rule */
  templatesAt?: string;
  /** the reply's own word for "on" (Crime: "Sends to review") */
  onLabelAt?: string;
  /** how the screen is opened: the common sidebar's menu (default), or -- for an agent with its own sidebar -- a
   *  "Rules settings" button that opens it as a panel */
  entry?: "sidebar" | "panel";
  /** fields that together identify a rule (sent back on save) */
  key: string[];
  /** first non-empty of these is the rule's name */
  name: string[];
  /** a short id shown beside the name */
  code?: string;
  description?: string;
  /** field holding the severity / criticality, and the choices offered */
  severity?: string;
  severityChoices?: string[];
  /** field holding on / off */
  enabled: string;
  /** numbers on the rule row that can be changed (limits, tolerances, weights) */
  numbers?: NumberField[];
  /** an object field whose number entries can be changed (settings / config_json); sent back whole */
  numbersIn?: string;
  /** send only the changed numbers of `numbersIn` (the rule store API), not the whole object */
  numbersPartial?: boolean;
  /** how a change is saved */
  save: {
    method: "PUT" | "PATCH";
    /** may contain {field} placeholders filled from the rule row, e.g. /rules/{rule_key} */
    path: string;
    /** the body is { [groupField]: group, [listField]: [rule] } (Residence / Office) */
    wrap?: { groupField: string; listField: string };
  };
}

/** The Rules settings view (owner 2026-11-13: ON, "pura alag"): its own tab in the Overview sidebar (/rules), not
 *  inside the agents. false = the tab is not shown. */
export const RULES_SETTINGS_VISIBLE = true;

const SEVERITY = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

/** The agents whose rules live in the versioned rule store: one API for all (backend shared/api/rule_settings.py) --
 *  every change is a new validated version, who / when recorded. */
const store = (set: string, extra: Partial<RulesSource> = {}): RulesSource => ({
  base: `/api/v1/rule-settings/${set}`,
  list: "",
  rowsAt: "rules",
  key: ["id"],
  name: ["name", "id"],
  code: "id",
  enabled: "enabled",
  numbersIn: "params",
  numbersPartial: true,
  locked: "locked",
  templatesAt: "templates",
  onLabelAt: "on_label",
  save: { method: "PATCH", path: "/rules/{id}" },
  ...extra,
});

export const RULES_SOURCES: Record<string, RulesSource> = {
  eligibility: store("eligibility_policy"),
  bank_verification: store("bank_verification_policy"),
  legal_verification: store("legal_verification_policy", { entry: "panel" }),
  crime_verification: store("crime_verification_policy", { entry: "panel" }),
  dedupe: store("", {
    entry: "panel",
    groups: { param: "set", inPath: true, values: [
      { value: "dedupe_policy", label: "Dedupe" }, { value: "customer_history_policy", label: "Customer history" }] },
  }),
  docs_policy: store("docs_policy:", {
    entry: "panel",
    groups: { param: "policy", inPath: true, values: [
      { value: "home_loan.credit.json", label: "Home loan" },
      { value: "loan_against_property.credit.json", label: "Loan against property" },
      { value: "personal_loan.credit.json", label: "Personal loan" }] },
  }),
  collateral_verification: {
    base: "/api/v1/credit/collateral-verification",
    list: "/rules",
    key: ["rule_id"],
    name: ["label", "rule_id"],
    code: "rule_id",
    enabled: "enabled",
    numbers: [{ field: "tolerance_pp", label: "Tolerance (percentage points)", step: 0.5 }],
    save: { method: "PUT", path: "/rules" },
  },
  itr_verification: {
    base: "/api/v1/credit/itr-verification",
    list: "/rules",
    key: ["category", "field"],
    name: ["label", "description", "field"],
    code: "field",
    description: "description",
    severity: "severity",
    severityChoices: SEVERITY,
    enabled: "enabled",
    numbers: [
      { field: "tolerance_pct", label: "Tolerance (%)", step: 0.5 },
      { field: "weight", label: "Weight", step: 0.1 },
    ],
    save: { method: "PUT", path: "/rules" },
  },
  fraud_screening: {
    base: "/api/v1/credit/fraud-screening",
    list: "/rules",
    key: ["rule_key"],
    name: ["rule_name", "rule_key"],
    code: "rule_id",
    description: "description",
    severity: "severity",
    severityChoices: SEVERITY,
    enabled: "enabled",
    numbersIn: "config_json",
    save: { method: "PATCH", path: "/rules/{rule_key}" },
  },
  property_valuation: {
    base: "/api/v1/credit/property-valuation",
    list: "/rules",
    key: ["rule_key"],
    name: ["name", "rule_key"],
    code: "original_id",
    description: "description",
    severity: "severity",
    severityChoices: SEVERITY,
    enabled: "enabled",
    numbersIn: "settings",
    save: { method: "PUT", path: "/rules/{rule_key}" },
  },
  residence_office_verification: {
    base: "/api/v1/credit/residence-office-verification",
    list: "/rule-configs",
    rowsAt: "rules",
    groups: { param: "verification_type", values: [{ value: "RESIDENCE", label: "Residence" }, { value: "OFFICE", label: "Office" }] },
    key: ["rule_key"],
    name: ["name", "rule_key"],
    code: "rule_id",
    severity: "criticality",
    severityChoices: SEVERITY,
    enabled: "enabled",
    numbers: [{ field: "weight", label: "Weight", step: 1 }],
    save: { method: "PUT", path: "/rule-configs", wrap: { groupField: "verification_type", listField: "rules" } },
  },
};

/** Words on the Rules screen (one place, not in the component). */
export const RULES_WORDS = {
  menu: "Rules settings",
  homeAgents: "Agents",
  agentsTitle: "Agents",
  savedInDb: "Changes are saved in the database and apply to the next check.",
  title: "Rules settings",
  subtitle: "Turn a rule on or off, or change its limits. Changes apply to the next check.",
  search: "Search rules",
  on: "On",
  off: "Off",
  save: "Save",
  saved: "Saved",
  reload: "Reload",
  back: "Back",
  empty: "No rules match.",
  loading: "Loading rules…",
  failed: "Could not load the rules",
  counts: (on: number, all: number) => `${on} of ${all} rules on`,
  severity: "Severity",
  locked: "Always on",
  add: "Add rule",
  addTitle: "Add a rule",
  addHelp: "A new rule compares one signal with a value. It is checked before it is saved, and it starts on.",
  addSave: "Add rule",
  cancel: "Cancel",
  added: "Rule added",
  /** the fields of a template, in words */
  fields: {
    rule_id: "Rule ID (e.g. P20_HIGH_EMI)",
    description: "What the rule checks",
    signal: "Signal",
    operator: "Comparison",
    threshold: "Value",
    severity: "Severity",
    recommendation: "Recommendation when it fires",
    reason_code: "Reason code",
    next_action: "Next action for the officer",
  } as Record<string, string>,
  operators: { gt: "greater than", ge: "at least", lt: "less than", le: "at most", eq: "equal to", ne: "not equal to" } as Record<string, string>,
  /** rules per page on the Rules screen */
  pageSize: 8,
  /** CUSTOM RULES (owner 2026-11-13: "add rule sab ke liye") */
  custom: {
    title: "Custom rules",
    help: "Your own rules on any value this agent shows under Calculations. They are saved in the database and appear in the agent's result beside its own rules.",
    add: "Add custom rule",
    empty: "No custom rules yet.",
    remove: "Remove",
    confirmRemove: (name: string) => `Remove the rule "${name}"?`,
    fields: {
      name: "Rule name (e.g. FOIR above 55%)",
      field: "Value name, as shown in Calculations (e.g. FOIR)",
      operator: "When the value is",
      value: "Limit",
      outcome: "Then the result is",
      severity: "Severity",
      rule_id: "Rule ID (starts with C, e.g. C_HIGH_FOIR)",
    } as Record<string, string>,
    outcomes: { review: "Review", fail: "Fail" } as Record<string, string>,
    when: (field: string, op: string, value: number, outcome: string) => `When ${field} is ${op} ${value} → ${outcome}`,
  },
};
