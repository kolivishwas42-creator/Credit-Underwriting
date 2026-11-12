import { useCallback, useEffect, useState } from 'react'
import {
  Save,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertCircle,
  SlidersHorizontal,
  ToggleLeft,
} from 'lucide-react'
import {
  fetchRules,
  fetchSettings,
  bulkUpdateRules,
  bulkUpdateSettings,
  reloadRules,
  type RuleConfigItem,
  type SystemSettingItem,
} from '../api/client'
import { Pagination, usePagination } from '../../../shared/components'

const MATCH_TYPES = ['exact', 'fuzzy', 'numeric_tolerance', 'normalized', 'numeric']
const SEVERITIES = ['critical', 'high', 'medium', 'low']

export function RulesConfigTab() {
  const [rules, setRules] = useState<RuleConfigItem[]>([])
  const [settings, setSettings] = useState<SystemSettingItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null)
  const [activeSection, setActiveSection] = useState<'comparison' | 'application' | 'settings'>('comparison')
  const settingsPager = usePagination(settings)

  const load = useCallback(async () => {
    setLoading(true)
    setMessage(null)
    try {
      const [r, s] = await Promise.all([fetchRules(), fetchSettings()])
      setRules(r)
      setSettings(s)
    } catch (e: any) {
      setMessage({ type: 'error', text: e?.message || 'Failed to load rules/settings' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const comparisonRules = rules.filter((r) => r.category === 'comparison')
  const applicationRules = rules.filter((r) => r.category === 'application')

  const updateRuleLocal = (indexInAll: number, patch: Partial<RuleConfigItem>) => {
    setRules((prev) => prev.map((r, i) => (i === indexInAll ? { ...r, ...patch } : r)))
  }

  const updateSettingLocal = (key: string, parsed: any) => {
    setSettings((prev) =>
      prev.map((s) =>
        s.setting_key === key
          ? {
              ...s,
              parsed_value: parsed,
              setting_value:
                s.value_type === 'json'
                  ? typeof parsed === 'string'
                    ? parsed
                    : JSON.stringify(parsed)
                  : String(parsed),
            }
          : s,
      ),
    )
  }

  const handleSave = async () => {
    setSaving(true)
    setMessage(null)
    try {
      await bulkUpdateRules(rules)
      await bulkUpdateSettings(settings)
      await reloadRules()
      setMessage({ type: 'ok', text: 'Rules & settings saved and reloaded into the agent.' })
      await load()
    } catch (e: any) {
      setMessage({ type: 'error', text: e?.message || 'Save failed' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading rules from database…
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-800 flex items-center gap-2">
            <SlidersHorizontal className="h-5 w-5 text-brand-600" />
            Rules & Thresholds Config
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Managed in schema <code className="rounded bg-slate-100 px-1">ITR_Verification</code> · changes apply to the next verification
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={load}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            <RefreshCw className="h-4 w-4" />
            Reload
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-medium text-on-ink hover:bg-brand-700 disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save All
          </button>
        </div>
      </div>

      {message && (
        <div
          className={`flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm ${
            message.type === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'
          }`}
        >
          {message.type === 'ok' ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {/* Section tabs */}
      <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
        {(
          [
            ['comparison', 'Document Rules'],
            ['application', 'Application Rules'],
            ['settings', 'Thresholds & Vendor'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveSection(id)}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
              activeSection === id
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Comparison rules */}
      {activeSection === 'comparison' && (
        <RulesTable
          rules={comparisonRules}
          allRules={rules}
          onChange={updateRuleLocal}
          showDocumentField={false}
        />
      )}

      {/* Application rules */}
      {activeSection === 'application' && (
        <RulesTable
          rules={applicationRules}
          allRules={rules}
          onChange={updateRuleLocal}
          showDocumentField
        />
      )}

      {/* System settings */}
      {activeSection === 'settings' && (
        <div>
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Setting</th>
                <th className="px-4 py-3 font-medium">Value</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {settingsPager.rows.map((s) => (
                <tr key={s.setting_key} className="bg-white">
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-700">{s.setting_key}</td>
                  <td className="px-4 py-2.5">
                    {s.value_type === 'boolean' ? (
                      <button
                        type="button"
                        onClick={() => updateSettingLocal(s.setting_key, !s.parsed_value)}
                        className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium ${
                          s.parsed_value
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        <ToggleLeft className="h-3.5 w-3.5" />
                        {s.parsed_value ? 'true' : 'false'}
                      </button>
                    ) : s.value_type === 'json' ? (
                      <textarea
                        rows={2}
                        value={
                          typeof s.parsed_value === 'string'
                            ? s.parsed_value
                            : JSON.stringify(s.parsed_value ?? [], null, 0)
                        }
                        onChange={(e) => {
                          try {
                            updateSettingLocal(s.setting_key, JSON.parse(e.target.value))
                          } catch {
                            updateSettingLocal(s.setting_key, e.target.value)
                          }
                        }}
                        className="w-full min-w-[200px] rounded-lg border border-slate-200 px-2 py-1 font-mono text-xs"
                      />
                    ) : (
                      <input
                        type={s.value_type === 'number' ? 'number' : 'text'}
                        step={s.value_type === 'number' ? 'any' : undefined}
                        value={s.parsed_value ?? ''}
                        onChange={(e) =>
                          updateSettingLocal(
                            s.setting_key,
                            s.value_type === 'number' ? Number(e.target.value) : e.target.value,
                          )
                        }
                        className="w-full min-w-[120px] rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                      />
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-400">{s.value_type}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-500">{s.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination pager={settingsPager} noun="settings" />
        </div>
      )}
    </div>
  )
}

function RulesTable({
  rules,
  allRules,
  onChange,
  showDocumentField,
}: {
  rules: RuleConfigItem[]
  allRules: RuleConfigItem[]
  onChange: (indexInAll: number, patch: Partial<RuleConfigItem>) => void
  showDocumentField: boolean
}) {
  const pager = usePagination(rules)
  return (
    <div>
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full min-w-[800px] text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-3 font-medium">Enabled</th>
            <th className="px-3 py-3 font-medium">Field</th>
            {showDocumentField && <th className="px-3 py-3 font-medium">Doc field</th>}
            <th className="px-3 py-3 font-medium">Weight</th>
            <th className="px-3 py-3 font-medium">Match type</th>
            <th className="px-3 py-3 font-medium">Tolerance</th>
            <th className="px-3 py-3 font-medium">Severity</th>
            <th className="px-3 py-3 font-medium">Description / Label</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {pager.rows.map((rule) => {
            const idx = allRules.findIndex(
              (r) => r.category === rule.category && r.field === rule.field,
            )
            return (
              <tr key={`${rule.category}-${rule.field}`} className="bg-white">
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={!!rule.enabled}
                    onChange={(e) => onChange(idx, { enabled: e.target.checked })}
                    className="h-4 w-4 rounded border-slate-300 text-ember focus:ring-brand-500"
                  />
                </td>
                <td className="px-3 py-2 font-mono text-xs text-slate-700">{rule.field}</td>
                {showDocumentField && (
                  <td className="px-3 py-2">
                    <input
                      value={rule.document_field || ''}
                      onChange={(e) => onChange(idx, { document_field: e.target.value })}
                      className="w-28 rounded border border-slate-200 px-2 py-1 text-xs"
                    />
                  </td>
                )}
                <td className="px-3 py-2">
                  <input
                    type="number"
                    step="0.5"
                    value={rule.weight}
                    onChange={(e) => onChange(idx, { weight: Number(e.target.value) })}
                    className="w-16 rounded border border-slate-200 px-2 py-1 text-sm"
                  />
                </td>
                <td className="px-3 py-2">
                  <select
                    value={rule.match_type}
                    onChange={(e) => onChange(idx, { match_type: e.target.value })}
                    className="rounded border border-slate-200 px-2 py-1 text-xs"
                  >
                    {MATCH_TYPES.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    step="0.01"
                    value={rule.tolerance_pct}
                    onChange={(e) => onChange(idx, { tolerance_pct: Number(e.target.value) })}
                    className="w-20 rounded border border-slate-200 px-2 py-1 text-sm"
                  />
                </td>
                <td className="px-3 py-2">
                  <select
                    value={rule.severity}
                    onChange={(e) => onChange(idx, { severity: e.target.value })}
                    className="rounded border border-slate-200 px-2 py-1 text-xs"
                  >
                    {SEVERITIES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <input
                    value={rule.description || rule.label || ''}
                    onChange={(e) =>
                      onChange(idx, {
                        description: e.target.value,
                        label: showDocumentField ? e.target.value : rule.label,
                      })
                    }
                    className="w-full min-w-[160px] rounded border border-slate-200 px-2 py-1 text-xs"
                  />
                </td>
              </tr>
            )
          })}
          {rules.length === 0 && (
            <tr>
              <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                No rules in this category. Seed will run on backend startup.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
    <Pagination pager={pager} noun="rules" />
    </div>
  )
}
