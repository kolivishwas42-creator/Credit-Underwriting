import type { ReactNode } from "react";

/** What a rule / value says: pass (green), review (amber), fail (red), info (indigo), na (grey). */
export type Tone = "pass" | "review" | "fail" | "info" | "na";

/** One labelled value: "Case ID  CASE-001". */
export interface Fact {
  label: string;
  value: ReactNode;
  /** ids, PANs, amounts in mono */
  mono?: boolean;
}

/** A counter tile on the basic card: "12  Passed". */
export interface Kpi {
  label: string;
  value: ReactNode;
  tone?: Tone;
}

/** 1. The basic card: what this result is about, the decision, the counts. */
export interface BasicCardProps {
  /** small caps over the title, e.g. "Credit underwriting · Fraud screening" */
  eyebrow: string;
  /** the applicant / case the result is about */
  title: ReactNode;
  subtitle?: ReactNode;
  /** case id, application, product, amount … */
  facts?: Fact[];
  /** the overall outcome as a badge */
  decision?: { label: string; tone: Tone };
  kpis?: Kpi[];
  /** Icon name for the emblem */
  icon?: string;
}

/** 2. The AI summary: plain points; `source` says who wrote it ("AI summary" / "Rules summary"). */
export interface SummaryProps {
  points: string[];
  title?: string;
  source?: string;
  loading?: boolean;
  /** shown when there are no points */
  empty?: string;
}

/** 3a. One rule's result. */
export interface RuleRow {
  id: string;
  name: string;
  outcome: Tone;
  /** the agent's own word for the outcome ("Refer", "High risk" …); default from the tone */
  outcomeLabel?: string;
  severity?: string;
  /** one line under the name */
  detail?: ReactNode;
  /** values compared, shown when the row is opened */
  values?: Fact[];
  /** a small table shown when the row is opened, above the values (e.g. a comparison part by part) */
  table?: { columns: string[]; rows: string[][] };
}

export interface RulesProps {
  rules: RuleRow[];
  title?: string;
  /** rows per page (default 8) */
  pageSize?: number;
  empty?: string;
}

/** 3b. One calculated / compared value. */
export interface CalcRow {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
  mono?: boolean;
  /** rows with the same group are shown under one sub-heading */
  group?: string;
}

export interface CalcProps {
  rows: CalcRow[];
  title?: string;
  pageSize?: number;
  empty?: string;
  /** beside the rules: as tall as they are, as many rows as fit, the rest paged */
  fit?: boolean;
}

/** 4. An action button. Presentational: without `onClick` it says it is not connected yet. */
export interface ActionItem {
  id: string;
  label: string;
  kind?: "primary" | "secondary" | "danger" | "warning" | "ghost";
  icon?: string;
  onClick?: () => void;
  disabled?: boolean;
}

export interface ResultPageProps {
  basic: BasicCardProps;
  summary?: SummaryProps;
  rules?: RulesProps;
  calculations?: CalcProps;
  actions?: ActionItem[];
  /** anything agent-specific: shown under rules / calculations in the common "More details" card */
  children?: ReactNode;
  /** open "More details" from the start (e.g. it holds the decision remarks) */
  detailsOpen?: boolean;
}
