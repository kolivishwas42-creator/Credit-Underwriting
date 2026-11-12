import { describe, expect, it, vi } from 'vitest'
import { decisionTone, fieldTone, toResultPage } from '../agents/itr_verification/utils/resultView'
import type { FieldResultItem, VerificationResponse } from '../agents/itr_verification/types'

const field = (over: Partial<FieldResultItem>): FieldResultItem => ({
  field: 'pan', input_value: 'ABCDE1234F', output_value: 'ABCDE1234F', matched: true, score: 100, weight: 30,
  weighted_score: 30, severity: 'none', description: 'PAN must match', message: 'Match', ...over,
})

const report = (over: Partial<VerificationResponse> = {}): VerificationResponse => ({
  decision: 'REVIEW',
  overall_score: 72.5,
  summary: 'Score 72.5% – manual review required. Issues: total_income',
  vendor_final_status: 'APPROVED',
  critical_failures: [],
  mismatches: [{ field: 'total_income', input: 850000, output: 800000, severity: 'high', message: 'Mismatch: input=850000 vs output=800000' }],
  field_results: [
    field({ field: 'vendor_final_status', input_value: 'Approved', output_value: 'APPROVED', weight: 0, weighted_score: 0,
            description: 'Critical vendor verification decision', message: "Vendor final_status 'Approved' is approved" }),
    field({}),
    field({ field: 'total_income', input_value: 850000, output_value: 800000, matched: false, score: 0, weight: 40,
            weighted_score: 0, severity: 'high', description: 'Income within tolerance', message: 'Mismatch: input=850000 vs output=800000' }),
    field({ field: 'acknowledgement_number', matched: false, score: 0, weight: 10, weighted_score: 0, severity: 'low',
            input_value: '111', output_value: '222', message: 'Mismatch' }),
    field({ field: 'application_gti_income_vs_input_document', input_value: 850000, output_value: 850000, weight: 20,
            weighted_score: 20, description: 'GTI income' }),
  ],
  input_fields: { applicant_name: 'Ravi Kumar', pan: 'abcde1234f', assessment_year: '2024-25', total_income: 850000 },
  output_fields: { applicant_name: 'Ravi Kumar', pan: 'ABCDE1234F', assessment_year: '2024-25', total_income: 800000 },
  input_document: 'customer_itr.pdf',
  output_document: 'vendor_itr.pdf',
  ...over,
})

describe('ITR result adapter', () => {
  it('builds the basic card from the response', () => {
    const page = toResultPage(report())
    expect(page.basic.eyebrow).toBe('Credit underwriting · ITR verification')
    expect(page.basic.title).toBe('Ravi Kumar')
    expect(page.basic.decision).toEqual({ label: 'REVIEW', tone: 'review' })
    expect(page.basic.facts).toContainEqual({ label: 'PAN', value: 'ABCDE1234F', mono: true })
    expect(page.basic.facts).toContainEqual({ label: 'Customer ITR', value: 'customer_itr.pdf', mono: true })
    const kpis = Object.fromEntries(page.basic.kpis!.map((k) => [k.label, k.value]))
    expect(kpis).toMatchObject({ 'Match score': '72.5%', 'Fields checked': 5, Matched: 3, Mismatches: 2, Critical: 0 })
  })

  it('falls back to the PAN / document when there is no name', () => {
    const page = toResultPage(report({ input_fields: {}, output_fields: {} }), { application: { panNumber: 'zzzzz9999z' } })
    expect(page.basic.title).toBe('ZZZZZ9999Z')
    expect(toResultPage(report({ input_fields: {}, output_fields: {} })).basic.title).toBe('customer_itr.pdf')
  })

  it('maps field results to rules, problems first, with the compared values', () => {
    const rules = toResultPage(report()).rules!.rules
    expect(rules.map((r) => r.id).slice(0, 2)).toEqual(['total_income', 'acknowledgement_number'])
    const income = rules[0]
    expect(income).toMatchObject({ name: 'Total income', outcome: 'fail', outcomeLabel: 'Mismatch', severity: 'High' })
    expect(income.values).toContainEqual({ label: 'Input (customer)', value: '8,50,000', mono: true })
    expect(rules[1].outcome).toBe('review')                                  // low severity -> review
    const app = rules.find((r) => r.id.startsWith('application_'))!
    expect(app.name).toBe('GTI income — application vs customer ITR')
    expect(app.values![0].label).toBe('Application')
  })

  it('tones: decision and field', () => {
    expect(decisionTone('ACCEPT')).toBe('pass')
    expect(decisionTone('reject')).toBe('fail')
    expect(decisionTone('X')).toBe('na')
    expect(fieldTone(field({ matched: false, severity: 'critical' }))).toBe('fail')
    expect(fieldTone(field({ matched: false, severity: 'none' }))).toBe('na')
  })

  it('calculations: score, income on each side, weighted fields', () => {
    const rows = toResultPage(report()).calculations!.rows
    const by = (label: string) => rows.find((r) => r.label === label)
    expect(by('Overall match score')).toMatchObject({ value: '72.5%', tone: 'review', group: 'Score' })
    expect(by('Weight earned')!.value).toBe('50 of 100')
    expect(by('GTI declared in the application')!.value).toBe('₹8,50,000')
    expect(by('GTI in the vendor ITR')!.value).toBe('₹8,00,000')
    expect(by('Customer vs vendor difference')).toMatchObject({ value: '5.9%', tone: 'fail' })
    expect(rows.filter((r) => r.group === 'Weighted fields')).toHaveLength(4)
  })

  it('summary points: the rules summary and the insights, no duplicates', () => {
    const s = toResultPage(report()).summary!
    expect(s.source).toBe('Rules summary')
    expect(s.points[0]).toMatch(/^Score 72.5%/)
    expect(s.points.some((p) => p.startsWith('Total income differs by ~5.9%'))).toBe(true)
    expect(new Set(s.points).size).toBe(s.points.length)
  })

  it('vendor rejection is the first point', () => {
    const s = toResultPage(report({ vendor_final_status: 'REJECTED', decision: 'REJECT' })).summary!
    expect(s.points[0]).toMatch(/vendor final status overrides the score/)
  })

  it('only New verification is wired; the decision buttons are presentational', () => {
    const reset = vi.fn()
    const actions = toResultPage(report(), { onNewVerification: reset }).actions!
    actions.find((a) => a.id === 'new')!.onClick!()
    expect(reset).toHaveBeenCalled()
    expect(actions.filter((a) => a.onClick)).toHaveLength(1)
  })
})
