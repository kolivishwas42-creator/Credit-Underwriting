import { AgentFrame } from "../../shared/components";
import { useCallback, useEffect, useRef, useState } from "react";
import { HistoryTab } from "./components/HistoryTab";
import { RulesTab } from "./components/RulesTab";
import { ValuationTab } from "./components/ValuationTab";
import { api } from "./services/api";

type Tab = "valuation" | "rules" | "history";
// "Rule configuration" sidebar item hidden for now (owner request) -- uncomment to show it again.
const TABS: [Tab, string][] = [["valuation", "Valuation workflow"], /* ["rules", "Rule configuration"], */ ["history", "History & analytics"]];
const TAB_ICON: Record<Tab, string> = { valuation: "building", rules: "list", history: "clock" };

/** a short message at the bottom of the screen for 3.5 s */
function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const toast = useCallback((m: string) => {
    setMsg(m);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), 3500);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return { msg, toast };
}

/** Property Valuation Agent: valuation workflow, rule configuration, history. */
export default function App() {
  const [tab, setTab] = useState<Tab>("valuation");
  const [rulesOpened, setRulesOpened] = useState(0);
  const [apiState, setApiState] = useState<"checking" | "ok" | "down">("checking");
  const { msg, toast } = useToast();

  useEffect(() => {
    api.health().then(() => setApiState("ok")).catch(() => setApiState("down"));
  }, []);

  return (
    <AgentFrame agent="property_valuation"
      footer={apiState === "down" ? <span role="status" style={{ color: "var(--error-text)" }}>Service not available right now</span> : undefined}
      items={TABS.map(([id, label]) => ({ id, label, icon: TAB_ICON[id], active: tab === id,
        onSelect: () => { setTab(id); if (id === "rules") setRulesOpened((n) => n + 1); } }))}>
      <div className="wrap">
        {/* every tab stays mounted (hidden when not chosen), so what was typed survives a tab switch */}
        <div className={tab === "valuation" ? "" : "hidden"}><ValuationTab toast={toast} /></div>
        <section id="rules" className={tab === "rules" ? "" : "hidden"}><RulesTab toast={toast} opened={rulesOpened} /></section>
        <section id="history" className={tab === "history" ? "" : "hidden"}><HistoryTab toast={toast} /></section>
      </div>
      <div id="toast" role="status" style={{ display: msg ? "block" : "none" }}>{msg}</div>
    </AgentFrame>
  );
}
