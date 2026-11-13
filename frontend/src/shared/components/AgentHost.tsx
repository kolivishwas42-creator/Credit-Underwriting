import { Fragment, Suspense, useLayoutEffect, type ComponentType, type LazyExoticComponent } from "react";
import { loaderLines, type AgentInfo } from "../../config/agents";
// import { RULES_SOURCES, RULES_WORDS } from "../../config/rulesSettings";
import { AgentLoaderProvider } from "../agentLoader";
import { ErrorBoundary } from "./ErrorBoundary";
// import { Icon } from "./Icon";
import { Loader } from "./Loader";
// import { RulesSettings, hasRulesSettings } from "./RulesSettings";

// Hidden for now (owner request) -- uncomment this panel, its imports above and <RulesPanel /> below to show it again.
// /** RULES SETTINGS for an agent with its own sidebar (Crime, Dedupe, Document Desk, Legal): a button that opens the
//  *  common Rules screen as a panel over the agent (the agent stays as it was underneath). Shown only when the Rules
//  *  screen is switched on (config/rulesSettings.ts RULES_SETTINGS_VISIBLE). */
// function RulesPanel({ agent }: { agent: string }) {
//   const [open, setOpen] = useState(false);
//   if (!hasRulesSettings(agent) || RULES_SOURCES[agent]?.entry !== "panel") return null;
//   return (
//     <>
//       <button type="button" className="cu-rules-open" onClick={() => setOpen(true)} aria-haspopup="dialog">
//         <Icon name="sliders" />{RULES_WORDS.menu}
//       </button>
//       {open && (
//         <div className="cu-rules-panel" role="dialog" aria-modal="true" aria-label={RULES_WORDS.title}
//              onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
//           <div className="cu-rules-panel-box"><RulesSettings agent={agent} onBack={() => setOpen(false)} /></div>
//         </div>
//       )}
//     </>
//   );
// }

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
            {/* "Rules settings" button hidden for now (owner request) -- uncomment to show it again. */}
            {/* <RulesPanel agent={agent.id} /> */}
          </div>
        </div>
      </Fragment>
    </AgentLoaderProvider>
  );
}
