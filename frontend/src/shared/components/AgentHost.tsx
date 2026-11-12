import { Fragment, Suspense, useLayoutEffect, type ComponentType, type LazyExoticComponent } from "react";
import { loaderLines, type AgentInfo } from "../../config/agents";
import { AgentLoaderProvider } from "../agentLoader";
import { ErrorBoundary } from "./ErrorBoundary";
import { Loader } from "./Loader";

interface Props {
  agent: AgentInfo;
  Screen: LazyExoticComponent<ComponentType>;
}

/**
 * Hosts one agent's screen. Marks <html> with "agent-<id>" (the agent's stylesheets are scoped to it, see
 * scripts/scope-agent-css.js) and gives it the two boxes it was written for: .agent-host (its old <body>) and
 * .agent-root (its old #root). Only this area scrolls.
 * While the agent reports work (useAgentLoader), the common loader covers the agent's area — outside the scrolling
 * box, so it stays in view wherever the screen is scrolled.
 */
export function AgentHost({ agent, Screen }: Props) {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const cls = `agent-${agent.id}`;
    root.classList.add(cls);
    document.title = `${agent.label} · Credit Underwriting`;
    return () => { root.classList.remove(cls); };
  }, [agent]);

  const [first, ...rest] = loaderLines(agent, "open");
  return (
    <AgentLoaderProvider render={(topic) => {
      if (!topic) return null;
      const [label, ...lines] = loaderLines(agent, topic);
      return <Loader key={topic} icon={agent.icon} label={label} lines={lines} overlay />;
    }}>
      <Fragment>
        <div className={`agent-host${agent.hostClass ? ` ${agent.hostClass}` : ""}`} data-agent={agent.id}>
          <div className="agent-root">
            <ErrorBoundary name={agent.label}>
              <Suspense fallback={<Loader icon={agent.icon} label={first} lines={rest} />}>
                <Screen />
              </Suspense>
            </ErrorBoundary>
          </div>
        </div>
      </Fragment>
    </AgentLoaderProvider>
  );
}
