// The ITR verification result in the console's COMMON RESULT LAYOUT (shared/components/result): a pure adapter from
// the /verify/by-ids response to ResultPageProps. Only what the API returns is shown.
import type { ActionItem, CalcRow, Fact, ResultPageProps, RuleRow, Tone } from '../../../shared/components'
import type { FieldResultItem, VerificationResponse } from '../types'

/** "application_gti_income_vs_input_document" -> "Application gti income vs input document" */
export const humanize = (field: string) => {
  const s = field.replace(/_/g, ' ').trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'number') return v.toLocaleString('en-IN')
  return String(v)
}

const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }

/** The overall decision: ACCEPT -> pass, REVIEW -> review, REJECT -> fail, anything else -> na. */
export function decisionTone(decision: string): Tone {
  switch ((decision || '').toUpperCase()) {
    case 'ACCEPT': return 'pass'
    case 'REVIEW': return 'review'
    case 'REJECT': return 'fail'
    default: return 'na'
  }
}

/**
 * One field result's tone:
 *   matched                                   -> pass  ("Match")
 *   not matched, severity critical / high      -> fail  ("Mismatch" / "Not verified")
 *   not matched, severity medium / low / other -> review
 *   not matched, severity "none" (the policy ignores it, e.g. an unknown vendor status) -> na
 */
export function fieldTone(r: FieldResultItem): Tone {
  if (r.matched) return 'pass'
  const sev = (r.severity || '').toLowerCase()
  if (sev === 'none') return 'na'
  return sev === 'critical' || sev === 'high' ? 'fail' : 'review'
}

const isApplication = (field: string) => field.startsWith('application_')
const sideOf = (field: string) => (field.endsWith('_vs_input_document') ? 'Customer ITR' : field.endsWith('_vs_output_document') ? 'Vendor ITR' : null)

function ruleName(r: FieldResultItem): string {
  if (r.field === 'vendor_final_status') return 'Vendor final status'
  if (isApplication(r.field)) {
    const side = sideOf(r.field)
    const label = r.description && r.description !== r.field ? r.description : humanize(r.field.replace(/^application_|_vs_(input|output)_document$/g, ''))
    return side ? `${label} — application vs ${side.charAt(0).toLowerCase()}${side.slice(1)}` : label
  }
  return humanize(r.field)
}

/** Every field result as a rule row: problems first (by severity), then the rest in the API's order. */
export function toRules(results: FieldResultItem[]): RuleRow[] {
  const rank = (r: FieldResultItem) => (r.matched ? 9 : SEVERITY_ORDER[(r.severity || '').toLowerCase()] ?? 4)
  return [...results]
    .map((r, i) => ({ r, i }))
    .sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i)
    .map(({ r }) => {
      const notVerified = !r.matched && /^NOT VERIFIED/i.test(r.message || '')
      const app = isApplication(r.field)
      const values: Fact[] = r.field === 'vendor_final_status'
        ? [{ label: 'Vendor selected', value: formatValue(r.input_value) }, { label: 'Read as', value: formatValue(r.output_value) }]
        : [
            { label: app ? 'Application' : 'Input (customer)', value: formatValue(r.input_value), mono: true },
            { label: app ? sideOf(r.field) ?? 'Document' : 'Output (vendor)', value: formatValue(r.output_value), mono: true },
          ]
      const sev = (r.severity || '').toLowerCase()
      return {
        id: r.field,
        name: ruleName(r),
        outcome: fieldTone(r),
        outcomeLabel: r.matched ? 'Match' : notVerified ? 'Not verified' : 'Mismatch',
        severity: !r.matched && sev && sev !== 'none' ? humanize(sev) : undefined,
        detail: r.matched ? (r.field === 'vendor_final_status' ? r.message : r.description || undefined) : r.message || r.description,
        values,
      }
    })
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`

/** Numbers computed / compared: the score, income on each side, and each weighted field. */
export function toCalculations(report: VerificationResponse): CalcRow[] {
  const results = report.field_results || []
  const rows: CalcRow[] = [
    { group: 'Score', label: 'Overall match score', value: `${Number(report.overall_score ?? 0).toFixed(1)}%`, tone: decisionTone(report.decision) },
  ]
  const weight = results.reduce((s, r) => s + (r.weight || 0), 0)
  const earned = results.reduce((s, r) => s + (r.weighted_score || 0), 0)
  if (weight > 0) rows.push({ group: 'Score', label: 'Weight earned', value: `${+earned.toFixed(2)} of ${+weight.toFixed(2)}`, hint: 'weighted fields' })
  const matched = results.filter((r) => r.matched).length
  if (results.length) rows.push({ group: 'Score', label: 'Fields matched', value: `${matched} of ${results.length}` })

  // income: the application's GTI, and what each ITR says
  const appGti = num(results.find((r) => r.field.startsWith('application_gti_income'))?.input_value)
  const inGti = num(report.input_fields?.total_income ?? report.input_fields?.gti)
  const outGti = num(report.output_fields?.total_income ?? report.output_fields?.gti)
  if (appGti !== null) rows.push({ group: 'Income', label: 'GTI declared in the application', value: inr(appGti), mono: true })
  if (inGti !== null) rows.push({ group: 'Income', label: 'GTI in the customer ITR', value: inr(inGti), mono: true })
  if (outGti !== null) rows.push({ group: 'Income', label: 'GTI in the vendor ITR', value: inr(outGti), mono: true })
  if (inGti !== null && outGti !== null && inGti > 0) {
    const income = results.find((r) => r.field === 'total_income')
    rows.push({ group: 'Income', label: 'Customer vs vendor difference', value: `${((Math.abs(inGti - outGti) / inGti) * 100).toFixed(1)}%`,
                tone: income ? (income.matched ? 'pass' : 'fail') : undefined })
  }
  if (appGti !== null && appGti > 0 && inGti !== null) {
    rows.push({ group: 'Income', label: 'Application vs customer ITR difference', value: `${((Math.abs(appGti - inGti) / appGti) * 100).toFixed(1)}%` })
  }

  for (const r of results.filter((x) => x.weight > 0)) {
    rows.push({ group: 'Weighted fields', label: ruleName(r), value: `${r.weighted_score} / ${r.weight}`,
                hint: `score ${Number(r.score ?? 0).toFixed(0)}%`, tone: r.matched ? 'pass' : fieldTone(r) })
  }
  return rows
}

/** The rules' written summary plus the insights the screen always derived, as separate points. */
export function toPoints(report: VerificationResponse): string[] {
  const out: string[] = []
  const add = (s: string) => { const t = s.trim(); if (t && !out.includes(t)) out.push(t) }
  if (report.vendor_final_status === 'REJECTED') add('Vendor ITR verification is rejected: the vendor final status overrides the score and the decision is REJECT.')
  ;(report.summary || '').split(/(?<=[.!?])\s+/).forEach(add)

  const { decision, overall_score, mismatches, critical_failures, field_results } = report
  if (decision === 'ACCEPT') add('Documents are highly consistent. Safe to proceed with automated acceptance.')
  else if (decision === 'REVIEW') add('Manual review recommended before final decision. Score is in the middle band or critical fields failed.')
  else add('Significant discrepancies detected. Strong candidate for rejection or re-upload of documents.')
  if (critical_failures?.length) add(`Critical field(s) failed: ${critical_failures.map((f) => f.replace(/_/g, ' ')).join(', ')}.`)
  const income = mismatches?.find((m) => m.field === 'total_income')
  if (income) {
    const a = Number(income.input)
    const b = Number(income.output)
    if (!Number.isNaN(a) && !Number.isNaN(b) && a > 0) {
      add(`Total income differs by ~${((Math.abs(a - b) / a) * 100).toFixed(1)}%: input ${inr(a)} vs output ${inr(b)}.`)
    }
  }
  if (mismatches?.some((m) => m.field === 'pan')) add('PAN mismatch is a critical identity issue. Verify the documents belong to the same assessee.')
  if (mismatches?.some((m) => m.field === 'assessment_year')) add('Assessment year mismatch suggests the wrong return year may have been uploaded.')
  const total = field_results?.length ?? 0
  if (total > 0) {
    const matched = field_results.filter((r) => r.matched).length
    add(`${matched} of ${total} compared fields matched (${((matched / total) * 100).toFixed(0)}% field-level success).`)
  }
  if (overall_score >= 90 && decision !== 'ACCEPT') add('Score is high but decision is not ACCEPT – likely blocked by a critical rule failure.')
  return out
}

export interface ItrViewOptions {
  /** the application values the officer entered (shown when the documents do not carry them) */
  application?: { panNumber?: string; assessmentYear?: string }
  onNewVerification?: () => void
  /** downloads the comparison report (vendor report attached at the bottom) */
  onDownload?: () => void
}

export function toResultPage(report: VerificationResponse & { run_id?: string | null }, opts: ItrViewOptions = {}): ResultPageProps {
  const inF = report.input_fields || {}
  const outF = report.output_fields || {}
  const pick = (...vals: unknown[]) => vals.find((v) => v !== null && v !== undefined && v !== '') as string | undefined
  const name = pick(inF.applicant_name, outF.applicant_name, inF.name, outF.name)
  const pan = pick(inF.pan, outF.pan, opts.application?.panNumber)
  const ay = pick(inF.assessment_year, outF.assessment_year, opts.application?.assessmentYear)
  const results = report.field_results || []
  const mismatches = results.filter((r) => !r.matched)

  const facts: Fact[] = []
  if (pan) facts.push({ label: 'PAN', value: String(pan).toUpperCase(), mono: true })
  if (ay) facts.push({ label: 'Assessment year', value: String(ay) })
  if (report.input_document) facts.push({ label: 'Customer ITR', value: report.input_document, mono: true })
  if (report.output_document) facts.push({ label: 'Vendor ITR', value: report.output_document, mono: true })
  if (report.vendor_final_status) facts.push({ label: 'Vendor final status', value: humanize(report.vendor_final_status.toLowerCase()) })
  if (inF.acknowledgement_number) facts.push({ label: 'Acknowledgement no.', value: String(inF.acknowledgement_number), mono: true })

  const actions: ActionItem[] = [
    { id: 'new', label: 'New verification', kind: 'ghost', icon: 'arrow', onClick: opts.onNewVerification },
    { id: 'download', label: 'Download comparison report', kind: 'warning', icon: 'download', onClick: opts.onDownload },
    { id: 'reject', label: 'Reject', kind: 'danger', icon: 'x' },
    { id: 'accept', label: 'Accept', kind: 'primary', icon: 'check' },
  ]

  return {
    basic: {
      eyebrow: 'Credit underwriting · ITR verification',
      title: name ? String(name) : pan ? String(pan).toUpperCase() : report.input_document || 'ITR verification',
      subtitle: 'Customer ITR compared with the vendor ITR and the application',
      icon: 'receipt',
      facts,
      decision: { label: report.decision, tone: decisionTone(report.decision) },
      kpis: [
        { label: 'Match score', value: `${Number(report.overall_score ?? 0).toFixed(1)}%`, tone: decisionTone(report.decision) },
        { label: 'Fields checked', value: results.length, tone: 'info' },
        { label: 'Matched', value: results.length - mismatches.length, tone: 'pass' },
        { label: 'Mismatches', value: mismatches.length, tone: mismatches.length ? 'review' : 'na' },
        { label: 'Critical', value: report.critical_failures?.length ?? 0, tone: report.critical_failures?.length ? 'fail' : 'na' },
      ],
    },
    // the backend's summary is written by the rules engine (no model), so it is a "Rules summary"
    summary: { points: toPoints(report), source: 'Rules summary', title: 'Summary' },
    rules: { title: 'Field checks', rules: toRules(results), empty: 'No field results available.' },
    calculations: { title: 'Calculations', rows: toCalculations(report) },
    actions,
  }
}
