import { AgentFrame } from "../../shared/components";
import { BackToForm, FormArea, useResultScreen } from "../../shared/components";
import { useEffect, useState } from "react";
import { CaseCard } from "./components/CaseCard";
import { EntryCard } from "./components/EntryCard";
import { ResultCard } from "./components/ResultCard";
import { api } from "./services/api";
import type { CasePayload, CaseRow, CheckResult, Entry, Form, Inputs } from "./types";
import { collect, emptyGroup, errorText, initialEntry } from "./utils/logic";
import { useAgentLoader } from "../../shared/components";

type Msg = { text: string; ok: boolean } | null;

/** Eligibility check: case data is fetched, the officer enters figures, Save, Trigger. */
export default function App() {
  const [form, setForm] = useState<Form | null>(null);
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [picked, setPicked] = useState("");
  const [typed, setTyped] = useState("");
  const [caseMsg, setCaseMsg] = useState<Msg>(null);
  const [payload, setPayload] = useState<CasePayload | null>(null);
  const [entry, setEntry] = useState<Entry | null>(null);
  const [dirty, setDirty] = useState(false);
  const [entryMsg, setEntryMsg] = useState<Msg>(null);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [checked, setChecked] = useState<Inputs | null>(null);   // the figures the shown result was checked with
  const [busy, setBusy] = useState(false);
  useAgentLoader(busy, "run");

  useEffect(() => {
    (async () => {
      try {
        setForm(await api.form());
        setCases((await api.cases()).cases || []);
      } catch (e) {
        setCaseMsg({ text: errorText(e), ok: false });
      }
    })();
  }, []);

  // a case asked for before the form config arrived is loaded as soon as it does (the click is never lost)
  const [waiting, setWaiting] = useState("");
  useEffect(() => {
    if (form && waiting) { const id = waiting; setWaiting(""); void loadCase(id); }
  }, [form, waiting]);   // eslint-disable-line react-hooks/exhaustive-deps

  async function loadCase(raw: string) {
    const id = (raw || "").trim();
    if (!id) return;
    if (!form) { setWaiting(id); return; }
    setCaseMsg(null);
    try {
      const p = await api.getCase(id);
      setPayload(p);
      setEntry(initialEntry(form, p));
      setDirty(false);
      setResult(null);
      setEntryMsg(null);
      setTyped(id);
    } catch (e) {
      setCaseMsg({ text: errorText(e), ok: false });
      setPayload(null);
      setEntry(null);
    }
  }

  const change = (patch: Partial<Entry>) => {
    setEntry((e) => (e ? { ...e, ...patch } : e));
    setDirty(true);
  };

  async function save() {
    if (!payload || !entry || !form) return;
    setEntryMsg(null);
    try {
      const saved = await api.save(payload.case_id, collect(form, entry));
      setPayload({ ...payload, saved });
      setDirty(false);
      setEntryMsg({ text: "Saved.", ok: true });
    } catch (e) {
      setEntryMsg({ text: errorText(e), ok: false });
    }
  }

  async function trigger() {
    if (!payload || !entry || !form) return;
    setEntryMsg(null);
    setBusy(true);
    try {
      // what is on screen is what is checked (saved or not); nothing entered -> the saved entries
      const inputs = collect(form, entry);
      setResult(await api.check(payload.case_id, inputs));
      setChecked(inputs);
      if (dirty) setEntryMsg({ text: "Checked the figures on screen — they are not saved yet.", ok: true });
    } catch (e) {
      setEntryMsg({ text: errorText(e), ok: false });
    } finally {
      setBusy(false);
    }
  }

  const screen = useResultScreen(result);
  const saveNote = dirty
    ? "Unsaved changes"
    : payload?.saved ? `Saved ${new Date(payload.saved.saved_at).toLocaleString()}` : "Nothing saved yet";

  return (
    <AgentFrame agent="eligibility" caseLabel={payload?.case_id} items={[
      { id: "form", label: "Case & figures", icon: "file-check", active: !screen.onResult, onSelect: screen.back },
      ...(screen.hasResult ? [{ id: "result", label: "Result", icon: "sparkle", active: screen.onResult, onSelect: screen.show }] : []),
    ]}>
      <main>
        <FormArea hidden={screen.onResult}>
        <CaseCard form={form} cases={cases} picked={picked} typed={typed} msg={caseMsg} payload={payload}
                  onPick={(id) => { setPicked(id); loadCase(id); }} onType={setTyped}
                  onFetch={() => loadCase(typed || picked)} />
        {form && entry && (
          <EntryCard form={form} entry={entry} onChange={change}
                     onMethod={(m) => change({ incomeMethod: m, income: emptyGroup(form, "income", m) })}
                     onTopup={(t) => change({ topupType: t, topup: emptyGroup(form, "topup", t) })}
                     saveNote={saveNote} msg={entryMsg} busy={busy} onSave={save} onTrigger={trigger} />
        )}
        </FormArea>
        {entry && result && screen.onResult && <BackToForm onBack={screen.back} note={payload?.case_id} />}
        {entry && result && screen.onResult && (
          <ResultCard r={result} ctx={{
            product: checked?.product,
            requested: [checked?.requested_amount, payload?.saved?.inputs?.requested_amount, payload?.case?.requested_amount]
              .find((v): v is number => typeof v === "number") ?? null,
          }} />
        )}
      </main>
    </AgentFrame>
  );
}
