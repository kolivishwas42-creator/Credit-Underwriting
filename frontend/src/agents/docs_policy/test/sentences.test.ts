import { sentences } from "../utils/resultView";

describe("brief text -> points", () => {
  it("a numbered list gives one point per item, without the numbers", () => {
    expect(sentences("1. The missing PAN of the applicant needs to be provided. 2. The case has a critical item open. 3. Next step: ask the customer."))
      .toEqual(["The missing PAN of the applicant needs to be provided.", "The case has a critical item open.", "Next step: ask the customer."]);
  });
  it("plain prose splits at sentence ends and keeps abbreviations whole", () => {
    expect(sentences("Bank statement is 2 months old. Ask for a fresh one (Rs. 5 lakh limit)."))
      .toEqual(["Bank statement is 2 months old.", "Ask for a fresh one (Rs. 5 lakh limit)."]);
  });
  it("lines are points", () => {
    expect(sentences("• one point\n- another one")).toEqual(["one point", "another one"]);
  });
});
