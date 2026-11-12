import { describe, expect, it } from 'vitest'
// collateral_verification is JavaScript; its adapter is imported as-is
import { statusWord, toneOf, toResultPage as adapt, valueText } from '../agents/collateral_verification/utils/resultView.js'
import type { ResultPageProps } from '../shared/components'

const toResultPage = (r: unknown, opts?: { tolerancePp?: number }): ResultPageProps => adapt(r, opts) as ResultPageProps

const rule = (rule_id: string, status: string, over: Record<string, unknown> = {}) => ({
  rule_id, label: `Label ${rule_id}`, enabled: status !== 'SKIPPED', status, summary: `${rule_id} summary`,
  db_value: 'A', vendor_value: 'B', detail: '', ...over,
})

const result = (over: Record<string, unknown> = {}) => ({
  application_id: 42,
  application_number: 'APP-2026-000123',
  data_source: 'postgres',
  vendor_final_status: 'approved',
  report_file: 'tsr.pdf',
  run_id: 'run-1',
  comparison_results: [
    rule('rule_1_owner_name', 'PASS'),
    rule('rule_9_completion_percent', 'REFER', { db_value: 80, vendor_value: 65,
      summary: 'Difference is 15 percentage points (tolerance 10).' }),
    rule('rule_13_location', 'PENDING', { db_value: { pincode: '411001', city: 'Pune', state: 'MH' },
      vendor_value: { pincode: '411001', city: 'pune', state: '' } }),
    rule('rule_14_unit_number', 'SKIPPED', { db_value: null, vendor_value: null, summary: 'Disabled in config.py' }),
  ],
  source_evidence: { property_address: 'Flat 4, Baner, Pune' },
  summary: {
    overall: 'REFER',
    counts: { PASS: 1, REFER: 1, PENDING: 1 },
    vendor_final_status: 'approved',
    vendor_status_conflict: true,
    conflict_reason: 'Vendor marked approved but rule outcome is REFER.',
    recommended_actions: ['Label rule_9_completion_percent: send back for manual review — Difference is 15 percentage points (tolerance 10).'],
  },
  ...over,
})

describe('collateral result adapter', () => {
  it('basic card: application, decision and counts (switched-off rules not counted)', () => {
    const page = toResultPage(result())
    expect(page.basic.eyebrow).toBe('Credit underwriting · Collateral verification')
    expect(page.basic.title).toBe('APP-2026-000123')
    expect(page.basic.decision).toEqual({ label: 'Refer', tone: 'fail' })
    expect(page.basic.facts).toContainEqual({ label: 'Property address', value: 'Flat 4, Baner, Pune' })
    expect(page.basic.kpis!.map((k) => k.value)).toEqual([3, 1, 1, 1])
  })

  it('rules: problems first, the agent\'s word, compared values', () => {
    const rules = toResultPage(result()).rules!.rules
    expect(rules.map((r) => r.id)).toEqual(['rule_9_completion_percent', 'rule_13_location', 'rule_1_owner_name', 'rule_14_unit_number'])
    expect(rules[0]).toMatchObject({ outcome: 'fail', outcomeLabel: 'Refer', detail: 'Difference is 15 percentage points (tolerance 10).' })
    expect(rules[1].outcome).toBe('review')
    expect(rules[1].values![1]).toEqual({ label: 'Vendor report', value: 'pincode: 411001 · city: pune' })
    expect(rules[3]).toMatchObject({ outcome: 'na', outcomeLabel: 'Skipped' })
  })

  it('calculations: counts, completion against the tolerance, location parts, vendor conflict', () => {
    const rows = toResultPage(result(), { tolerancePp: 5 }).calculations!.rows
    const by = (group: string, label: string) => rows.find((r) => r.group === group && r.label === label)
    expect(by('Rule outcomes', 'Refer')).toMatchObject({ value: 1, tone: 'fail' })
    expect(by('Rule outcomes', 'Switched off')!.value).toBe(1)
    // the tolerance the rule says it used wins over /config
    expect(by('Construction completion', 'Difference')).toMatchObject({ value: '15 pp', hint: 'tolerance 10 pp', tone: 'fail' })
    expect(by('Location', 'City')).toMatchObject({ value: 'Pune / pune', tone: 'pass' })
    expect(by('Location', 'State')!.tone).toBe('review')
    expect(by('Vendor', 'Conflict with the rules')).toMatchObject({ value: 'Yes', tone: 'fail' })
  })

  it('summary: the conflict first, then the recommended actions', () => {
    const s = toResultPage(result()).summary!
    expect(s.source).toBe('Rules summary')
    expect(s.points[0]).toBe('Vendor marked approved but rule outcome is REFER.')
    expect(s.points).toHaveLength(2)
  })

  it('summary derived from the rules when the engine wrote none', () => {
    const s = toResultPage(result({ summary: { overall: 'REFER', counts: {}, recommended_actions: [] } })).summary!
    expect(s.points[0]).toBe('1 of 3 applicable rules passed.')
    expect(s.points[1]).toMatch(/^Label rule_9_completion_percent: Difference/)
  })

  it('helpers', () => {
    expect(toneOf('WARNING')).toBe('review')
    expect(toneOf('NOT_APPLICABLE')).toBe('na')
    expect(statusWord('NOT_APPLICABLE')).toBe('Not applicable')
    expect(valueText(['A', { x_y: 1 }])).toBe('A; x y: 1')
    expect(valueText(null)).toBe('Not available')
  })

  it('actions are presentational (no workflow in this agent yet)', () => {
    expect(toResultPage(result()).actions!.every((a) => !a.onClick)).toBe(true)
  })
})
