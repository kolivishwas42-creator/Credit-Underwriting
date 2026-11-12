import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import type { CasePayload, CheckResult, Entry, Form } from "../types";
import { collect, errorText, initialEntry, inr } from "../utils/logic";
import { checkTone, decisionTone, toResultPage } from "../utils/resultView";
import fixtures from "./fixtures.json";

// fixtures.json: the REAL API's answers on the synthetic seed (captured from the backend, not written by hand)
const form = fixtures.form as unknown as Form;
const calls: { url: string; init?: RequestInit }[] = [];
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith("/form")) return json(fixtures.form);
    if (url.endsWith("/cases")) return json(fixtures.cases);
    if (url.endsWith("/inputs")) return json({ saved_at: "2026-11-07T10:00:00Z", inputs: JSON.parse(String(init?.body)) });
    if (url.endsWith("/check")) return json(fixtures.check);
    if (url.includes("/cases/CASE-E11D00000002")) return json(fixtures.case);
    return json({ detail: { message: "Case not found" } }, 404);
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe("the screen", () => {
  it("lists the cases, fetches one on pick and shows its figures", async () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "Eligibility Check" })).toBeInTheDocument();
    const select = screen.getByLabelText("Pick a case") as HTMLSelectElement;
    await screen.findByRole("option", { name: /CASE-E11D00000002 · HOME LOAN/ });
    fireEvent.change(select, { target: { value: "CASE-E11D00000002" } });
    expect(await screen.findByText("2. Loan")).toBeInTheDocument();
    expect((screen.getByLabelText("Property value (₹)") as HTMLInputElement).value).toBe(inr(9000000));
    expect((document.getElementById("product") as HTMLSelectElement).value).toBe("HOME_LOAN");
    expect(screen.getByText("Nothing saved yet")).toBeInTheDocument();
    expect((screen.getByLabelText("or type a case id") as HTMLInputElement).value).toBe("CASE-E11D00000002");
  });

  it("triggers the check with the figures on screen and shows the result", async () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText("or type a case id"), { target: { value: "CASE-E11D00000002" } });
    await screen.findByRole("option", { name: /CASE-E11D00000002/ });
    fireEvent.click(screen.getByRole("button", { name: "Fetch case" }));
    const amount = (await screen.findByLabelText("Loan amount (₹)")) as HTMLInputElement;
    fireEvent.change(amount, { target: { value: "4000000" } });
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Trigger eligibility" }));
    const result = (await screen.findByRole("region", { name: "Summary card" })).closest("#result") as HTMLElement;
    expect(within(result).getByText("APPROVED")).toHaveClass("cu-r-decision", "is-pass");
    const checks = within(result).getByRole("region", { name: "Rules" });
    expect(checks.querySelectorAll(".cu-r-rule")).toHaveLength(fixtures.check.checks.length);
    for (const c of fixtures.check.checks) expect(within(checks).getByText(c.label)).toBeInTheDocument();
    // the value and its limit sit side by side on the card (no repeated "33.33 · limit 50" line)
    const foir = Array.from(checks.querySelectorAll(".cu-r-compare")).find((x) => x.textContent?.includes("33.33"));
    expect(foir?.textContent).toBe("Actual33.33Policy limit50");
    expect(within(result).getByRole("region", { name: "AI summary" })).toHaveTextContent("EMI ₹44,986 over 240 months.");
    expect(within(result).getByRole("region", { name: "Calculations" })).toHaveTextContent(inr(5000000));
    expect(screen.getByText("Checked the figures on screen — they are not saved yet.")).toBeInTheDocument();
    const body = JSON.parse(String(calls.find((c) => c.url.endsWith("/check"))!.init!.body));
    expect(body).toMatchObject({ case_id: "CASE-E11D00000002", requested_amount: 4000000, product: "HOME_LOAN" });
  });

  it("saves and shows the error of an unknown case", async () => {
    render(<App />);
    await screen.findByRole("option", { name: /CASE-E11D00000002/ });
    fireEvent.change(screen.getByLabelText("or type a case id"), { target: { value: "CASE-NOPE" } });
    fireEvent.click(screen.getByRole("button", { name: "Fetch case" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Case not found");
    fireEvent.change(screen.getByLabelText("or type a case id"), { target: { value: "CASE-E11D00000002" } });
    fireEvent.click(screen.getByRole("button", { name: "Fetch case" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
    const put = calls.find((c) => c.init?.method === "PUT")!;
    expect(put.url).toBe("/api/v1/eligibility/cases/CASE-E11D00000002/inputs");
  });
});

describe("the logic", () => {
  const payload = fixtures.case as unknown as CasePayload;

  it("prefills from the case and sends only what is filled in", () => {
    const e: Entry = initialEntry(form, payload);
    expect(e.loan).toEqual({ requested_amount: "5000000", tenure_months: "240", rate_percent: "9" });
    const withIncome: Entry = { ...e, incomeMethod: "SALARIED",
                                income: { company_name: " Acme Ltd ", gross_salary: "120000", designation: "" },
                                collateral: "RESIDENTIAL", existingExposure: "" };
    expect(collect(form, withIncome)).toEqual({
      product: "HOME_LOAN", requested_amount: 5000000, tenure_months: 240, rate_percent: 9,
      income: { method: "SALARIED", company_name: "Acme Ltd", gross_salary: 120000 },
      collateral_type: "RESIDENTIAL",
    });
  });

  it("prefers the saved entries over the case", () => {
    const e = initialEntry(form, { ...payload, saved: { saved_at: "x", inputs: { requested_amount: 1, topup: { type: "BT_TOPUP", pos: 5 } } } });
    expect(e.loan.requested_amount).toBe("1");
    expect(e.topupType).toBe("BT_TOPUP");
    expect(e.topup.pos).toBe("5");
  });

  it("puts the check result into the common result layout", () => {
    const page = toResultPage(fixtures.check as unknown as CheckResult, { product: "HOME_LOAN", requested: 4000000 });
    expect(page.basic.title).toBe("CASE-E11D00000002");
    expect(page.basic.decision).toEqual({ label: "APPROVED", tone: "pass" });
    expect(page.basic.kpis!.map((k) => k.value)).toEqual([6, 6, 0, 0]);
    expect(page.basic.facts!.map((f) => f.label)).toEqual(["Case ID", "Product", "Requested", "Amount to offer"]);   // no internal run id
    expect(page.summary!.points).toEqual([
      "Eligible for the full ₹50,00,000 requested.", "EMI ₹44,986 over 240 months.", "Proceed with ₹50,00,000 at EMI ₹44,986.",
    ]);
    expect(page.rules!.rules[4]).toMatchObject({ id: "C05", name: "FOIR (EMIs / income)", outcome: "pass", outcomeLabel: "Pass",
                                                 values: [{ label: "Value", value: "33.33" }, { label: "Limit", value: "50" }] });
    const calc = page.calculations!.rows;
    expect(calc.find((r) => r.label === "Amount to offer")!.value).toBe(inr(5000000));
    expect(calc.find((r) => r.label === "Loan to value")).toMatchObject({ value: "55.56", hint: "limit 80", tone: "pass" });
    expect(calc.find((r) => r.group === "Working")).toMatchObject({ label: "Property", value: "LTV limit 80% (RBI slab)" });
    expect(page.actions!.every((a) => !a.onClick)).toBe(true);
    // no summary from the API: the points come from the checks that did not pass
    const bare = toResultPage({ decision: "DATA_MISSING", checks: [{ label: "Bureau score", result: "missing", limit: 700 },
                                                                   { label: "Age", result: "pass", value: 30 }] });
    expect(bare.summary!.points).toEqual(["Bureau score: missing (no value, limit 700)."]);
    expect([bare.basic.decision!.tone, bare.rules!.rules[0].outcome]).toEqual(["review", "review"]);
    expect(["REJECTED", "REFER", "x"].map(decisionTone)).toEqual(["fail", "review", "na"]);
    expect(checkTone("not_applicable")).toBe("na");
  });

  it("words the errors", () => {
    expect(errorText({ status: 422, data: { detail: [{ loc: ["body", "tenure_months"], msg: "Value error, too long" }] } }))
      .toBe("tenure_months: too long");
    expect(errorText({ status: 500, data: { error: { message: "Try again" } } })).toBe("Try again");
    expect(errorText({ status: 0, data: null })).toBe("Request failed (network)");
  });
});
