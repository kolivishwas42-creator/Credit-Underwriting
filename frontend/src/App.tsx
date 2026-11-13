import { useCallback, useEffect, useState } from "react";
import { agentById } from "./config/agents";
import { SCREENS } from "./agents/registry";
import { AgentHost, CommandPalette, Home, TopNav } from "./shared/components";
import { DesignPage } from "./shared/components/DesignPage";
import { useModernTooltips } from "./shared/hooks/useModernTooltips";
import { useOptionSpacing } from "./shared/hooks/useOptionSpacing";

/** The agent in the URL path: /eligibility -> "eligibility"; anything unknown -> the overview. */
function agentFromPath(): string | null {
  const id = window.location.pathname.replace(import.meta.env.BASE_URL, "").split("/")[0];
  return id && agentById(id) ? id : null;
}

/** /design: the common result layout with example data (a living style guide, not in the tabs). */
const onDesignPage = () => window.location.pathname.replace(import.meta.env.BASE_URL, "") === "design";

/** The console: a header with one tab per agent across the top, the open agent's screen under it. */
export default function App() {
  useOptionSpacing();
  useModernTooltips();
  const [active, setActive] = useState<string | null>(agentFromPath);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onPop = () => setActive(agentFromPath());
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen((o) => !o); }
    };
    window.addEventListener("popstate", onPop);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("popstate", onPop); window.removeEventListener("keydown", onKey); };
  }, []);

  // switching agent: a new path, and the old agent's own ?query / #hash do not follow
  const open = useCallback((id: string | null) => {
    window.history.pushState(null, "", `${import.meta.env.BASE_URL}${id ?? ""}`);
    setActive(id);
  }, []);

  const agent = active ? agentById(active) : undefined;
  return (
    <div id="cu-shell" className="cu-shell">
      <TopNav active={active} onOpen={open} onSearch={() => setPaletteOpen(true)} />
      <div className="cu-main" role="main">
        {agent
          ? <AgentHost key={agent.id} agent={agent} Screen={SCREENS[agent.id]} />
          : onDesignPage()
            ? <div className="agent-host"><DesignPage /></div>
            : <Home onOpen={open} />}
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onOpen={open} />
    </div>
  );
}
