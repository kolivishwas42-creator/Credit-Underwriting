import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { THEME_KEY } from "../theme";
import type { Board } from "../types";
import fixtures from "./fixtures.json";

/** a value in the Calculations panel, paging through it (facts past the header's four are Case details there) */
function inCalculations(text: string): boolean {
  const panel = screen.getByRole("region", { name: "Calculations" });
  for (let i = 0; i < 8; i += 1) {
    if (within(panel).queryAllByText(text).length) return true;
    const next = within(panel).queryByRole("button", { name: "Next page" });
    if (!next || (next as HTMLButtonElement).disabled) return false;
    fireEvent.click(next);
  }
  return false;
}


// fixtures.json: a SYNTHETIC answer in the backend's exact shape (the running backend answered 503 for every seeded case)
const board = fixtures.board as unknown as Board;
const CASE = board.case.case_id;
const calls: { url: string; init?: RequestInit }[] = [];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function stubFetch(answer: () => Response) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => { calls.push({ url, init }); return answer(); }));
}

beforeEach(() => {
  calls.length = 0;
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  document.body.className = "is-empty";
  document.title = "Credit Document Desk";
  window.history.replaceState(null, "", "/");
  stubFetch(() => json(board));
});
afterEach(() => vi.unstubAllGlobals());

async function search(id = CASE) {
  render(<App />);
  fireEvent.change(screen.getByLabelText("Case ID"), { target: { value: ` ${id.toLowerCase()} ` } });
  fireEvent.click(screen.getByRole("button", { name: "Check documents" }));
  return screen.findByRole("heading", { level: 2, name: board.case.applicant_name! });
}

describe("search", () => {
  it("renders the case from the readiness answer", async () => {
    await search();
    expect(calls[0].url).toBe(`/api/v1/credit/document-readiness/${CASE}/rules`);
    expect(calls[0].init?.method).toBe("POST");
    expect(document.body.classList.contains("is-empty")).toBe(false);
    // 1. the basic card: names, case, loan, the route as the decision, the counts, the underwriting gate
    const card = document.querySelector(".cu-r-basic") as HTMLElement;
    expect(card.querySelector(".cu-r-subtitle")?.textContent).toContain("& Vikram Kulkarni");
    expect(within(card).getByText(CASE)).toBeInTheDocument();
    expect(within(card).getByText("₹25,00,000")).toBeInTheDocument();
    expect(card.querySelector(".cu-r-decision")?.textContent).toBe("Refer to higher authority");
    expect(card.querySelector(".cu-r-decision")?.className).toContain("is-fail");
    // the header shows the common Rules / Passed / Review / Failed; the desk's own counts are Key figures
    expect(Array.from(card.querySelectorAll(".cu-r-kpi")).map((k) => k.textContent?.replace(/\d+/, ""))).toEqual(["Rules", "Passed", "Review", "Failed"]);
    const figures = screen.getByRole("region", { name: "Calculations" });
    for (const k of ["Critical", "Approval", "To collect", "Verified"]) expect(within(figures).getAllByText(k).length).toBeGreaterThan(0);
    // the header keeps 4 facts; the rest (underwriting status …) are Case details in Calculations
    expect(inCalculations("Not yet")).toBe(true);
    // the same counts filter the checklists
    const banner = document.querySelector("#banner")!;
    expect(banner.className).toBe("filterbar fade-in");
    const counts = Array.from(banner.querySelectorAll(".count")).map((b) => b.textContent);
    expect(counts).toEqual(["2Critical", "1Approval", "2To collect", "3Verified"]);
    // one card per person, critical documents first
    const people = document.querySelectorAll(".person");
    expect(people).toHaveLength(2);
    const first = Array.from(people[0].querySelectorAll(".doc .t")).map((t) => t.textContent);
    expect(first[0]).toBe("Address proof");
    expect(people[1].className).toContain("co");
    // 2. the brief as points (AI note, the route, the next step, the authority)
    const brief = screen.getByRole("region", { name: "AI summary" });
    const showAll = within(brief).queryByRole("button", { name: /^Show all/ });   // 3 points, then all on request
    if (showAll) fireEvent.click(showAll);
    const points = Array.from(brief.querySelectorAll(".cu-r-points p")).map((p) => p.textContent);
    expect(points.slice(0, 2).join(" ")).toBe(board.answer.summary.ai_summary.text);
    // the next step is its own line under the points (owner 2026-11-12)
    expect(brief.querySelector(".cu-r-next")?.textContent).toContain(board.answer.summary.next_step);
    expect(points).toContain("Higher authority: ACM");
    expect(brief).toHaveAttribute("data-source", "AI summary");   // no "AI / Rules summary" tag on screen
    // 3. the eleven policy rules (paged) | the document counts; the actions at the end
    const rules = screen.getByRole("region", { name: "Rules" });
    expect(rules.querySelector(".cu-r-filter.is-all span")?.textContent).toBe("11");
    expect(rules.querySelectorAll(".cu-r-rule").length).toBeGreaterThan(0);
    expect(screen.getByRole("region", { name: "Calculations" })).toBeInTheDocument();
    expect(screen.getByRole("toolbar", { name: "Actions" })).toBeInTheDocument();
    // the open items, the rules by section in the rail, the URL and the recent list
    expect(document.querySelectorAll("#brief .mini.go").length).toBeGreaterThan(0);
    expect(document.querySelectorAll("#rules .rsec")).toHaveLength(3);
    expect(document.querySelectorAll("#rules .rule")).toHaveLength(11);
    expect(window.location.search).toBe(`?case=${CASE}`);
    expect(document.title).toBe("Asha Kulkarni · Credit Document Desk");
    expect(JSON.parse(localStorage.getItem("docs-credit-recent")!)[0]).toEqual({ id: CASE, name: "Asha Kulkarni", tone: "bad" });
  });

  it("filters the documents by a banner count", async () => {
    await search();
    fireEvent.click(document.querySelector(".count.ok")!);
    expect(document.querySelectorAll(".doc.bad")).toHaveLength(0);
    expect(document.querySelectorAll(".filter-note")).toHaveLength(2);
    fireEvent.click(screen.getAllByText("Show all")[0]);
    expect(document.querySelectorAll(".doc.bad")).toHaveLength(2);
  });

  it("refuses a malformed case ID without calling the API", async () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText("Case ID"), { target: { value: "CASE/1" } });
    fireEvent.click(screen.getByRole("button", { name: "Check documents" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A case ID has only letters, numbers, dots, dashes and colons.");
    expect(calls).toHaveLength(0);
  });
});

describe("actions", () => {
  it("Re-check runs the same case again and keeps the filter", async () => {
    await search();
    fireEvent.click(document.querySelector(".count.ok")!);
    fireEvent.click(screen.getByRole("button", { name: "Re-check" }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].url).toBe(`/api/v1/credit/document-readiness/${CASE}/rules`);
    await waitFor(() => expect(document.querySelectorAll(".filter-note")).toHaveLength(2));
  });

  it("has no Copy brief / Copy case ID buttons", async () => {
    await search();
    expect(screen.queryByRole("button", { name: /Copy/ })).toBeNull();
  });

  it("an action with no handler says it is not connected", async () => {
    await search();
    fireEvent.click(screen.getByRole("button", { name: "Send to underwriting" }));
    expect(await screen.findByText("“Send to underwriting” is not connected yet.")).toBeInTheDocument();
    expect(calls).toHaveLength(1);
  });
});

describe("details", () => {
  it("opens a checklist cell's details in the drawer", async () => {
    await search();
    const drawer = document.querySelector("#drawer")!;
    expect(drawer.getAttribute("aria-hidden")).toBe("true");
    fireEvent.click(document.querySelector('.doc[data-slot="ADDRESS_PROOF"][data-role="PRIMARY_APPLICANT"]')!);
    expect(drawer.classList.contains("open")).toBe(true);
    expect(drawer.getAttribute("aria-hidden")).toBe("false");
    expect(document.querySelector("#drawer-kicker")?.textContent).toBe("Applicant · Asha Kulkarni");
    expect(document.querySelector("#drawer-title")?.textContent).toBe("Address proof");
    expect(document.querySelector("#drawer-help")?.textContent).toBe("Not on file yet. Any one of these is accepted: Aadhaar, Passport, Voter id.");
    expect(document.querySelector("#drawer-stat")?.textContent).toBe("Critical Missing · ask the customer");
    expect(document.querySelector("#drawer-body .line .t")?.textContent).toBe("The address proof is not on file.");
    expect(document.activeElement?.id).toBe("drawer-close");
    expect((document.querySelector("#scrim") as HTMLElement).hidden).toBe(false);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(drawer.classList.contains("open")).toBe(false);
    expect((document.querySelector("#scrim") as HTMLElement).hidden).toBe(true);
  });

  it("opens a rule's drawer from the rail, with its checks", async () => {
    await search();
    fireEvent.click(document.querySelector('.rule[data-id="RULE-02"]')!);
    expect(document.querySelector("#drawer")?.classList.contains("open")).toBe(true);
    expect(document.querySelector("#drawer-kicker")?.textContent).toBe("RULE-02 · Critical");
    expect(document.querySelector("#drawer-title")?.textContent).toBe("Applicant coverage");
    expect(document.querySelector("#drawer-stat")?.textContent).toBe("Critical 2 of 3 checks passed");
    expect(document.querySelectorAll("#drawer-body .line")).toHaveLength(3);
    expect(document.querySelector('.rule[data-id="RULE-02"]')?.className).toContain("active");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(document.querySelector('.rule[data-id="RULE-02"]')?.className).not.toContain("active");
  });

  it("lists the documents with no file under the file rule", async () => {
    await search();
    fireEvent.click(document.querySelector('.rule[data-id="RULE-11"]')!);
    const body = document.querySelector("#drawer-body")!;
    expect(body.textContent).toContain("Not uploaded · no file to check");
    expect(body.textContent).toContain("Address proof (Asha Kulkarni)");
    expect(body.textContent).toContain("ITR computation (Asha Kulkarni)");
  });

  it("opens a document from the brief", async () => {
    await search();
    const go = Array.from(document.querySelectorAll(".mini.go")).find((b) => b.getAttribute("data-slot") === "SIGNATURE")!;
    fireEvent.click(go);
    expect(document.querySelector("#drawer-title")?.textContent).toBe("Signature");
    expect(document.querySelector("#drawer-kicker")?.textContent).toBe("Co-applicant · Vikram Kulkarni");
  });
});

describe("errors", () => {
  it("shows the backend's error under the search", async () => {
    stubFetch(() => json({ detail: { code: "CASE_NOT_FOUND", message: "No application exists for this case." } }, 404));
    render(<App />);
    fireEvent.change(screen.getByLabelText("Case ID"), { target: { value: "CASE-NOPE0001" } });
    fireEvent.click(screen.getByRole("button", { name: "Check documents" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No case with this ID.");
    expect(document.body.classList.contains("is-empty")).toBe(true);
    expect(screen.getByRole("button", { name: "Check documents" })).not.toBeDisabled();
  });

  it("uses the backend's message for an unlisted status", async () => {
    stubFetch(() => json({ detail: { code: "AUDIT_UNAVAILABLE", message: "The evaluation could not be recorded (AgentDbError)." } }, 503));
    render(<App />);
    fireEvent.change(screen.getByLabelText("Case ID"), { target: { value: CASE } });
    fireEvent.click(screen.getByRole("button", { name: "Check documents" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The evaluation could not be recorded (AgentDbError).");
  });
});

describe("page", () => {
  it("toggles the theme and keeps it", () => {
    render(<App />);
    const btn = screen.getByRole("button", { name: "Switch to dark mode" });
    fireEvent.click(btn);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");
    expect(btn).toHaveAttribute("title", "Switch to light mode");
    fireEvent.click(btn);
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem(THEME_KEY)).toBe("light");
  });

  it("opens ?case= directly", async () => {
    window.history.replaceState(null, "", `/?case=${CASE}`);
    render(<App />);
    expect(await screen.findByRole("heading", { level: 2, name: "Asha Kulkarni" })).toBeInTheDocument();
    expect(calls).toHaveLength(1);
    expect((screen.getByLabelText("Case ID") as HTMLInputElement).value).toBe(CASE);
  });

  it("focuses the search on /", () => {
    render(<App />);
    (document.querySelector("#theme-btn") as HTMLElement).focus();
    fireEvent.keyDown(document, { key: "/" });
    expect(document.activeElement?.id).toBe("case-input");
  });
});
