import { describe, expect, it } from "vitest";
import { plain, points } from "../utils/resultView";

// owner 2026-11-12: "0 checks need a person" read badly -- zero clauses go, plain words come in
describe("plain summary wording", () => {
  it("drops a zero-count clause and joins the rest with 'and'", () => {
    expect(plain("12 checks passed, 2 checks found a problem, and 0 checks need a person."))
      .toBe("12 checks passed and 2 checks found a problem.");
  });
  it("says 'manual review' instead of 'a person'", () => {
    expect(plain("3 checks need a person.")).toBe("3 checks need a manual review.");
    expect(plain("1 check needs a person.")).toBe("1 check needs a manual review.");
  });
  it("turns check(s) into plain plural / singular", () => {
    expect(plain("4 check(s) passed.")).toBe("4 checks passed.");
    expect(plain("1 check(s) passed.")).toBe("1 check passed.");
  });
  it("leaves a sentence with no zero count alone", () => {
    expect(plain("Salary credits match the declared income.")).toBe("Salary credits match the declared income.");
  });
  it("applies to every point of the summary", () => {
    expect(points("1. 5 checks passed, 0 checks failed.\n2. Account holder name matches.")).toEqual(
      ["5 checks passed.", "Account holder name matches."]);
  });
});
