import { act, render, screen } from "@testing-library/react";
import { useState } from "react";
import { AGENTS, loaderLines } from "../config/agents";
import { AgentLoaderProvider, useAgentLoader } from "../shared/agentLoader";
import { Loader } from "../shared/components/Loader";

let setBusy: (b: boolean) => void = () => {};
function Screen() {
  const [busy, set] = useState(false);
  setBusy = set;
  useAgentLoader(busy, "run");
  return <p>screen</p>;
}

describe("the common loader", () => {
  it("covers the agent while it works, with that agent's own lines", () => {
    const fraud = AGENTS.find((a) => a.id === "fraud_screening")!;
    render(
      <AgentLoaderProvider render={(topic) => {
        if (!topic) return null;
        const [label, ...lines] = loaderLines(fraud, topic);
        return <Loader icon={fraud.icon} label={label} lines={lines} overlay />;
      }}>
        <Screen />
      </AgentLoaderProvider>,
    );
    expect(screen.queryByRole("status")).toBeNull();
    act(() => setBusy(true));
    expect(screen.getByRole("status")).toHaveTextContent("Evaluating the application…");
    act(() => setBusy(false));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("does nothing outside the console", () => {
    render(<Screen />);
    act(() => setBusy(true));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("every agent has lines for running its check", () => {
    for (const a of AGENTS) expect(loaderLines(a, "run").length).toBeGreaterThan(1);
  });
});
