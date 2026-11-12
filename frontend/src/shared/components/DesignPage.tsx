import { useLayoutEffect } from "react";
import { AGENTS, loaderLines } from "../../config/agents";
import { Loader } from "./Loader";
import { ResultPage } from "./result";
import { EXAMPLE_RESULT, scaledExample } from "./result/example";

/**
 * /design — a living style guide: every agent's loader (its emblem, its "run" line) and the common result layout
 * with example data. Not in the tabs.
 *   /design?show=loaders          every agent's loader
 *   /design?rules=200&calcs=100&points=40   the layout with that many rules / values / summary points (scale check)
 */
export function DesignPage() {
  useLayoutEffect(() => { document.title = "Design · Credit Underwriting"; }, []);
  const q = new URLSearchParams(window.location.search);
  if (q.get("show") === "loaders") {
    return (
      <div className="cu-design cu-design-loaders">
        {AGENTS.map((a) => {
          const [label] = loaderLines(a, "run");
          return (
            <div key={a.id} className="cu-design-loader">
              <Loader icon={a.icon} label={label} compact />
              <span>{a.label}</span>
            </div>
          );
        })}
      </div>
    );
  }
  const n = (k: string) => Math.max(0, Math.min(2000, Number(q.get(k)) || 0));
  const props = q.get("rules") || q.get("calcs") || q.get("points")
    ? scaledExample(n("rules") || 12, n("calcs") || 6, n("points") || 4)
    : EXAMPLE_RESULT;
  return (
    <div className="cu-design">
      <ResultPage {...props} />
    </div>
  );
}
