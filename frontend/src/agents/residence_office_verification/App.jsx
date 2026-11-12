import { AgentFrame } from "../../shared/components";
import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import './App.css'
import { BackToForm, FormArea, useAgentLoader, Pagination, ResultPage, usePagination, useResultScreen } from '../../shared/components'
import { toResultPage } from './utils/resultView'

// The LOS server's API (same origin; the Vite dev server proxies /api -- see vite.config.js).
const API_BASE = '/api/v1/credit/residence-office-verification'
axios.defaults.withCredentials = true

const yesNoOptions = [
  { value: 'Yes', label: 'Yes' },
  { value: 'No', label: 'No' },
]

const statusOptions = [
  { value: 'Positive', label: 'Positive' },
  { value: 'Negative', label: 'Negative' },
  { value: 'Refer', label: 'Refer' },
  { value: 'Pending', label: 'Pending' },
]

const finalStatusOptions = [
  { value: 'Approved', label: 'Approved' },
  { value: 'Rejected', label: 'Rejected' },
  { value: 'Refer', label: 'Refer' },
  { value: 'Pending', label: 'Pending' },
]

const criticalityOptions = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']

const AlertIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
)

const CheckIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </svg>
)

function App() {
  const [activeTab, setActiveTab] = useState('verification') // verification | rules

  const [form, setForm] = useState({
    application_id: 2,
    participant_id: 2,
    verification_type: 'RESIDENCE',
    vendor_name: 'Manual Vendor Entry',
    vendor_response: {
      status: 'Positive',
      final_status: 'Approved',
      neighbour_check: 'Yes',
      address_confirmed: 'Yes',
      corrected_address: '',
      negative_area: 'No',
      political_link: 'No',
      name_plate_visible: 'Yes',
      community_dominated: 'No',
    },
  })

  const [loading, setLoading] = useState(false)
  useAgentLoader(loading, 'run')
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const screen = useResultScreen(result)
  const [sent, setSent] = useState(null) // the request the shown result answers
   const [aiSummary, setAiSummary] = useState('')
  const [aiModel, setAiModel] = useState('')

  // Rule config state
  const [configType, setConfigType] = useState('RESIDENCE')
  const [ruleRows, setRuleRows] = useState([])
  const [configLoading, setConfigLoading] = useState(false)
  const [configSaving, setConfigSaving] = useState(false)
  const [configError, setConfigError] = useState(null)
  const [configMessage, setConfigMessage] = useState(null)

  const handleChange = (e) => {
    const { name, value } = e.target
    if (name.startsWith('vendor_')) {
      const key = name.replace('vendor_', '')
      setForm((prev) => ({
        ...prev,
        vendor_response: {
          ...prev.vendor_response,
          [key]: value === '' ? null : value,
        },
      }))
    } else {
      setForm((prev) => ({
        ...prev,
        [name]: name.includes('id') ? Number(value) || value : value,
      }))
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setResult(null)
    setAiSummary('')
    setAiModel('')

    const payload = {
      application_id: Number(form.application_id),
      participant_id: Number(form.participant_id),
      verification_type: form.verification_type,
      vendor_name: form.vendor_name,
      vendor_response: {
        ...form.vendor_response,
        corrected_address:
          form.vendor_response.corrected_address?.trim() || null,
      },
    }

    try {
      const res = await axios.post(`${API_BASE}/residence-verification`, payload, {
        headers: { 'Content-Type': 'application/json' },
      })
      setResult(res.data)
      setSent(payload)
      setAiSummary(res.data.ai_summary || '')
      setAiModel(res.data.ai_summary_model || '')
    } catch (err) {
      setError(
        err.response?.data?.detail ||
          err.response?.data?.message ||
          err.message ||
          'Failed to call residence-verification API'
      )
    } finally {
      setLoading(false)
    }
  }

  const loadRuleConfigs = useCallback(async (type) => {
    setConfigLoading(true)
    setConfigError(null)
    setConfigMessage(null)
    try {
      const res = await axios.get(`${API_BASE}/rule-configs`, {
        params: { verification_type: type },
      })
      setRuleRows(
        (res.data.rules || []).map((r) => ({
          ...r,
          enabled: Boolean(r.enabled),
          weight: Number(r.weight),
        }))
      )
    } catch (err) {
      setConfigError(
        err.response?.data?.detail ||
          err.message ||
          'Failed to load rule configs'
      )
      setRuleRows([])
    } finally {
      setConfigLoading(false)
    }
  }, [])

  useEffect(() => {
    if (activeTab === 'rules') {
      loadRuleConfigs(configType)
    }
  }, [activeTab, configType, loadRuleConfigs])

  const handleRuleFieldChange = (ruleKey, field, value) => {
    setRuleRows((prev) =>
      prev.map((row) =>
        row.rule_key === ruleKey
          ? {
              ...row,
              [field]:
                field === 'enabled'
                  ? value
                  : field === 'weight'
                    ? Number(value)
                    : value,
            }
          : row
      )
    )
  }

  const handleSaveRules = async () => {
    setConfigSaving(true)
    setConfigError(null)
    setConfigMessage(null)
    try {
      const payload = {
        verification_type: configType,
        rules: ruleRows.map((r) => ({
          rule_key: r.rule_key,
          rule_id: r.rule_id,
          name: r.name,
          enabled: r.enabled,
          criticality: r.criticality,
          weight: Number(r.weight),
        })),
      }
      const res = await axios.put(`${API_BASE}/rule-configs`, payload, {
        headers: { 'Content-Type': 'application/json' },
      })
      setRuleRows(
        (res.data.rules || []).map((r) => ({
          ...r,
          enabled: Boolean(r.enabled),
          weight: Number(r.weight),
        }))
      )
      setConfigMessage(
        `Saved ${res.data.updated_count} ${configType} rule(s) to the database.`
      )
    } catch (err) {
      setConfigError(
        err.response?.data?.detail ||
          err.message ||
          'Failed to save rule configs'
      )
    } finally {
      setConfigSaving(false)
    }
  }

  const configPager = usePagination(ruleRows)

  return (
    <AgentFrame agent="residence_office_verification" caseLabel={result ? ((sent || form)?.application_id || undefined) : undefined}
      items={[
        { id: "verification", label: "Verification", icon: "file-check", active: activeTab === 'verification' && !screen.onResult,
          onSelect: () => { setActiveTab('verification'); screen.back() } },
        { id: "rules", label: "Rule config", icon: "list", active: activeTab === 'rules', onSelect: () => setActiveTab('rules') },
        ...(screen.hasResult ? [{ id: "result", label: "Result", icon: "sparkle", active: activeTab === 'verification' && screen.onResult,
          onSelect: () => { setActiveTab('verification'); screen.show() } }] : []),
      ]}>
    <div className="app">

      <main className="main">
        {activeTab === 'verification' && (
          <>
            <FormArea hidden={screen.onResult}>
            <section className="form-section">
              <h2>Request payload</h2>
              <form onSubmit={handleSubmit} className="form">
                <div className="form-grid">
                  <div className="field">
                    <label htmlFor="application_id">Application ID *</label>
                    <input
                      id="application_id"
                      name="application_id"
                      type="number"
                      value={form.application_id}
                      onChange={handleChange}
                      required
                    />
                  </div>

                  <div className="field">
                    <label htmlFor="participant_id">Participant ID *</label>
                    <input
                      id="participant_id"
                      name="participant_id"
                      type="number"
                      value={form.participant_id}
                      onChange={handleChange}
                      required
                    />
                  </div>

                  <div className="field">
                    <label htmlFor="verification_type">Verification Type</label>
                    <select
                      id="verification_type"
                      name="verification_type"
                      value={form.verification_type}
                      onChange={handleChange}
                    >
                      <option value="RESIDENCE">RESIDENCE</option>
                      <option value="OFFICE">OFFICE</option>
                    </select>
                  </div>

                  <div className="field">
                    <label htmlFor="vendor_name">Vendor Name</label>
                    <input
                      id="vendor_name"
                      name="vendor_name"
                      type="text"
                      value={form.vendor_name}
                      onChange={handleChange}
                    />
                  </div>
                </div>

                <h3 className="section-title">Vendor response</h3>
                <div className="form-grid">
                  <div className="field">
                    <label htmlFor="vendor_status">Status</label>
                    <select
                      id="vendor_status"
                      name="vendor_status"
                      value={form.vendor_response.status}
                      onChange={handleChange}
                    >
                      {statusOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="field">
                    <label htmlFor="vendor_final_status">Final Status</label>
                    <select
                      id="vendor_final_status"
                      name="vendor_final_status"
                      value={form.vendor_response.final_status}
                      onChange={handleChange}
                    >
                      {finalStatusOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="field">
                    <label htmlFor="vendor_neighbour_check">Neighbour Check</label>
                    <select
                      id="vendor_neighbour_check"
                      name="vendor_neighbour_check"
                      value={form.vendor_response.neighbour_check}
                      onChange={handleChange}
                    >
                      {yesNoOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="field">
                    <label htmlFor="vendor_address_confirmed">
                      Address Confirmed
                    </label>
                    <select
                      id="vendor_address_confirmed"
                      name="vendor_address_confirmed"
                      value={form.vendor_response.address_confirmed}
                      onChange={handleChange}
                    >
                      {yesNoOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="field">
                    <label htmlFor="vendor_negative_area">Negative Area</label>
                    <select
                      id="vendor_negative_area"
                      name="vendor_negative_area"
                      value={form.vendor_response.negative_area}
                      onChange={handleChange}
                    >
                      {yesNoOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="field">
                    <label htmlFor="vendor_political_link">Political Link</label>
                    <select
                      id="vendor_political_link"
                      name="vendor_political_link"
                      value={form.vendor_response.political_link}
                      onChange={handleChange}
                    >
                      {yesNoOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="field">
                    <label htmlFor="vendor_name_plate_visible">
                      Name Plate Visible
                    </label>
                    <select
                      id="vendor_name_plate_visible"
                      name="vendor_name_plate_visible"
                      value={form.vendor_response.name_plate_visible}
                      onChange={handleChange}
                    >
                      {yesNoOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="field">
                    <label htmlFor="vendor_community_dominated">
                      Community Dominated
                    </label>
                    <select
                      id="vendor_community_dominated"
                      name="vendor_community_dominated"
                      value={form.vendor_response.community_dominated}
                      onChange={handleChange}
                    >
                      {yesNoOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="field field-wide">
                    <label htmlFor="vendor_corrected_address">
                      Corrected Address
                    </label>
                    <input
                      id="vendor_corrected_address"
                      name="vendor_corrected_address"
                      type="text"
                      value={form.vendor_response.corrected_address || ''}
                      onChange={handleChange}
                      placeholder="Optional corrected address from vendor"
                    />
                  </div>
                </div>

                <div className="actions">
                  <button type="submit" className="btn primary cta" disabled={loading} aria-busy={loading}>
                    {loading && <span className="spinner" aria-hidden="true" />}
                    {loading ? 'Running verification…' : 'Run verification'}
                  </button>
                </div>
              </form>

              {error && (
                <div className="alert error" role="alert">
                  <AlertIcon />
                  <span>{typeof error === 'string' ? error : JSON.stringify(error)}</span>
                </div>
              )}
            </section>
            </FormArea>

            {result && screen.onResult && <BackToForm onBack={screen.back} note={(sent || form)?.application_id || (sent || form)?.case_id} />}
            {result && screen.onResult && (
              <div className="result-section">
                <ResultPage {...toResultPage(result, sent || form, aiSummary)} />
              </div>
            )}
          </>
        )}

        {activeTab === 'rules' && (
          <section className="form-section rules-config-section">
            <h2>Rule configuration</h2>
            <p className="subtitle">
              Rules are stored in the database schema{' '}
              <code>residence_office_verification</code>. Changes apply to the next
              verification run — no code change required.
            </p>

            <div className="toolbar">
              <div className="field">
                <label htmlFor="config_type">Verification type</label>
                <select
                  id="config_type"
                  value={configType}
                  onChange={(e) => setConfigType(e.target.value)}
                >
                  <option value="RESIDENCE">RESIDENCE</option>
                  <option value="OFFICE">OFFICE</option>
                </select>
              </div>
              <div className="toolbar-actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() => loadRuleConfigs(configType)}
                  disabled={configLoading}
                >
                  {configLoading ? 'Loading…' : 'Reload'}
                </button>
                <button
                  type="button"
                  className="btn primary"
                  onClick={handleSaveRules}
                  disabled={configSaving || configLoading || ruleRows.length === 0}
                  aria-busy={configSaving}
                >
                  {configSaving && <span className="spinner" aria-hidden="true" />}
                  {configSaving ? 'Saving…' : 'Save to database'}
                </button>
              </div>
            </div>

            {configError && (
              <div className="alert error" role="alert" style={{ marginTop: 0, marginBottom: 'var(--s4)' }}>
                <AlertIcon />
                <span>
                  {typeof configError === 'string'
                    ? configError
                    : JSON.stringify(configError)}
                </span>
              </div>
            )}
            {configMessage && (
              <div className="alert success" role="status">
                <CheckIcon />
                <span>{configMessage}</span>
              </div>
            )}

            {configLoading && <p className="status-line">Loading rules…</p>}

            {!configLoading && ruleRows.length > 0 && (
              <div className="rules-config-table-wrap">
                <table className="rules-config-table">
                  <caption className="sr-only">
                    {configType} verification rules, in database order
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Key</th>
                      <th scope="col">Rule ID</th>
                      <th scope="col">Name</th>
                      <th scope="col" className="center">Enabled</th>
                      <th scope="col">Criticality</th>
                      <th scope="col">Weight</th>
                    </tr>
                  </thead>
                  <tbody>
                    {configPager.rows.map((row) => (
                      <tr key={row.rule_key} className={row.enabled ? '' : 'disabled'}>
                        <td>
                          <code>{row.rule_key}</code>
                        </td>
                        <td>
                          <input
                            type="text"
                            value={row.rule_id || ''}
                            onChange={(e) =>
                              handleRuleFieldChange(
                                row.rule_key,
                                'rule_id',
                                e.target.value
                              )
                            }
                          />
                        </td>
                        <td>
                          <input
                            type="text"
                            value={row.name || ''}
                            onChange={(e) =>
                              handleRuleFieldChange(
                                row.rule_key,
                                'name',
                                e.target.value
                              )
                            }
                            className="input-wide"
                          />
                        </td>
                        <td className="center">
                          <input
                            type="checkbox"
                            aria-label={`Enable ${row.rule_key}`}
                            checked={Boolean(row.enabled)}
                            onChange={(e) =>
                              handleRuleFieldChange(
                                row.rule_key,
                                'enabled',
                                e.target.checked
                              )
                            }
                          />
                        </td>
                        <td>
                          <select
                            value={row.criticality || 'MEDIUM'}
                            onChange={(e) =>
                              handleRuleFieldChange(
                                row.rule_key,
                                'criticality',
                                e.target.value
                              )
                            }
                          >
                            {criticalityOptions.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            type="number"
                            min={0}
                            max={1000}
                            value={row.weight}
                            onChange={(e) =>
                              handleRuleFieldChange(
                                row.rule_key,
                                'weight',
                                e.target.value
                              )
                            }
                            className="input-num"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Pagination pager={configPager} noun="rules" />
              </div>
            )}

            {!configLoading && ruleRows.length === 0 && !configError && (
              <p className="status-line">
                No rules found for {configType}. Check that the backend can reach the database, then reload.
              </p>
            )}
          </section>
        )}
      </main>

      <footer className="footer" />
    </div>
    </AgentFrame>
  )
}

export default App
