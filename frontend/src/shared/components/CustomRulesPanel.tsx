import { useCallback, useEffect, useState, type FormEvent } from "react";
import { RULES_WORDS } from "../../config/rulesSettings";
import { usePagination } from "../hooks/usePagination";
import { customApi, forgetCustomRules, type CustomRule } from "../rules/customRules";
import { Icon } from "./Icon";
import { Pagination } from "./Pagination";

const W = RULES_WORDS.custom;
const OPERATORS = ["gt", "ge", "lt", "le", "eq", "ne"];
const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

/**
 * CUSTOM RULES OF ONE AGENT (owner 2026-11-13: "add rule sab ke liye"): add, switch on / off, change the limit,
 * remove -- saved in the database; the agent's result applies them beside its own rules.
 */
export function CustomRulesPanel({ agent }: { agent: string }) {
  const [rules, setRules] = useState<CustomRule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [limits, setLimits] = useState<Record<string, string>>({});
  const pager = usePagination(rules ?? [], RULES_WORDS.pageSize);

  const load = useCallback(async () => {
    setError(null);
    try { setRules(await customApi.list(agent)); } catch (e) { setRules([]); setError((e as Error).message); }
  }, [agent]);
  useEffect(() => { setRules(null); setAdding(false); void load(); }, [load]);

  const act = async (id: string, run: () => Promise<unknown>) => {
    setBusy(id); setError(null);
    try { await run(); forgetCustomRules(agent); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };

  return (
    <section className="cu-custom" aria-label={W.title}>
      <header className="cu-custom-head">
        <div>
          <h3>{W.title}{rules && <span className="cu-rules-count">{rules.length}</span>}</h3>
          <p>{W.help}</p>
        </div>
        {!adding && <button type="button" className="cu-rules-btn is-primary" onClick={() => setAdding(true)}>+ {W.add}</button>}
      </header>
      {error && <div className="cu-rules-error" role="alert">{error}</div>}
      {adding && <AddCustomForm onCancel={() => setAdding(false)}
        onSave={async (v) => { await customApi.add(agent, v); forgetCustomRules(agent); setAdding(false); await load(); }} />}
      {rules && rules.length === 0 && !adding && <div className="cu-rules-empty">{W.empty}</div>}
      <ul className="cu-rules-list">
        {pager.rows.map((r) => {
          const draft = limits[r.id];
          const sign = RULES_WORDS.operators[r.params.operator] ?? r.params.operator;
          return (
            <li key={r.id} className={`cu-rule is-custom${r.enabled ? "" : " is-off"}`}>
              <div className="cu-rule-top">
                <button type="button" role="switch" aria-checked={r.enabled} aria-label={`${r.name}: ${r.enabled ? RULES_WORDS.on : RULES_WORDS.off}`}
                  className={`cu-switch${r.enabled ? " is-on" : ""}`} disabled={busy === r.id}
                  onClick={() => void act(r.id, () => customApi.change(agent, r.id, { enabled: !r.enabled }))}>
                  <i aria-hidden="true" />
                </button>
                <div className="cu-rule-name">
                  <b>{r.name}</b>
                  <code>{r.id}</code>
                  <span className={`cu-rule-state${r.enabled ? " is-on" : ""}`}>{r.enabled ? RULES_WORDS.on : RULES_WORDS.off}</span>
                  <span className={`cu-custom-outcome is-${r.params.outcome}`}>{W.outcomes[r.params.outcome] ?? r.params.outcome}</span>
                </div>
                <button type="button" className="cu-custom-remove" aria-label={`${W.remove} ${r.name}`} title={W.remove}
                  disabled={busy === r.id}
                  onClick={() => window.confirm(W.confirmRemove(r.name)) && void act(r.id, () => customApi.remove(agent, r.id))}>
                  <Icon name="x" />
                </button>
              </div>
              <p className="cu-rule-desc">{W.when(r.params.field, sign, r.params.value, W.outcomes[r.params.outcome] ?? r.params.outcome)}</p>
              <div className="cu-rule-fields">
                <label>
                  <small>{W.fields.value}</small>
                  <input type="number" step="any" value={draft ?? String(r.params.value)}
                    onChange={(e) => setLimits((l) => ({ ...l, [r.id]: e.target.value }))} />
                </label>
                {draft !== undefined && draft !== "" && Number(draft) !== r.params.value && (
                  <button type="button" className="cu-rules-btn is-primary" disabled={busy === r.id}
                    onClick={() => void act(r.id, async () => {
                      await customApi.change(agent, r.id, { value: Number(draft) });
                      setLimits((l) => { const { [r.id]: _, ...rest } = l; return rest; });
                    })}>{RULES_WORDS.save}</button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {(rules?.length ?? 0) > RULES_WORDS.pageSize && <Pagination pager={pager} noun="custom rules" fixedSize />}
    </section>
  );
}

function AddCustomForm({ onSave, onCancel }: {
  onSave: (v: { rule_id: string; name: string; field: string; operator: string; value: number; outcome: string; severity: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const [v, setV] = useState({ rule_id: "", name: "", field: "", operator: "gt", value: "", outcome: "review", severity: "MEDIUM" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v, x: string) => setV((o) => ({ ...o, [k]: x }));
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await onSave({ ...v, rule_id: v.rule_id.trim().toUpperCase(), value: Number(v.value) });
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  return (
    <form className="cu-rule-add" onSubmit={submit} aria-label={W.add}>
      <div className="cu-rule-add-grid">
        <label className="is-wide"><small>{W.fields.name}</small>
          <input value={v.name} onChange={(e) => set("name", e.target.value)} required minLength={3} /></label>
        <label><small>{W.fields.rule_id}</small>
          <input value={v.rule_id} onChange={(e) => set("rule_id", e.target.value)} required pattern="[Cc][A-Za-z0-9_]{2,40}" /></label>
        <label><small>{W.fields.field}</small>
          <input value={v.field} onChange={(e) => set("field", e.target.value)} required /></label>
        <label><small>{W.fields.operator}</small>
          <select value={v.operator} onChange={(e) => set("operator", e.target.value)}>
            {OPERATORS.map((o) => <option key={o} value={o}>{RULES_WORDS.operators[o] ?? o}</option>)}
          </select></label>
        <label><small>{W.fields.value}</small>
          <input type="number" step="any" value={v.value} onChange={(e) => set("value", e.target.value)} required /></label>
        <label><small>{W.fields.outcome}</small>
          <select value={v.outcome} onChange={(e) => set("outcome", e.target.value)}>
            {Object.entries(W.outcomes).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select></label>
        <label><small>{W.fields.severity}</small>
          <select value={v.severity} onChange={(e) => set("severity", e.target.value)}>
            {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select></label>
      </div>
      {error && <div className="cu-rules-error" role="alert">{error}</div>}
      <div className="cu-rule-add-actions">
        <button type="button" className="cu-rules-btn" onClick={onCancel}>{RULES_WORDS.cancel}</button>
        <button type="submit" className="cu-rules-btn is-primary" disabled={busy}>{W.add}</button>
      </div>
    </form>
  );
}
