import { AgentFrame } from "../../shared/components";
import { useState } from "react";   // + useEffect for the hidden Rule configuration tab
import { BackToForm, FormArea, ResultPage, useAgentLoader, useResultScreen } from "../../shared/components";
// import { RuleConfigTable } from "./components/Rules";   // the hidden Rule configuration tab
import { ScreenTab } from "./components/Screening";
import { api } from "./services/api";
import type { Evaluation } from "./types";   // + RuleConfig for the hidden Rule configuration tab
import { toResultPage } from "./utils/resultView";
import { screenCount } from "./utils/screening";

/** Loan Fraud Check: evaluate an application (rules + AML + PEP), read the results. (Rule configuration is hidden.) */
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
  // "Rule configuration" tab hidden (owner request): its state, loader and switch are kept commented -- uncomment these,
  // the imports above and the tab entry below to show it again.
  // const [rules, setRules] = useState<RuleConfig[]>([]);
  // const [pending, setPending] = useState<Set<string>>(new Set());
  //
  // useEffect(() => {
  //   api.rules().then(setRules).catch((e) => console.warn(e));
  // }, []);

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

  // async function toggle(rule: RuleConfig, enabled: boolean) {
  //   const flip = (on: boolean) => setRules((rs) => rs.map((r) => (r.rule_key === rule.rule_key ? { ...r, enabled: on } : r)));
  //   const lock = (on: boolean) => setPending((p) => {
  //     const next = new Set(p);
  //     if (on) next.add(rule.rule_key); else next.delete(rule.rule_key);
  //     return next;
  //   });
  //   flip(enabled);
  //   lock(true);
  //   try {
  //     await api.setRule(rule.rule_key, enabled);
  //   } catch (e) {
  //     window.alert((e as Error).message || "Update failed");
  //     flip(!enabled);
  //   } finally {
  //     lock(false);
  //   }
  // }

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
          {/* the common result layout; AML / PEP records, rule switches and the raw answer are tabs in its rail */}
          <ResultPage {...toResultPage(data)} extraTabs={[
            { id: "aml", label: "AML screening", icon: "shield", count: screenCount(data.aml),
              content: <div className="fs-extras" id="tab-aml"><ScreenTab key={run} kind="aml" data={data.aml} /></div> },
            { id: "pep", label: "PEP check", icon: "flag", count: screenCount(data.pep),
              content: <div className="fs-extras" id="tab-pep"><ScreenTab key={run} kind="pep" data={data.pep} /></div> },
            // { id: "config", label: "Rule configuration", icon: "key",
            //   content: <div className="fs-extras"><RuleConfigTable rules={rules} pending={pending} onToggle={toggle} /></div> },
          ]} />
        </div>
      )}
    </div>
    </AgentFrame>
  );
}
