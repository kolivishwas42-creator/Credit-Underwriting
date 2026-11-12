import { AgentFrame } from "../../shared/components";
import { useEffect, useState } from "react";
import { BackToForm, FormArea, ResultPage, useAgentLoader, useResultScreen } from "../../shared/components";
import { RuleConfigTable } from "./components/Rules";
import { ScreenTab } from "./components/Screening";
import { api } from "./services/api";
import type { Evaluation, RuleConfig } from "./types";
import { toResultPage } from "./utils/resultView";
import { screenCount } from "./utils/screening";

type Tab = "aml" | "pep" | "config" | "raw";

function Count({ n }: { n: number }) {
  return <span className={"count" + (n === 0 ? " zero" : "")}>{n}</span>;
}

/** Loan Fraud Check: evaluate an application (rules + AML + PEP), read the results, switch rules on and off. */
export default function App() {
  const [appNum, setAppNum] = useState("");
  const [runAml, setRunAml] = useState(true);
  const [runPep, setRunPep] = useState(true);
  const [busy, setBusy] = useState(false);
  useAgentLoader(busy, "run");
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Evaluation | null>(null);
  const [run, setRun] = useState(0);              // a new evaluation collapses the lower-scoring records again
  const [tab, setTab] = useState<Tab>("aml");
  const [rules, setRules] = useState<RuleConfig[]>([]);
  const [pending, setPending] = useState<Set<string>>(new Set());

  useEffect(() => {
    api.rules().then(setRules).catch((e) => console.warn(e));
  }, []);

  async function evaluate() {
    const num = appNum.trim();
    setError(null);
    if (!num) { setError("Enter an application number."); return; }
    setBusy(true);
    setStatus("Evaluating…");
    try {
      setData(await api.evaluate(num, runAml, runPep));
      setRun((n) => n + 1);
      setStatus("");                                  // the result itself says it is done
    } catch (e) {
      setError(String((e as Error).message || e));
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(rule: RuleConfig, enabled: boolean) {
    const flip = (on: boolean) => setRules((rs) => rs.map((r) => (r.rule_key === rule.rule_key ? { ...r, enabled: on } : r)));
    const lock = (on: boolean) => setPending((p) => {
      const next = new Set(p);
      if (on) next.add(rule.rule_key); else next.delete(rule.rule_key);
      return next;
    });
    flip(enabled);
    lock(true);
    try {
      await api.setRule(rule.rule_key, enabled);
    } catch (e) {
      window.alert((e as Error).message || "Update failed");
      flip(!enabled);
    } finally {
      lock(false);
    }
  }

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "aml", label: "AML screening", count: screenCount(data?.aml) },
    { id: "pep", label: "PEP check", count: screenCount(data?.pep) },
    { id: "config", label: "Rule configuration" },
    { id: "raw", label: "Raw JSON" },
  ];

  const screen = useResultScreen(data);
  return (
    <AgentFrame agent="fraud_screening" caseLabel={data ? appNum : undefined} items={[
      { id: "form", label: "Evaluate", icon: "search", active: !screen.onResult, onSelect: screen.back },
      ...(screen.hasResult ? [{ id: "result", label: "Result", icon: "sparkle", active: screen.onResult, onSelect: screen.show }] : []),
    ]}>
    <div className="wrap">

      <FormArea hidden={screen.onResult}>
      <div className="card">
        <h2>Evaluate application</h2>
        <label htmlFor="appNum">Application number</label>
        <input id="appNum" type="text" placeholder="e.g. APP-2024-000123" autoComplete="off" value={appNum}
               onChange={(e) => setAppNum(e.target.value)} />
        <div className="row">
          <label className="chk"><input type="checkbox" checked={runAml} onChange={(e) => setRunAml(e.target.checked)} /> Run AML</label>
          <label className="chk"><input type="checkbox" checked={runPep} onChange={(e) => setRunPep(e.target.checked)} /> Run PEP</label>
          <button className="primary" disabled={busy} onClick={evaluate}>Evaluate</button>
          <span className="hint" role="status">{status}</span>
        </div>
      </div>
      </FormArea>

      {error && <div className="error" role="alert">{error}</div>}

      {data && screen.onResult && <BackToForm onBack={screen.back} note={appNum} />}
      {data && screen.onResult && (
        <div id="resultArea">
          {/* the common result layout; AML / PEP records, rule switches and the raw answer stay as tabs under it */}
          <ResultPage {...toResultPage(data)}>
            <div className="fs-extras">
              <div className="tabs" role="tablist">
                {tabs.map((t) => (
                  <button key={t.id} role="tab" aria-selected={tab === t.id} className={"tab-btn" + (tab === t.id ? " active" : "")}
                          onClick={() => setTab(t.id)}>
                    {t.label}{t.count !== undefined && <> <Count n={t.count} /></>}
                  </button>
                ))}
              </div>

              {/* every pane stays mounted (hidden when not chosen), so an expanded list survives a tab switch */}
              <div className={"tab-pane" + (tab === "aml" ? "" : " hidden")} id="tab-aml"><ScreenTab key={run} kind="aml" data={data.aml} /></div>
              <div className={"tab-pane" + (tab === "pep" ? "" : " hidden")} id="tab-pep"><ScreenTab key={run} kind="pep" data={data.pep} /></div>
              <div className={tab === "config" ? "" : "hidden"}>
                <RuleConfigTable rules={rules} pending={pending} onToggle={toggle} />
              </div>
              <div className={"card tab-pane" + (tab === "raw" ? "" : " hidden")} id="tab-raw">
                <h2>Raw response</h2>
                <pre>{JSON.stringify(data, null, 2)}</pre>
              </div>
            </div>
          </ResultPage>
        </div>
      )}
    </div>
    </AgentFrame>
  );
}
