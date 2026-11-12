import { lazy, type ComponentType, type LazyExoticComponent } from "react";

// Each agent's screen is its own chunk, loaded the first time it is opened. Keys = AGENTS[].id (config/agents.ts).
export const SCREENS: Record<string, LazyExoticComponent<ComponentType>> = {
  eligibility: lazy(() => import("./eligibility")),
  dedupe: lazy(() => import("./dedupe")),
  docs_policy: lazy(() => import("./docs_policy")),
  bank_verification: lazy(() => import("./bank_verification")),
  itr_verification: lazy(() => import("./itr_verification")),
  residence_office_verification: lazy(() => import("./residence_office_verification")),
  crime_verification: lazy(() => import("./crime_verification")),
  legal_verification: lazy(() => import("./legal_verification")),
  property_valuation: lazy(() => import("./property_valuation")),
  collateral_verification: lazy(() => import("./collateral_verification")),
  fraud_screening: lazy(() => import("./fraud_screening")),
};
