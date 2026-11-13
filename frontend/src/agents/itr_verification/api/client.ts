import { withoutDevNames } from '../../../shared/lib/people'
import type { ApplicationParticipants, VerificationResponse } from '../types'

// The agent is served by the credit-underwriting service under /api/v1/credit/itr-verification.
// VITE_LOS_API_ORIGIN (build-time) names another origin; empty = the same origin as this page (or the dev proxy).
export const DEFAULT_API_BASE = `${import.meta.env.VITE_LOS_API_ORIGIN ?? ''}/api/v1/credit/itr-verification`

const BASE_KEY = 'itr_api_base_v2'
const TOKEN_KEY = 'los_access_token'

export function getApiBase(): string {
  return localStorage.getItem(BASE_KEY) || DEFAULT_API_BASE
}

export function setApiBase(url: string) {
  localStorage.setItem(BASE_KEY, url.replace(/\/$/, ''))
}

/** Every route needs the LOS JWT: sent as a Bearer token when the session holds one. */
export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return fetch(`${getApiBase()}${path}`, { ...init, headers })
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const err = await res.json()
      detail = typeof err.detail === 'string' ? err.detail : JSON.stringify(err.detail || err)
    } catch {
      // ignore
    }
    throw new Error(detail)
  }
  return withoutDevNames(await res.json())
}

/** The documents in the backend's local input / output folders (empty lists when documents are not read from there). */
export async function fetchSampleDocuments(): Promise<{ input: string[]; output: string[] }> {
  const res = await apiFetch(`/sample-documents`)
  return handleResponse<{ input: string[]; output: string[] }>(res)
}

/** The application found by its number (e.g. LOS-DUMMY-0045) and the people under it. */
export async function fetchParticipants(applicationNumber: string): Promise<ApplicationParticipants> {
  const res = await apiFetch(`/applications/${encodeURIComponent(applicationNumber.trim())}/participants`)
  return handleResponse<ApplicationParticipants>(res)
}

/** Verify using document filenames / IDs / future S3-DMS URLs, for one participant of an application */
export async function verifyByIds(
  inputDocId: string,
  outputDocId: string,
  applicationData: {
    panNumber: string
    assessmentYear: string
    gtiIncome: string
    finalStatus: string
    applicantName?: string
    address?: string
    /** the application and the participant the ITR is verified for (the backend checks they belong together) */
    applicationNumber?: string
    participantId?: number | null
  },
): Promise<VerificationResponse> {
  const res = await apiFetch(`/verify/by-ids`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      application_number: applicationData.applicationNumber?.trim() || undefined,
      participant_id: applicationData.participantId ?? undefined,
      input_doc_id: inputDocId.trim(),
      output_doc_id: outputDocId.trim(),
      pan_number: applicationData.panNumber.trim(),
      assessment_year: applicationData.assessmentYear.trim(),
      gti_income: applicationData.gtiIncome.trim() === '' ? null : Number(applicationData.gtiIncome),
      final_status: applicationData.finalStatus,
      applicant_name: applicationData.applicantName || undefined,
      address: applicationData.address || undefined,
    }),
  })

  return handleResponse<VerificationResponse>(res)
}

// ---------------------------------------------------------------------------
// Rules & settings
// ---------------------------------------------------------------------------

export interface RuleConfigItem {
  id?: number
  category: string
  field: string
  enabled: boolean
  weight: number
  match_type: string
  tolerance_pct: number
  severity: string
  description?: string | null
  document_field?: string | null
  label?: string | null
  extra_json?: any
  updated_at?: string | null
  updated_by?: string | null
}

export interface SystemSettingItem {
  id?: number
  setting_key: string
  setting_value?: string | null
  parsed_value?: any
  value_type: string
  description?: string | null
  updated_at?: string | null
  updated_by?: string | null
}

export async function fetchRules(category?: string): Promise<RuleConfigItem[]> {
  const qs = category ? `?category=${encodeURIComponent(category)}` : ''
  const res = await apiFetch(`/rules${qs}`)
  return handleResponse(res)
}

export async function bulkUpdateRules(rules: RuleConfigItem[]): Promise<RuleConfigItem[]> {
  const res = await apiFetch(`/rules/bulk`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rules, updated_by: 'frontend' }),
  })
  return handleResponse(res)
}

export async function fetchSettings(): Promise<SystemSettingItem[]> {
  const res = await apiFetch(`/settings`)
  return handleResponse(res)
}

export async function bulkUpdateSettings(settings: SystemSettingItem[]): Promise<SystemSettingItem[]> {
  const res = await apiFetch(`/settings/bulk`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      settings: settings.map((s) => ({
        setting_key: s.setting_key,
        parsed_value: s.parsed_value,
        value_type: s.value_type,
        description: s.description,
      })),
      updated_by: 'frontend',
    }),
  })
  return handleResponse(res)
}

export async function reloadRules(): Promise<void> {
  const res = await apiFetch(`/rules/reload`, { method: 'POST' })
  await handleResponse(res)
}

export async function fetchResults(limit = 50): Promise<any[]> {
  const res = await apiFetch(`/results?limit=${limit}`)
  return handleResponse(res)
}
