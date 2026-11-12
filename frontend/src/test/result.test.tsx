import { fireEvent, render, screen, within } from "@testing-library/react";
import { ResultPage } from "../shared/components/result";
import { plainWords } from "../shared/components/result/ResultPage";
import { EXAMPLE_RESULT } from "../shared/components/result/example";
import { personName, withoutDevNames } from "../shared/lib/people";

describe("common result layout", () => {
  it("shows the basic card, the summary points, rules, calculations and actions", () => {
    render(<ResultPage {...EXAMPLE_RESULT} />);
    expect(screen.getByRole("heading", { name: "Asha Kulkarni" })).toBeInTheDocument();
    expect(screen.getByText("Review required")).toBeInTheDocument();
    const summary = screen.getByRole("region", { name: "AI summary" });
    expect(summary.querySelectorAll(".cu-r-points li")).toHaveLength(3);   // 3 of 4, then "Show all"
    expect(screen.getByRole("region", { name: "Calculations" })).toHaveTextContent("FOIR");
    expect(screen.getByRole("toolbar", { name: "Actions" })).toHaveTextContent("Submit");
  });

  it("pages the rules 6 at a time and filters them by outcome", () => {
    render(<ResultPage {...EXAMPLE_RESULT} />);
    const rules = screen.getByRole("region", { name: "Rules" });
    expect(within(rules).getByText("1–6 of 12 rules")).toBeInTheDocument();
    fireEvent.click(within(rules).getByRole("button", { name: /^Fail/ }));
    expect(within(rules).getByText("No bounced EMI in the last 6 months")).toBeInTheDocument();
    expect(within(rules).queryByText("Applicant name matches the PAN")).toBeNull();
  });

  it("shows a rule's compared values on its card, no click needed", () => {
    render(<ResultPage {...EXAMPLE_RESULT} />);
    const rules = screen.getByRole("region", { name: "Rules" });
    const card = rules.querySelector('[data-rule-id="R01"]')!;
    expect(card.querySelector(".cu-r-compare")).toHaveTextContent("Application");
    expect(card.querySelector(".cu-r-compare")).toHaveTextContent("Same as the application");
  });

  it("Value | Limit reads Actual | Allowed on the card", () => {
    const rules = [{ id: "FOIR", name: "FOIR", outcome: "fail" as const,
      values: [{ label: "Value", value: "62%" }, { label: "Limit", value: "50%" }, { label: "Note", value: "over" }] }];
    render(<ResultPage basic={{ eyebrow: "x", title: "T" }} rules={{ rules }} />);
    const card = document.querySelector('[data-rule-id="FOIR"]')!;
    expect(card.querySelector(".cu-r-compare")).toHaveTextContent("Actual62%");
    expect(card.querySelector(".cu-r-compare")).toHaveTextContent("Policy limit50%");
    const row = within(card as HTMLElement).getByRole("button", { name: /FOIR/ });
    fireEvent.click(row);                                                            // the rest still opens
    expect(card).toHaveTextContent("over");
  });

  it("one decision word on every agent, the agent's own word under it", () => {
    render(<ResultPage {...EXAMPLE_RESULT} />);
    const card = screen.getByRole("region", { name: "Summary card" });
    expect(within(card).getByText("Refer")).toHaveClass("cu-r-verdict-word");       // review -> Refer
    expect(within(card).getByText("Review required")).toHaveClass("cu-r-decision");  // the agent's word, small
  });

  it("a summary point opens the rule it came from", () => {
    render(<ResultPage {...EXAMPLE_RESULT} />);
    const summary = screen.getByRole("region", { name: "AI summary" });
    const rules = screen.getByRole("region", { name: "Rules" });
    fireEvent.click(within(rules).getByRole("button", { name: /^Pass/ }));         // filtered away from the rule
    const link = within(summary).getAllByRole("button", { name: /^Open rule / })[0];
    const id = /Open rule (\S+):/.exec(link.getAttribute("aria-label") ?? "")![1];
    fireEvent.click(link);
    const card = rules.querySelector(`[data-rule-id="${id}"]`);
    expect(card).not.toBeNull();                                                     // back on All, on its page
    expect(card).toHaveClass("is-focus");
  });

  it("a concern opens its rule too", () => {
    render(<ResultPage {...EXAMPLE_RESULT} />);
    const concerns = screen.getByRole("group", { name: "Concerns" });
    fireEvent.click(within(concerns).getByRole("button", { name: /LTV within the policy limit/ }));
    expect(screen.getByRole("region", { name: "Rules" }).querySelector('[data-rule-id="R12"]')).toHaveClass("is-focus");
  });

  it("an action without logic says it is not connected yet", () => {
    render(<ResultPage {...EXAMPLE_RESULT} />);
    fireEvent.click(screen.getByRole("button", { name: "Hold" }));
    expect(screen.getByRole("status")).toHaveTextContent("“Hold” is not connected yet.");
  });
});

describe("long summaries", () => {
  it("shows 3 points, then all of them on request", () => {
    const points = Array.from({ length: 23 }, (_, i) => `Point number ${i + 1}.`);
    render(<ResultPage {...EXAMPLE_RESULT} summary={{ points, source: "Rules summary" }} />);
    const summary = screen.getByRole("region", { name: "AI summary" });
    expect(summary.querySelectorAll(".cu-r-points li")).toHaveLength(3);
    fireEvent.click(within(summary).getByRole("button", { name: "Show all (23)" }));
    expect(summary.querySelectorAll(".cu-r-points li")).toHaveLength(23);
    fireEvent.click(within(summary).getByRole("button", { name: "Show fewer" }));
    expect(summary.querySelectorAll(".cu-r-points li")).toHaveLength(3);
  });
});

describe("scale: tomorrow's rules", () => {
  it("200 rules, 100 values and 40 points still render one page of each (6 rules, 10 values, 3 points)", async () => {
    const { scaledExample } = await import("../shared/components/result/example");
    render(<ResultPage {...scaledExample(200, 100, 40)} />);
    const rules = screen.getByRole("region", { name: "Rules" });
    expect(rules.querySelectorAll(".cu-r-rule")).toHaveLength(6);
    expect(within(rules).getByText("1–6 of 200 rules")).toBeInTheDocument();
    const calcs = screen.getByRole("region", { name: "Calculations" });
    expect(calcs.querySelectorAll(".cu-r-calc")).toHaveLength(10);
    const summary = screen.getByRole("region", { name: "AI summary" });
    expect(summary.querySelectorAll(".cu-r-points li")).toHaveLength(3);
    // filtering keeps paging: the failed rules are paged 8 at a time too
    const fails = scaledExample(200, 100, 40).rules!.rules.filter((r) => r.outcome === "fail").length;
    fireEvent.click(within(rules).getByRole("button", { name: /^Fail/ }));
    expect(rules.querySelectorAll(".cu-r-rule")).toHaveLength(6);
    expect(within(rules).getByText(`1–6 of ${fails} rules`)).toBeInTheDocument();
  });

  it("one section at a time: Overview first, the others a tab away", () => {
    render(<ResultPage {...EXAMPLE_RESULT}><div><h3>AML screening</h3><p>clear</p></div></ResultPage>);
    const rail = screen.getByRole("tablist", { name: "Result sections" });
    const names = within(rail).getAllByRole("tab").map((t) => t.textContent?.replace(/\d+/g, "").trim());
    expect(names).toEqual(["Overview", "Rules & Calculations", "More details"]);   // one tab for both
    const pane = (name: string) => document.getElementById(`cu-r-pane-${name}`)!;
    expect(pane("overview")).not.toHaveClass("is-away");
    expect(pane("rules")).toHaveClass("is-away");
    fireEvent.click(within(rail).getByRole("tab", { name: /Rules/ }));
    expect(pane("rules")).not.toHaveClass("is-away");
    expect(pane("overview")).toHaveClass("is-away");
    expect(within(rail).getByRole("tab", { name: /Rules/ })).toHaveAttribute("aria-selected", "true");
    // in that tab: Calculations on the left, the rules on the right, one rule a row
    const split = pane("rules").querySelector(".cu-r-split")!;
    expect(split.children[0]).toHaveAttribute("aria-label", "Calculations");
    expect(split.children[1]).toHaveAttribute("aria-label", "Rules");
    expect(screen.getByRole("region", { name: "More details" })).toHaveTextContent("AML screening");
  });

  it("a summary point opens the Rules tab", () => {
    render(<ResultPage {...EXAMPLE_RESULT} />);
    fireEvent.click(within(screen.getByRole("region", { name: "AI summary" })).getAllByRole("button", { name: /^Open rule / })[0]);
    expect(document.getElementById("cu-r-pane-rules")).not.toHaveClass("is-away");
  });

  it("Overview: no repeat of the other sections; key numbers and the next step", () => {
    const summary = { points: ["All checks clear.", "Next step: send to sanction."] };
    render(<ResultPage {...EXAMPLE_RESULT} summary={summary} />);
    expect(screen.queryByRole("group", { name: "Go to a section" })).toBeNull();
    const brief = screen.getByRole("region", { name: "AI summary" });
    expect(within(brief).getByRole("note", { name: "Next step" })).toHaveTextContent("send to sanction.");
    expect(brief.querySelectorAll(".cu-r-points li")).toHaveLength(1);
    expect(brief.querySelectorAll(".cu-r-keynum").length).toBeGreaterThan(0);
  });

  it("no More details card when the agent has nothing extra", () => {
    render(<ResultPage {...EXAMPLE_RESULT} />);
    expect(screen.queryByRole("region", { name: "More details" })).toBeNull();
  });
});

describe("names on screens", () => {
  it("a development log-in never shows; a real name does", () => {
    expect(personName("local-developer")).toBe("Officer");
    expect(personName("Decided by local-developer on 7 Nov")).toBe("Decided by Officer on 7 Nov");
    expect(personName("Priya Nair")).toBe("Priya Nair");
    expect(withoutDevNames({ a: [{ by: "local-developer" }], n: 3 })).toEqual({ a: [{ by: "Officer" }], n: 3 });
  });
});

describe("paging", () => {
  it("9 rules at 6 a page: the pager shows and page 2 has the other 3", () => {
    const rules = Array.from({ length: 9 }, (_, i) => ({ id: `R${i + 1}`, name: `Rule ${i + 1}`, outcome: "pass" as const }));
    render(<ResultPage basic={{ eyebrow: "x", title: "T" }} rules={{ rules }} />);
    const panel = screen.getByRole("region", { name: "Rules" });
    expect(panel.querySelectorAll(".cu-r-rule")).toHaveLength(6);
    expect(within(panel).getByText("1–6 of 9 rules")).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "Next page" }));
    expect(panel.querySelectorAll(".cu-r-rule")).toHaveLength(3);
  });

  it("key numbers: digits only, each label once, never a bare 0", () => {
    const rows = [
      { label: "Cases found", value: "8" }, { label: "Cases found", value: "4" }, { label: "Missing", value: "0" },
      { label: "Owner", value: "Unavailable" }, { label: "FOIR", value: "33%", tone: "pass" as const },
    ];
    render(<ResultPage basic={{ eyebrow: "x", title: "T" }} summary={{ points: ["ok"] }} calculations={{ rows }} />);
    const nums = Array.from(document.querySelectorAll(".cu-r-keynum dt")).map((d) => d.textContent);
    expect(nums).toEqual(["FOIR", "Cases found"]);
  });
});

describe("plain words in the summary", () => {
  it("field names read as words, known short forms in capitals, other words untouched", () => {
    expect(plainWords("Critical issues: pan, acknowledgement_number, application_pan_number_vs_output_document"))
      .toBe("Critical issues: PAN, acknowledgement number, application PAN number vs output document");
    expect(plainWords("The id is valid and the emi is paid")).toBe("The ID is valid and the EMI is paid");
  });
});

