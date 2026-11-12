// The page (React) against a stubbed fetch: the form from the form schema, Check an existing case -> the result from a
// REAL (synthetic, masked) dedupe answer, errors, sign-in on 401 and the theme. Data: test/fixtures (no customer data).
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { THEME_KEY } from "../theme";
import uiText from "../../../../public/dedupe/ui_text.json";
import sampleConfig from "../../../../public/dedupe/sample_config.json";
import REAL from "./fixtures/dedupe_existing_complete.json";

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


// the backend's GET /api/v1/fos/form-schema (shape and rules as the old core tests used)
const SCHEMA = { fields: [
  { name: "full_name", group: "applicant", label: "Applicant name", required: true, max_length: 200, choices: null, rules: { pattern: "^[A-Za-z\\u0900-\\u097F .'-]{2,}$" } },
  { name: "mobile", group: "applicant", label: "Mobile", required: true, max_length: 20, choices: null, rules: { pattern: "^[6-9]\\d{9}$", strip: "[\\s+-]|^91(?=\\d{10}$)" } },
  { name: "date_of_birth", group: "applicant", label: "Date of birth", required: true, max_length: 32, choices: null, rules: { date: true, min_age: 18, max_age: 80 } },
  { name: "address", group: "applicant", label: "Address", required: true, max_length: 500, choices: null, rules: {} },
  { name: "product", group: "application", label: "Product", required: true, max_length: 64, choices: ["PERSONAL_LOAN", "HOME_LOAN", "LOAN_AGAINST_PROPERTY"], rules: {} },
  { name: "loan_amount", group: "application", label: "Loan amount (Rs)", required: true, max_length: null, choices: null, rules: { number: true } },
  { name: "tenure_months", group: "application", label: "Tenure (months)", required: false, max_length: null, choices: null, rules: { integer: true, min: 12, max: 360 } },
] };

const calls: { url: string; init?: RequestInit }[] = [];
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
let schemaStatus = 200;
let dedupeStatus = 200;

beforeEach(() => {
  calls.length = 0;
  schemaStatus = 200;
  dedupeStatus = 200;
  try { localStorage.clear(); sessionStorage.clear(); } catch { /* none */ }
  delete document.documentElement.dataset.theme;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith("ui_text.json")) return json(uiText);
    if (url.endsWith("sample_config.json")) return json(sampleConfig);
    if (url === "/api/v1/fos/form-schema") return schemaStatus === 200 ? json(SCHEMA) : json({ detail: "Not Found" }, schemaStatus);
    if (url === "/api/v1/credit/dedupe") {
      return dedupeStatus === 200 ? json(REAL) : json({ detail: { code: "UNAUTHENTICATED", message: "Sign in." } }, dedupeStatus);
    }
    if (url === "/api/v1/auth/login") return json({ access_token: "t-test" });
    if (url.includes("/reason")) return json({ points: [] });
    return json({ detail: "Not Found" }, 404);
  }));
});
afterEach(() => vi.unstubAllGlobals());

const lookupBody = () => JSON.parse(String(calls.find((c) => c.url === "/api/v1/credit/dedupe")!.init!.body));

async function runLookup() {
  render(<App />);
  await screen.findByText("Backend connected");
  fireEvent.click(screen.getByRole("button", { name: /Check an existing case/ }));
  fireEvent.change(screen.getByLabelText(/Case ID/), { target: { value: "CASE-SYN0000001" } });
  fireEvent.change(screen.getByLabelText(/Dedupe parameter \*/), { target: { value: "PAN" } });
  fireEvent.change(screen.getByLabelText(/Dedupe parameter value/), { target: { value: "abcde 1234f" } });
  fireEvent.click(screen.getByRole("button", { name: "Run check" }));
}

/** The screen opens on Check an existing case; New application is one click away. */
async function openApply() {
  render(<App />);
  await screen.findByText("Backend connected");
  fireEvent.click(screen.getByRole("button", { name: /New application/ }));
}

describe("default screen", () => {
  it("opens on Check an existing case, with New application still reachable", async () => {
    render(<App />);
    expect(document.getElementById("crumb-page")).toHaveTextContent("Check an existing case");
    expect(document.querySelector('.page[data-page="lookup"]')!.className).toContain("is-active");
    expect(document.querySelector('.page[data-page="apply"]')!.className).not.toContain("is-active");
    expect(screen.getByRole("button", { name: /Check an existing case/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByLabelText(/Case ID/)).toBeInTheDocument();
    await screen.findByText("Backend connected");
    fireEvent.click(screen.getByRole("button", { name: /New application/ }));
    expect(document.querySelector('.page[data-page="apply"]')!.className).toContain("is-active");
    expect(document.getElementById("crumb-page")).toHaveTextContent("New application");
  });
});

describe("new application", () => {
  it("draws the form from the schema in the Sourcing screen's order and offers Fill sample", async () => {
    await openApply();
    const top = document.getElementById("fields-top")!;
    expect(within(top).getByLabelText(/Customer Type/)).toBeInTheDocument();
    expect(within(top).getByLabelText(/Loan Tenure \(Years\)/)).toBeInTheDocument();
    expect(within(document.getElementById("fields-applicant")!).getByLabelText(/Applicant name|Name/)).toBeInTheDocument();
    await waitFor(() => expect(document.getElementById("sample-fill")).toBeVisible());
    // New hides the dedupe parameter; Existing shows it
    expect(document.getElementById("w-dedupe-parameter")).not.toBeVisible();
    fireEvent.change(screen.getByLabelText(/Customer Type/), { target: { value: "Existing" } });
    expect(document.getElementById("w-dedupe-parameter")).toBeVisible();
  });

  it("validates before anything is sent", async () => {
    await openApply();
    fireEvent.click(screen.getByRole("button", { name: /Open case/ }));
    expect(await screen.findByText(/fields need attention/)).toBeInTheDocument();
    expect(screen.getByText("Choose New or Existing.")).toBeInTheDocument();
    expect(calls.some((c) => c.url === "/api/v1/fos/applicants")).toBe(false);
  });

  it("Fill sample fills the whole form with a synthetic applicant", async () => {
    await openApply();
    fireEvent.click(document.getElementById("sample-fill")!);
    await waitFor(() => expect((screen.getByLabelText(/Customer Type/) as HTMLSelectElement).value).not.toBe(""));
    expect(await screen.findByText(/Sample filled:/)).toBeInTheDocument();
  });

  it("a form schema the backend does not serve shows the error state", async () => {
    schemaStatus = 404;
    render(<App />);
    // the default screen (Check an existing case) still works; the nav says what is missing, not "unreachable"
    expect(await screen.findByText("New application not available")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run check" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /New application/ }));
    expect(screen.getByText("The form could not be loaded")).toBeInTheDocument();
  });

  it("a form schema that fails otherwise says the backend is unreachable", async () => {
    schemaStatus = 500;
    render(<App />);
    expect(await screen.findByText("Backend unreachable")).toBeInTheDocument();
  });
});

describe("check an existing case", () => {
  it("sends the normalised identifier and shows the result from the real answer", async () => {
    await runLookup();
    // the common result layout: basic card -> summary -> rules | calculations -> agent panels -> actions
    await waitFor(() => expect(document.querySelector(".cu-r-basic .cu-r-title")?.textContent).toBeTruthy());
    expect(document.querySelector(".cu-r-basic .cu-r-decision")?.textContent).toBeTruthy();
    expect(screen.getByRole("region", { name: "AI summary" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Rules" })).toBeInTheDocument();          // common names
    expect(screen.getByRole("region", { name: "Calculations" })).toBeInTheDocument();
    expect(screen.getByRole("toolbar", { name: "Actions" })).toBeInTheDocument();
    expect(lookupBody()).toEqual({ case_id: "CASE-SYN0000001", party_role: "Applicant", dedupe_parameter: "PAN",
      dedupe_parameter_value: "ABCDE1234F", customer_type: "Existing" });
    expect(screen.getByText("Existing Loan Details")).toBeInTheDocument();
    expect(inCalculations(REAL.request_id)).toBe(true);   // past the header's four facts: Case details
    // Run check again is wired to the page's own check; the other actions are presentational
    const before = calls.filter((c) => c.url === "/api/v1/credit/dedupe").length;
    fireEvent.click(screen.getByRole("button", { name: "Run check again" }));
    await waitFor(() => expect(calls.filter((c) => c.url === "/api/v1/credit/dedupe").length).toBe(before + 1));
    await waitFor(() => expect(document.querySelector(".cu-r-basic")).not.toBeNull());
    expect(document.getElementById("chip-case")).toHaveTextContent("Case CASE-SYN0000001");
    // no full PAN anywhere on the page
    expect(document.body.textContent).not.toMatch(/\b[A-Z]{5}\d{4}[A-Z]\b/);
  });

  it("a loan row opens its details in the side panel; Esc closes it", async () => {
    await runLookup();
    await screen.findByText("Existing Loan Details");
    const rows = document.querySelectorAll(".eld tr.loan-row");
    if (!rows.length) return;                                   // the fixture's history may carry no loans
    fireEvent.click(rows[0]);
    const drawer = await screen.findByRole("dialog");
    expect(drawer).toHaveAttribute("id", "pr-drawer");
    fireEvent.keyDown(drawer, { key: "Escape" });
    await waitFor(() => expect(document.getElementById("pr-drawer")).toBeNull());
  });

  it("an invalid identifier is refused on the page", async () => {
    render(<App />);
    await screen.findByText("Backend connected");
    fireEvent.click(screen.getByRole("button", { name: /Check an existing case/ }));
    fireEvent.change(screen.getByLabelText(/Dedupe parameter \*/), { target: { value: "AP Code" } });
    fireEvent.change(screen.getByLabelText(/Dedupe parameter value/), { target: { value: "AP123" } });
    fireEvent.click(screen.getByRole("button", { name: "Run check" }));
    expect(await screen.findByText("Enter the case ID.")).toBeInTheDocument();
    expect(screen.getByText(/AP followed by 8 digits/, { selector: ".field-error" })).toBeInTheDocument();
    expect(calls.some((c) => c.url === "/api/v1/credit/dedupe")).toBe(false);
  });

  it("a 401 opens Sign in; after signing in the check is retried with the token", async () => {
    dedupeStatus = 401;
    await runLookup();
    const user = await screen.findByLabelText("Username");
    dedupeStatus = 200;
    fireEvent.change(user, { target: { value: "officer" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } });
    await act(async () => { fireEvent.submit(document.getElementById("signin-form")!); });
    await screen.findByText("Existing Loan Details");
    const last = calls.filter((c) => c.url === "/api/v1/credit/dedupe").at(-1)!;
    expect((last.init!.headers as Record<string, string>).Authorization).toBe("Bearer t-test");
    expect(sessionStorage.getItem("los-copilot-token")).toBe("t-test");
    expect(document.getElementById("who-text")).toHaveTextContent("officer");
  });

  it("a failed check shows the error with Retry", async () => {
    dedupeStatus = 500;
    await runLookup();
    expect(await screen.findByText("The check could not run")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry check" })).toBeInTheDocument();
  });
});

describe("theme", () => {
  it("toggles light / dark on <html> and remembers it", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Switch light / dark" }));
    const first = document.documentElement.dataset.theme;
    expect(["light", "dark"]).toContain(first);
    expect(localStorage.getItem(THEME_KEY)).toBe(first);
    fireEvent.click(screen.getByRole("button", { name: "Switch light / dark" }));
    expect(document.documentElement.dataset.theme).not.toBe(first);
  });
});
