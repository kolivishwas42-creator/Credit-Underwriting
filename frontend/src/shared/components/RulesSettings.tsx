import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { RULES_SETTINGS_VISIBLE, RULES_SOURCES, RULES_WORDS as W } from "../../config/rulesSettings";
import { usePagination } from "../hooks/usePagination";
import { addRule, loadSet, saveRule, type RuleChange, type RuleView, type Template } from "../rules/rulesApi";
import { CustomRulesPanel } from "./CustomRulesPanel";
import { Icon } from "./Icon";
import { Pagination } from "./Pagination";

/**
 * THE COMMON RULES SCREEN (owner 2026-11-12): every agent's rules in one look -- on / off (a rule that sums the others
 * up shows "Always on"), severity, the numbers (limits, tolerances, weights) a rule uses, and -- where rules are data
 * (Dedupe, Customer history) -- Add rule from a template. Which API and which fields: config/rulesSettings.ts.
 */
export function hasRulesSettings(agent: string, visible: boolean = RULES_SETTINGS_VISIBLE): boolean {
  return visible && Boolean(RULES_SOURCES[agent]);
}

export function RulesSettings({ agent, onBack }: { agent: string; onBack?: () => void }) {
  const src = RULES_SOURCES[agent];
  const [group, setGroup] = useState(src?.groups?.values[0]?.value);
  const [rules, setRules] = useState<RuleView[] | null>(null);
  const [templates, setTemplates] = useState<Record<string, Template>>({});
  const [onLabel, setOnLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [drafts, setDrafts] = useState<Record<string, RuleChange>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    if (!src) return;
    setRules(null); setError(null); setDrafts({}); setAdding(false);
    try {
      const set = await loadSet(src, group);
      setRules(set.rules); setTemplates(set.templates); setOnLabel(set.onLabel);
    } catch (e) { setError((e as Error).message); }
  }, [src, group]);
  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rules ?? []).filter((r) => !q || `${r.name} ${r.code} ${r.description}`.toLowerCase().includes(q));
  }, [rules, query]);
  // PAGES (owner 2026-11-13: "pagination bhi chahiye"): a long list is paged, not scrolled
  const pager = usePagination(shown, W.pageSize);

  if (!src) return null;
  const onCount = (rules ?? []).filter((r) => r.enabled).length;
  const onWord = onLabel || W.on;
  const firstTemplate = Object.keys(templates)[0];

  const apply = async (rule: RuleView, change: RuleChange) => {
    setBusy(rule.key); setError(null);
    try {
      await saveRule(src, rule, change, group);
      // show what was saved without a full reload
      setRules((all) => (all ?? []).map((r) => (r.key !== rule.key ? r : {
        ...r,
        enabled: change.enabled ?? r.enabled,
        severity: change.severity ?? r.severity,
        numbers: r.numbers.map((n) => ({ ...n, value: change.numbers?.[n.id] ?? n.value })),
      })));
      setDrafts((d) => { const { [rule.key]: _, ...rest } = d; return rest; });
      setSavedKey(rule.key);
      window.setTimeout(() => setSavedKey((k) => (k === rule.key ? null : k)), 1800);
    } catch (e) {
      setError(`${rule.name}: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const draft = (key: string, part: RuleChange) =>
    setDrafts((d) => ({ ...d, [key]: { ...d[key], ...part, numbers: { ...d[key]?.numbers, ...part.numbers } } }));

  return (
    <section className="cu-rules" aria-label={W.title}>
      <header className="cu-rules-head">
        <div>
          <h2>{W.title}</h2>
          <p>{W.subtitle}</p>
        </div>
        <div className="cu-rules-tools">
          {rules && <span className="cu-rules-count">{W.counts(onCount, rules.length)}</span>}
          {firstTemplate && !adding && (
            <button type="button" className="cu-rules-btn is-primary" onClick={() => setAdding(true)}>+ {W.add}</button>
          )}
          <button type="button" className="cu-rules-btn" onClick={() => void load()}><Icon name="refresh" />{W.reload}</button>
          {onBack && <button type="button" className="cu-rules-btn" onClick={onBack}>{W.back}</button>}
        </div>
      </header>

      <div className="cu-rules-bar">
        {src.groups && (
          <div className="cu-rules-groups" role="tablist">
            {src.groups.values.map((g) => (
              <button key={g.value} type="button" role="tab" aria-selected={group === g.value}
                className={group === g.value ? "is-on" : ""} onClick={() => setGroup(g.value)}>{g.label}</button>
            ))}
          </div>
        )}
        <label className="cu-rules-search">
          <Icon name="search" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={W.search} aria-label={W.search} />
        </label>
      </div>

      {error && <div className="cu-rules-error" role="alert">{error}</div>}
      {adding && firstTemplate && (
        <AddRuleForm template={templates[firstTemplate]}
          onCancel={() => setAdding(false)}
          onSave={async (values) => {
            await addRule(src, firstTemplate, values, group);
            await load();
            setSavedKey(String(values.rule_id ?? "").toUpperCase());
          }} />
      )}
      {!rules && !error && <div className="cu-rules-empty">{W.loading}</div>}
      {rules && shown.length === 0 && <div className="cu-rules-empty">{W.empty}</div>}

      <ul className="cu-rules-list">
        {pager.rows.map((r) => {
          const d = drafts[r.key];
          const dirty = Boolean(d && (d.severity !== undefined || Object.keys(d.numbers ?? {}).length));
          return (
            <li key={r.key} className={`cu-rule${r.enabled ? "" : " is-off"}`}>
              <div className="cu-rule-top">
                <button type="button" role="switch" aria-checked={r.enabled}
                  aria-label={`${r.name}: ${r.locked ? W.locked : r.enabled ? onWord : W.off}`}
                  className={`cu-switch${r.enabled ? " is-on" : ""}${r.locked ? " is-locked" : ""}`}
                  disabled={busy === r.key || r.locked}
                  title={r.locked ? W.locked : undefined}
                  onClick={() => void apply(r, { enabled: !r.enabled })}>
                  <i aria-hidden="true" />
                </button>
                <div className="cu-rule-name">
                  <b>{r.name}</b>
                  {r.code && r.code !== r.name && <code>{r.code}</code>}
                  <span className={`cu-rule-state${r.enabled ? " is-on" : ""}`}>{r.locked ? W.locked : r.enabled ? onWord : W.off}</span>
                  {savedKey === r.key && <span className="cu-rule-saved"><Icon name="check" />{W.saved}</span>}
                </div>
              </div>
              {r.description && r.description !== r.name && <p className="cu-rule-desc">{r.description}</p>}
              {((r.severity !== null && src.severityChoices) || r.numbers.length > 0) && (
                <div className="cu-rule-fields">
                  {r.severity !== null && src.severityChoices && (
                    <label>
                      <small>{W.severity}</small>
                      <select value={d?.severity ?? r.severity ?? ""} onChange={(e) => draft(r.key, { severity: e.target.value })}>
                        {/* the choices in the agent's own case ("critical" for ITR, "CRITICAL" elsewhere): never two of one */}
                        {[...new Set([...(r.severity ? [r.severity] : []),
                          ...src.severityChoices.map((s) => (r.severity && r.severity === r.severity.toLowerCase() ? s.toLowerCase() : s))])].map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  {r.numbers.map((n) => (
                    <label key={n.id}>
                      <small>{n.label}</small>
                      <input type="number" step={n.step ?? "any"} value={d?.numbers?.[n.id] ?? n.value}
                        onChange={(e) => e.target.value !== "" && draft(r.key, { numbers: { [n.id]: Number(e.target.value) } })} />
                    </label>
                  ))}
                  {dirty && (
                    <button type="button" className="cu-rules-btn is-primary" disabled={busy === r.key}
                      onClick={() => void apply(r, d!)}>{W.save}</button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {shown.length > W.pageSize && <Pagination pager={pager} noun="rules" fixedSize />}
      <CustomRulesPanel agent={agent} />
    </section>
  );
}

/** Add a rule from a template: the fields the template names, choices where it gives them (signals, comparisons,
 *  severities). The server checks the new rule with the agent's own validator before saving it. */
function AddRuleForm({ template, onSave, onCancel }: {
  template: Template; onSave: (values: Record<string, unknown>) => Promise<void>; onCancel: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setValues((x) => ({ ...x, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    const out: Record<string, unknown> = { ...values };
    if (out.threshold !== undefined && out.threshold !== "") {
      const s = String(out.threshold).trim().toLowerCase();
      out.threshold = s === "true" ? true : s === "false" ? false : Number.isNaN(Number(s)) ? out.threshold : Number(s);
    }
    try { await onSave(out); onCancel(); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };

  const choices = (k: string): string[] | null =>
    k === "signal" ? template.signals : k === "operator" ? template.operators : k === "severity" ? template.severities : null;

  return (
    <form className="cu-rule-add" onSubmit={submit} aria-label={W.addTitle}>
      <h3>{W.addTitle}</h3>
      <p>{W.addHelp}</p>
      <div className="cu-rule-add-grid">
        {template.fields.map((k) => {
          const opts = choices(k);
          const label = W.fields[k] ?? k;
          return (
            <label key={k} className={k === "description" || k === "next_action" ? "is-wide" : undefined}>
              <small>{label}</small>
              {opts && opts.length ? (
                <select value={values[k] ?? ""} onChange={(e) => set(k, e.target.value)} required>
                  <option value="">—</option>
                  {opts.map((o) => <option key={o} value={o}>{k === "operator" ? (W.operators[o] ?? o) : o}</option>)}
                </select>
              ) : (
                <input value={values[k] ?? ""} onChange={(e) => set(k, e.target.value)} required
                  inputMode={k === "threshold" ? "decimal" : undefined} />
              )}
            </label>
          );
        })}
      </div>
      {error && <div className="cu-rules-error" role="alert">{error}</div>}
      <div className="cu-rule-add-actions">
        <button type="button" className="cu-rules-btn" onClick={onCancel}>{W.cancel}</button>
        <button type="submit" className="cu-rules-btn is-primary" disabled={busy}>{W.addSave}</button>
      </div>
    </form>
  );
}
