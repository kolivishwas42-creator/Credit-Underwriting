import { defineWorkspace } from "vitest/config";

// One test project per agent (each keeps its own src/agents/<agent>/test/setup.ts) + the console shell.
const AGENTS_WITH_TESTS = [
  "bank_verification", "crime_verification", "dedupe", "docs_policy", "eligibility", "fraud_screening",
  "legal_verification", "property_valuation",
];

export default defineWorkspace([
  ...AGENTS_WITH_TESTS.map((agent) => ({
    extends: "./vite.config.ts",
    test: {
      name: agent,
      include: [`src/agents/${agent}/**/*.test.{ts,tsx}`],
      environment: "jsdom",
      setupFiles: [`src/agents/${agent}/test/setup.ts`],
      globals: true,
      testTimeout: 30000,
    },
  })),
  {
    extends: "./vite.config.ts",
    test: {
      name: "shell",
      include: ["src/shared/**/*.test.{ts,tsx}", "src/test/**/*.test.{ts,tsx}", "scripts/**/*.test.js"],
      environment: "jsdom",
      setupFiles: ["src/test/setup.ts"],
      globals: true,
    },
  },
]);
