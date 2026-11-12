import { act, fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { AGENTS } from "../config/agents";
import { Pagination } from "../shared/components/Pagination";
import { usePagination } from "../shared/hooks/usePagination";

// the agent screens themselves are tested in their own projects; here they are stand-ins
vi.mock("../agents/registry", async () => {
  const { lazy } = await import("react");
  const screens: Record<string, unknown> = {};
  for (const a of (await import("../config/agents")).AGENTS) {
    screens[a.id] = lazy(async () => ({ default: () => <p>screen {a.id}</p> }));
  }
  return { SCREENS: screens };
});

import App from "../App";

describe("console shell", () => {
  beforeEach(() => { window.history.replaceState(null, "", "/"); });

  it("shows one tab per agent and opens the one clicked", async () => {
    render(<App />);
    const tabs = screen.getByRole("tablist", { name: "Agents" });
    for (const a of AGENTS) expect(tabs).toHaveTextContent(a.label);
    fireEvent.click(screen.getByRole("tab", { name: /Eligibility/ }));
    expect(await screen.findByText("screen eligibility", undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/eligibility");
    expect(document.documentElement).toHaveClass("agent-eligibility");
  });

  it("opens the agent named in the URL and follows back / forward", async () => {
    window.history.replaceState(null, "", "/fraud_screening");
    render(<App />);
    expect(await screen.findByText("screen fraud_screening", undefined, { timeout: 5000 })).toBeInTheDocument();
    act(() => {
      window.history.pushState(null, "", "/legal_verification");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(await screen.findByText("screen legal_verification", undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(document.documentElement).not.toHaveClass("agent-fraud_screening");
  });
});

function List({ n }: { n: number }) {
  const items = Array.from({ length: n }, (_, i) => `row ${i + 1}`);
  const pager = usePagination(items);
  return <><ul>{pager.rows.map((r) => <li key={r}>{r}</li>)}</ul><Pagination pager={pager} noun="cases" /></>;
}

describe("pagination", () => {
  it("shows 10 per page and moves between pages", () => {
    render(<List n={23} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(10);
    expect(screen.getByText("1–10 of 23 cases")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "3" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("row 23")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "50" } });
    expect(screen.getAllByRole("listitem")).toHaveLength(23);
  });

  it("is hidden when everything fits on one page", () => {
    render(<List n={7} />);
    expect(screen.queryByRole("navigation")).toBeNull();
  });
});

describe("agent titles", () => {
  it("every agent has its full name in the agent list, and AgentTitle shows it", async () => {
    const { AGENTS } = await import("../config/agents");
    const { AgentTitle } = await import("../shared/components/Typewriter");
    for (const a of AGENTS) expect(a.title.length).toBeGreaterThan(2);
    render(<h1><AgentTitle id="fraud_screening" /></h1>);
    expect(screen.getByRole("heading", { name: "Fraud Screening" })).toBeInTheDocument();
  });
});

