import { useEffect, useState } from "react";
import { SEVERITIES } from "../config/forms";
import { api } from "../services/api";
import type { RuleConfig } from "../types";
import { Pagination, usePagination } from "../../../shared/components";

/** one rule: enabled, severity, order, settings and field mapping (JSON); Save writes it to the database */
function RuleRow({ rule, toast }: { rule: RuleConfig; toast: (m: string) => void }) {
  const [enabled, setEnabled] = useState(rule.enabled);
  const [severity, setSeverity] = useState(SEVERITIES.includes(rule.severity) ? rule.severity : SEVERITIES[0]);
  const [sequence, setSequence] = useState(String(rule.sequence));
  const [settings, setSettings] = useState(JSON.stringify(rule.settings || {}, null, 2));
  const [fields, setFields] = useState(JSON.stringify(rule.fields || {}, null, 2));
  const id = `rule-${rule.rule_key}`;

  async function save() {
    try {
      await api.saveRule(rule.rule_key, {
        enabled, severity, sequence: Number(sequence),
        settings: JSON.parse(settings || "{}"), fields: JSON.parse(fields || "{}"),
      });
      toast(rule.rule_key + " saved to database.");
    } catch (e) {
      toast("Could not save " + rule.rule_key + ": " + (e as Error).message);
    }
  }

  return (
    <div className="rule-row">
      <div>
        <div className="rule-name">{rule.rule_key} · {rule.name}</div>
        <div className="muted small">{rule.original_id} · {rule.description || ""}</div>
      </div>
      <label className="check">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Enabled
      </label>
      <div className="field">
        <label htmlFor={id + "-sev"}>Severity</label>
        <select id={id + "-sev"} value={severity} onChange={(e) => setSeverity(e.target.value)}>
          {SEVERITIES.map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor={id + "-seq"}>Order</label>
        <input id={id + "-seq"} type="number" min={1} value={sequence} onChange={(e) => setSequence(e.target.value)} />
      </div>
      <div className="field settings">
        <label htmlFor={id + "-set"}>Rule settings / thresholds (JSON)</label>
        <textarea id={id + "-set"} className="json-settings" value={settings} onChange={(e) => setSettings(e.target.value)} />
        <details style={{ marginTop: 7 }}>
          <summary>Field mapping</summary>
          <textarea aria-label={`${rule.rule_key} field mapping`} className="json-fields json-settings" value={fields}
                    onChange={(e) => setFields(e.target.value)} />
        </details>
      </div>
      <button className="btn secondary save-rule" onClick={save}>Save</button>
    </div>
  );
}

/** Rule configuration: loads every time the tab opens (and on Reload) */
export function RulesTab({ toast, opened }: { toast: (m: string) => void; opened: number }) {
  const [state, setState] = useState<{ loading: boolean; rules: RuleConfig[]; error: string | null; n: number }>(
    { loading: true, rules: [], error: null, n: 0 });

  async function load() {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const rules = await api.rules();
      setState((s) => ({ loading: false, rules, error: null, n: s.n + 1 }));
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: (e as Error).message }));
    }
  }

  useEffect(() => { if (opened) load(); }, [opened]);
  const pager = usePagination(state.rules);

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h2 className="section-title">Property valuation rule configuration</h2>
          <p className="muted small">
            Changes made here are saved and used from the next valuation check.
          </p>
        </div>
        <button className="btn secondary" onClick={load}>Reload rules</button>
      </div>
      <div id="rulesList">
        {state.loading ? "Loading rules…"
          : state.error ? <div className="alert error">{state.error}</div>
          : pager.rows.map((r) => <RuleRow key={`${state.n}-${r.rule_key}`} rule={r} toast={toast} />)}
      </div>
      {!state.loading && !state.error && <Pagination pager={pager} noun="rules" />}
    </div>
  );
}
