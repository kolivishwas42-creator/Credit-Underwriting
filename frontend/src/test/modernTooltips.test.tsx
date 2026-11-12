import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TIP_DELAY_MS, hideTip, useModernTooltips } from "../shared/hooks/useModernTooltips";

function Page() {
  useModernTooltips();
  return (
    <div>
      <button title="Download the report">Download</button>
      <button title="Close panel"><svg /></button>
    </div>
  );
}

// owner 2026-11-12: "hover karne pe bada boring likha aata hai" -- one modern bubble instead of the browser's box
describe("modern hover text", () => {
  afterEach(() => { hideTip(); vi.useRealTimers(); });

  it("shows the title in the bubble after a short delay and gives the title back on leaving", () => {
    vi.useFakeTimers();
    const { getByText } = render(<Page />);
    const btn = getByText("Download");
    fireEvent.mouseOver(btn);
    expect(btn.getAttribute("title")).toBeNull();                 // the browser's own box never shows
    act(() => { vi.advanceTimersByTime(TIP_DELAY_MS + 10); });
    const tip = document.querySelector(".cu-tip")!;
    expect(tip.textContent).toBe("Download the report");
    expect(tip.classList.contains("is-on")).toBe(true);
    expect(btn.getAttribute("aria-describedby")).toBe("cu-tip");
    fireEvent.mouseOut(btn, { relatedTarget: document.body });
    expect(tip.classList.contains("is-on")).toBe(false);
    expect(btn.getAttribute("title")).toBe("Download the report");
  });

  it("an icon-only button keeps its name", () => {
    const { container } = render(<Page />);
    const icon = container.querySelectorAll("button")[1];
    fireEvent.mouseOver(icon);
    expect(icon.getAttribute("aria-label")).toBe("Close panel");
  });
});

describe("hover text with a label", () => {
  it("splits 'label: text' into a bold first line and the rest, as text only", async () => {
    const { fill } = await import("../shared/hooks/useModernTooltips");
    const box = document.createElement("div");
    fill(box, "Open rule R3: Name matches the PAN <b>x</b>");
    expect(box.querySelector(".cu-tip-head")?.textContent).toBe("Open rule R3");
    expect(box.querySelector(".cu-tip-body")?.textContent).toBe("Name matches the PAN <b>x</b>");
    expect(box.querySelector(".cu-tip-body b")).toBeNull();          // never HTML
    fill(box, "Overview of all agents");
    expect(box.textContent).toBe("Overview of all agents");
    expect(box.querySelector(".cu-tip-head")).toBeNull();
  });
});
