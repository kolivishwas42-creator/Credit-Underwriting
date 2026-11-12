import { render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useOptionSpacing } from "../shared/hooks/useOptionSpacing";

function Probe() {
  useOptionSpacing();
  return <select><option>Salary (net)</option><option>Plain</option></select>;
}

describe("option spacing", () => {
  it("puts three spaces before the bracket in a dropdown option", async () => {
    const { container } = render(<Probe />);
    const [a, b] = Array.from(container.querySelectorAll("option"));
    await waitFor(() => expect(a.textContent).toBe("Salary   (net)"));
    expect(b.textContent).toBe("Plain");
  });
});
