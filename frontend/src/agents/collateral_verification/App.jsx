import { AgentFrame } from "../../shared/components";
import { BackToForm, FormArea, useResultScreen } from "../../shared/components";
import { useEffect, useState } from "react";
import VerifyForm from "./components/VerifyForm.jsx";
import ResultsPanel from "./components/ResultsPanel.jsx";
import RulesConfigTab from "./components/RulesConfigTab.jsx";
import { api } from "./api.js";
import { useAgentLoader } from "../../shared/components";

async function readError(response) {
  try {
    const body = await response.json();
    return body.detail || "Request failed";
  } catch {
    return "Request failed";
  }
}

export default function App() {
  const [applicationNumber, setApplicationNumber] = useState("");
  const [finalStatus, setFinalStatus] = useState("approved");
  const [statuses, setStatuses] = useState(["approved", "rejected"]);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  useAgentLoader(busy, "run");
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const screen = useResultScreen(result);
  const [sourceLabel, setSourceLabel] = useState("");
  const [tolerancePp, setTolerancePp] = useState(null);
  const [activeTab, setActiveTab] = useState("verify");

  useEffect(() => {
    fetch(api("/config"))
      .then((r) => {
        if (!r.ok) throw new Error(`config ${r.status}`);   // a 404 / 500 body is not a config
        return r.json();
      })
      .then((cfg) => {
        setStatuses(cfg.vendor_final_statuses || ["approved", "rejected"]);
        setTolerancePp(cfg.completion_tolerance_pp ?? null);
        // plain words only: the tolerance the check uses; a problem only when there is one
        const tolerance = cfg.completion_tolerance_pp != null ? `Completion tolerance ${cfg.completion_tolerance_pp} pp` : "";
        setSourceLabel(cfg.database_configured ? tolerance : "Records not available right now");
      })
      .catch(() => setSourceLabel("Service not available right now"));
  }, []);

  async function send() {
    setError("");
    setBusy(true);
    const body = new FormData();
    const ident = applicationNumber.trim();
    if (/^\d+$/.test(ident)) body.set("application_id", ident);
    else body.set("application_number", ident);
    body.set("final_status", finalStatus);
    if (file) body.set("report", file);
    else {
      setError("Choose a report.");
      setBusy(false);
      return;
    }
    try {
      const response = await fetch(api("/collateral/verify"), { method: "POST", body });
      if (!response.ok) throw new Error(await readError(response));
      setResult(await response.json());
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AgentFrame agent="collateral_verification" caseLabel={result ? applicationNumber : undefined} footer={sourceLabel || undefined}
      items={[
        { id: "verify", label: "Verify", icon: "file-check", active: activeTab === "verify" && !screen.onResult,
          onSelect: () => { setActiveTab("verify"); screen.back(); } },
        // "Rules Config" sidebar item hidden for now (owner request) -- uncomment to show it again.
        // { id: "rules", label: "Rules Config", icon: "list", active: activeTab === "rules", onSelect: () => setActiveTab("rules") },
        ...(screen.hasResult ? [{ id: "result", label: "Result", icon: "sparkle", active: activeTab === "verify" && screen.onResult,
          onSelect: () => { setActiveTab("verify"); screen.show(); } }] : []),
      ]}>
    <div className="page">
      {activeTab === "rules" ? (
        <RulesConfigTab />
      ) : (
        <>
        <FormArea hidden={screen.onResult} className={result ? "layout has-result" : "layout"}>
          <VerifyForm
            applicationNumber={applicationNumber}
            setApplicationNumber={setApplicationNumber}
            finalStatus={finalStatus}
            setFinalStatus={setFinalStatus}
            statuses={statuses}
            file={file}
            setFile={setFile}
            busy={busy}
            error={error}
            onSubmit={(e) => { e.preventDefault(); send(); }}
          />
          {!result && <ResultsPanel result={null} />}
        </FormArea>
        {/* the result takes the full width under the form (common result layout) */}
        {result && screen.onResult && <BackToForm onBack={screen.back} note={applicationNumber} />}
        {result && screen.onResult && <ResultsPanel result={result} tolerancePp={tolerancePp} />}
        </>
      )}
    </div>
    </AgentFrame>
  );
}
