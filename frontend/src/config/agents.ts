// The agents the console shows, in tab order. DATA ONLY (no React): vite.config.ts reads it for the dev proxy.
//   id        folder under src/agents/ and the URL path (/eligibility)
//   apiBase   the agent's API base route on the LOS service (unchanged from each agent's own config)
//   proxyEnv  env var that points this base route at another backend in development (default: LOS_API / 8010)
//   group     stage of the loan journey (tab dividers, overview columns)
export type AgentGroup = "Application" | "Verification" | "Property" | "Risk";

export interface AgentInfo {
  id: string;
  label: string;
  /** the agent's full name, on its own screen (typed, like Legal's) */
  title: string;
  description: string;
  group: AgentGroup;
  icon: string;
  apiBase: string;
  proxyEnv: string;
  /** classes the agent's old <body> carried (kept on its host element) */
  hostClass?: string;
}

export const AGENTS: AgentInfo[] = [
  { id: "eligibility", title: "Eligibility Check", label: "Eligibility", description: "Loan eligibility check and offer", group: "Application",
    icon: "gauge", apiBase: "/api/v1/eligibility", proxyEnv: "ELG_API" },
  { id: "dedupe", title: "Dedupe", label: "Dedupe", description: "Duplicate applicants and loan history", group: "Application",
    icon: "users", apiBase: "/api/v1/credit/dedupe", proxyEnv: "DDP_API" },
  { id: "docs_policy", title: "Credit Document Desk", label: "Document Desk", description: "Credit document readiness by policy", group: "Application",
    icon: "file-check", apiBase: "/api/v1/credit/document-readiness", proxyEnv: "DCP_API" },
  { id: "bank_verification", title: "Bank Verification", label: "Bank", description: "Bank account and statement verification",
    group: "Verification", icon: "bank", apiBase: "/api/v1/bank-verification", proxyEnv: "BV_API" },
  { id: "itr_verification", title: "ITR Verification", label: "ITR", description: "Income tax return verification", group: "Verification",
    icon: "receipt", apiBase: "/api/v1/credit/itr-verification", proxyEnv: "ITR_API",
    hostClass: "bg-slate-50 text-slate-900 antialiased" },
  { id: "residence_office_verification", title: "Residence / Office Verification", label: "Residence / Office", description: "Residence and office visit checks",
    group: "Verification", icon: "home", apiBase: "/api/v1/credit/residence-office-verification", proxyEnv: "ROV_API" },
  { id: "crime_verification", title: "Crime Record Verification", label: "Crime Record", description: "Criminal record screening", group: "Verification",
    icon: "shield", apiBase: "/api/v1/credit/crime-verification", proxyEnv: "CRV_API" },
  { id: "legal_verification", title: "Legal Verification", label: "Legal", description: "Legal verification of the collateral", group: "Property",
    icon: "scale", apiBase: "/api/v1/credit/legal-verification", proxyEnv: "LGV_API" },
  { id: "property_valuation", title: "Property Valuation", label: "Property Valuation", description: "Vendor valuation assessment", group: "Property",
    icon: "building", apiBase: "/api/v1/credit/property-valuation", proxyEnv: "PRV_API" },
  { id: "collateral_verification", title: "Collateral Verification", label: "Collateral", description: "Collateral report verification", group: "Property",
    icon: "key", apiBase: "/api/v1/credit/collateral-verification", proxyEnv: "COL_API" },
  { id: "fraud_screening", title: "Fraud Screening", label: "Fraud Screening", description: "Fraud rules, AML and PEP", group: "Risk",
    icon: "alert", apiBase: "/api/v1/credit/fraud-screening", proxyEnv: "FRS_API" },
];

export const GROUPS: AgentGroup[] = ["Application", "Verification", "Property", "Risk"];

export const agentById = (id: string): AgentInfo | undefined => AGENTS.find((a) => a.id === id);

/** What each stage of the underwriting journey covers (home board headings). */
export const GROUP_NOTES: Record<AgentGroup, string> = {
  Application: "Is the applicant eligible, unique and documented?",
  Verification: "Are income, bank, address and record checks clean?",
  Property: "Is the collateral legally sound and fairly valued?",
  Risk: "Any fraud, AML or PEP signal?",
};

/** The loader's lines, per agent and topic (what is being done, one line at a time — Legal's loader). */
type Topic = "open" | "fetch" | "run" | "save";
export const LOADER_LINES: Record<string, Partial<Record<Topic, string[]>>> = {
  eligibility: {
    fetch: ["Fetching the case…", "Reading the applicant's figures…"],
    run: ["Checking eligibility…", "Running age, income, score and DPD checks…", "Working out FOIR and LTV…",
      "Sizing the offer…"],
  },
  dedupe: {
    run: ["Running the dedupe check…", "Searching LOS, LMS and miFin…", "Matching PAN, mobile and name…",
      "Reading the loan history…"],
  },
  docs_policy: {
    run: ["Checking the documents…", "Reading every person's file…", "Applying the credit document policy…",
      "Sorting critical, to collect and verified…"],
  },
  bank_verification: {
    fetch: ["Searching the case…", "Loading its bank accounts…"],
    run: ["Verifying the bank account…", "Reading the statement…", "Comparing holder, account and IFSC…",
      "Checking bounces and balances…"],
    save: ["Recording the decision…", "Checking the agency report…"],
  },
  itr_verification: {
    run: ["Reading both ITR documents…", "Comparing PAN, year and income…", "Scoring every field…",
      "Writing the insights…"],
  },
  residence_office_verification: {
    run: ["Reviewing the field report…", "Running the residence rules…", "Weighing neighbour and address checks…",
      "Writing the risk summary…"],
  },
  crime_verification: {
    open: ["Opening the case…", "Loading each person's result…"],
    run: ["Starting the crime check…", "Sending applicant and co-applicants…", "Waiting for the provider…"],
    save: ["Saving…", "Updating the case…"],
  },
  legal_verification: {
    run: ["Running the ten legal rules…", "Comparing the Sale Deed and the agency report…", "Writing the summary…"],
  },
  property_valuation: {
    fetch: ["Fetching the application from LOS…", "Loading its properties…"],
    run: ["Saving the vendor response…", "Running the valuation rules…", "Comparing LOS and vendor values…",
      "Writing the assessment…"],
  },
  collateral_verification: {
    run: ["Reading the vendor report…", "Matching owner, PAN and location…", "Checking unit, construction and deed…",
      "Writing the result…"],
  },
  fraud_screening: {
    run: ["Evaluating the application…", "Running the fraud rules…", "Screening AML and PEP lists…",
      "Weighing the risk…"],
  },
};

/** The lines for an agent and topic; the first is the headline. Falls back to generic lines. */
export function loaderLines(agent: AgentInfo, topic: Topic): string[] {
  const own = LOADER_LINES[agent.id]?.[topic];
  if (own?.length) return own;
  const generic: Record<Topic, string[]> = {
    open: [`Opening ${agent.label}…`, "Loading the screen and its rules…", "Connecting to the LOS backend…"],
    fetch: ["Fetching the case…", "Loading its details…"],
    run: [`Running ${agent.label}…`, "Applying the rules…", "Writing the summary…"],
    save: ["Saving…", "Updating the case…"],
  };
  return generic[topic];
}
