import { api } from "../api.js";
import { useCallback, useEffect, useState } from "react";
import { Pagination, usePagination } from "../../../shared/components";

async function readError(response) {
  try {
    const body = await response.json();
    return body.detail || "Request failed";
  } catch {
    return "Request failed";
  }
}

export default function RulesConfigTab() {
  const [rules, setRules] = useState([]);
  const [settings, setSettings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [section, setSection] = useState("rules");
  const rulePager = usePagination(rules);
  const settingPager = usePagination(settings);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const [rRes, sRes] = await Promise.all([
        fetch(api("/rules")),
        fetch(api("/settings")),
      ]);
      if (!rRes.ok) throw new Error(await readError(rRes));
      if (!sRes.ok) throw new Error(await readError(sRes));
      setRules(await rRes.json());
      setSettings(await sRes.json());
    } catch (e) {
      setMessage({ type: "error", text: e.message || "Failed to load config" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function patchRule(index, patch) {
    setRules((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function patchSetting(key, parsed) {
    setSettings((prev) =>
      prev.map((s) => {
        if (s.setting_key !== key) return s;
        let setting_value = parsed;
        if (s.value_type === "json") {
          setting_value = typeof parsed === "string" ? parsed : JSON.stringify(parsed);
        } else if (s.value_type === "boolean") {
          setting_value = parsed ? "true" : "false";
        } else {
          setting_value = String(parsed ?? "");
        }
        return { ...s, parsed_value: parsed, setting_value };
      }),
    );
  }

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      const rRes = await fetch(api("/rules/bulk"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rules: rules.map((r) => ({
            rule_id: r.rule_id,
            enabled: r.enabled,
            label: r.label,
            tolerance_pp: r.tolerance_pp,
          })),
          updated_by: "frontend",
        }),
      });
      if (!rRes.ok) throw new Error(await readError(rRes));

      const sRes = await fetch(api("/settings/bulk"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: settings.map((s) => ({
            setting_key: s.setting_key,
            parsed_value: s.parsed_value,
            value_type: s.value_type,
            description: s.description,
          })),
          updated_by: "frontend",
        }),
      });
      if (!sRes.ok) throw new Error(await readError(sRes));

      const reload = await fetch(api("/rules/reload"), { method: "POST" });
      if (!reload.ok) throw new Error(await readError(reload));

      setMessage({ type: "ok", text: "Rules and settings saved. Agent reloaded." });
      await load();
    } catch (e) {
      setMessage({ type: "error", text: e.message || "Save failed" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="card"><p className="hint">Loading rules from database…</p></div>;
  }

  return (
    <div className="card rules-card">
      <div className="rules-header">
        <div>
          <h2>Rules & thresholds</h2>
          <p className="hint">
            Stored in schema <code>Collateral_Verification</code>. Changes apply to the next verification.
          </p>
        </div>
        <div className="actions">
          <button type="button" className="btn btn-secondary" onClick={load} disabled={saving}>
            Reload
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save all"}
          </button>
        </div>
      </div>

      {message ? (
        <p className={message.type === "ok" ? "ok-msg" : "err"} role="status">
          {message.text}
        </p>
      ) : null}

      <div className="section-tabs">
        <button
          type="button"
          className={section === "rules" ? "section-tab active" : "section-tab"}
          onClick={() => setSection("rules")}
        >
          Rules
        </button>
        <button
          type="button"
          className={section === "settings" ? "section-tab active" : "section-tab"}
          onClick={() => setSection("settings")}
        >
          Thresholds & flags
        </button>
      </div>

      {section === "rules" ? (
        <>
        <div className="table-wrap">
          <table className="config-table">
            <thead>
              <tr>
                <th>On</th>
                <th>Rule id</th>
                <th>Label</th>
                <th>Tolerance (pp)</th>
              </tr>
            </thead>
            <tbody>
              {rulePager.rows.map((rule, i) => {
                // edits go to the rule's place in the full list, not its place on this page
                const index = rulePager.from - 1 + i;
                return (
                <tr key={rule.rule_id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={!!rule.enabled}
                      onChange={(e) => patchRule(index, { enabled: e.target.checked })}
                    />
                  </td>
                  <td><code>{rule.rule_id}</code></td>
                  <td>
                    <input
                      value={rule.label || ""}
                      onChange={(e) => patchRule(index, { label: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      step="0.1"
                      value={rule.tolerance_pp ?? ""}
                      placeholder="—"
                      onChange={(e) =>
                        patchRule(index, {
                          tolerance_pp: e.target.value === "" ? null : Number(e.target.value),
                        })
                      }
                    />
                  </td>
                </tr>
                );
              })}
              {rules.length === 0 ? (
                <tr>
                  <td colSpan={4} className="hint">
                    No rules in the database yet. Configure the agent database (LOS_AGENTIC_DSN) and restart the service so the seed can run.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <Pagination pager={rulePager} noun="rules" />
        </>
      ) : (
        <>
        <div className="table-wrap">
          <table className="config-table">
            <thead>
              <tr>
                <th>Key</th>
                <th>Value</th>
                <th>Type</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {settingPager.rows.map((s) => (
                <tr key={s.setting_key}>
                  <td><code>{s.setting_key}</code></td>
                  <td>
                    {s.value_type === "boolean" ? (
                      <button
                        type="button"
                        className={s.parsed_value ? "demo selected" : "demo"}
                        onClick={() => patchSetting(s.setting_key, !s.parsed_value)}
                      >
                        {s.parsed_value ? "true" : "false"}
                      </button>
                    ) : s.value_type === "json" ? (
                      <textarea
                        rows={2}
                        value={
                          typeof s.parsed_value === "string"
                            ? s.parsed_value
                            : JSON.stringify(s.parsed_value ?? [], null, 0)
                        }
                        onChange={(e) => {
                          try {
                            patchSetting(s.setting_key, JSON.parse(e.target.value));
                          } catch {
                            patchSetting(s.setting_key, e.target.value);
                          }
                        }}
                      />
                    ) : (
                      <input
                        type={s.value_type === "number" ? "number" : "text"}
                        step={s.value_type === "number" ? "any" : undefined}
                        value={s.parsed_value ?? ""}
                        onChange={(e) =>
                          patchSetting(
                            s.setting_key,
                            s.value_type === "number" ? Number(e.target.value) : e.target.value,
                          )
                        }
                      />
                    )}
                  </td>
                  <td className="hint">{s.value_type}</td>
                  <td className="hint">{s.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination pager={settingPager} noun="settings" />
        </>
      )}
    </div>
  );
}
