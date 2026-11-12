// Residence / office verification result -> the console's common result layout (shared/components/result).
// Pure: (API result, the form that was sent, the AI summary) -> ResultPageProps. Only fields the API returns.
//
// Tone mapping (RuleRow.outcome):
//   rule not triggered                         -> pass   (label: the rule's own status, e.g. "PASS")
//   triggered, criticality CRITICAL or HIGH    -> fail   (label "Triggered")
//   triggered, criticality MEDIUM / LOW / none -> review (label "Triggered")
// Overall recommendation word -> decision tone: approve/pass/positive -> pass; reject/fail/negative/decline -> fail;
// refer/review/hold -> review; anything else -> info.

/** @typedef {import('../../../shared/components').ResultPageProps} ResultPageProps */
/** @typedef {import('../../../shared/components').Tone} Tone */

/** @returns {Tone} */
export function recommendationTone(rec = '') {
  const r = String(rec).toLowerCase()
  if (/approve|pass|positive|accept/.test(r)) return 'pass'
  if (/reject|fail|negative|decline/.test(r)) return 'fail'
  if (/refer|review|hold/.test(r)) return 'review'
  return 'info'
}

/** @returns {Tone} */
export function ruleTone(rule) {
  if (!rule.triggered) return 'pass'
  return rule.criticality === 'CRITICAL' || rule.criticality === 'HIGH' ? 'fail' : 'review'
}

const CRIT_ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, NONE: 4 }

/** Triggered first, then by criticality, then by weight; RULE_10 is an internal roll-up and is not listed. */
export function orderRules(rules = []) {
  return [...rules]
    .filter((r) => r.rule_key !== 'RULE_10')
    .sort((a, b) => {
      if (a.triggered !== b.triggered) return a.triggered ? -1 : 1
      const ca = CRIT_ORDER[a.criticality] ?? 99
      const cb = CRIT_ORDER[b.criticality] ?? 99
      if (ca !== cb) return ca - cb
      return (b.weight || 0) - (a.weight || 0)
    })
}

/** Text -> sentences / bullet lines (no empties). */
export function toPoints(text) {
  if (!text) return []
  return String(text)
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((s) => s.replace(/^[\s•*\-–\d.)]+/, '').trim())
    .filter((s) => s.length > 2)
}

const VENDOR_FIELDS = [
  ['status', 'Status'], ['final_status', 'Final status'], ['neighbour_check', 'Neighbour check'],
  ['address_confirmed', 'Address confirmed'], ['negative_area', 'Negative area'], ['political_link', 'Political link'],
  ['name_plate_visible', 'Name plate visible'], ['community_dominated', 'Community dominated'],
]

/**
 * @param {any} result   POST /residence-verification answer
 * @param {any} form     the request that was sent (application, participant, type, vendor response)
 * @param {string} aiSummary  the local model's summary ('' when none)
 * @returns {ResultPageProps}
 */
export function toResultPage(result, form = {}, aiSummary = '') {
  const rules = orderRules(result?.rules)
  const triggered = rules.filter((r) => r.triggered)
  const failed = triggered.filter((r) => ruleTone(r) === 'fail').length
  const review = triggered.length - failed
  const type = form.verification_type || 'RESIDENCE'

  const aiPoints = toPoints(aiSummary)
  const rulePoints = toPoints(result?.summary)
  const points = aiPoints.length
    ? aiPoints
    : rulePoints.length
      ? rulePoints
      : triggered.slice(0, 5).map((r) => `${r.rule_name}: ${r.finding || r.summary || 'triggered'}`)

  const vr = form.vendor_response || {}
  const vendorRows = VENDOR_FIELDS
    .filter(([key]) => vr[key] != null && vr[key] !== '')
    .map(([key, label]) => ({ group: 'Vendor response', label, value: String(vr[key]) }))

  return {
    basic: {
      eyebrow: `Credit underwriting · ${type === 'OFFICE' ? 'Office' : 'Residence'} verification`,
      title: `Application ${form.application_id ?? '—'}`,
      subtitle: `Participant ${form.participant_id ?? '—'} · ${type}`,
      icon: 'home',
      decision: result?.overall_recommendation
        ? { label: result.overall_recommendation, tone: recommendationTone(result.overall_recommendation) }
        : undefined,
      facts: [
        { label: 'Application', value: form.application_id ?? '—', mono: true },
        { label: 'Participant', value: form.participant_id ?? '—', mono: true },
        { label: 'Vendor', value: result?.vendor?.name || form.vendor_name || '—' },
        { label: 'Criticality', value: result?.overall_criticality || '—' },
      ],
      kpis: [
        { label: 'Rules checked', value: result?.rules_evaluated ?? rules.length, tone: 'info' },
        { label: 'Passed', value: rules.length - triggered.length, tone: 'pass' },
        { label: 'Review', value: review, tone: 'review' },
        { label: 'Failed', value: failed, tone: 'fail' },
      ],
    },
    summary: {
      title: aiPoints.length ? 'AI risk summary' : 'Summary',
      source: aiPoints.length ? 'AI summary' : 'Rules summary',
      points,
      empty: 'No summary for this run.',
    },
    rules: {
      title: 'Rules',
      rules: rules.map((r) => ({
        id: r.rule_id || r.rule_key,
        name: r.rule_name,
        outcome: ruleTone(r),
        outcomeLabel: r.triggered ? 'Triggered' : (r.status || 'Pass'),
        severity: r.criticality && r.criticality !== 'NONE' ? r.criticality : undefined,
        detail: r.finding || r.summary,
        values: [
          ...(r.summary ? [{ label: 'Check', value: r.summary }] : []),
          ...(r.finding ? [{ label: 'Finding', value: r.finding }] : []),
          ...(r.recommended_action ? [{ label: 'Action', value: r.recommended_action }] : []),        ],
      })),
    },
    calculations: {
      title: 'Field report',
      rows: [
        { group: 'Outcome', label: 'Recommendation', value: result?.overall_recommendation || '—',
          tone: recommendationTone(result?.overall_recommendation) },
        { group: 'Outcome', label: 'Rules triggered', value: `${result?.rules_triggered ?? triggered.length} of ${result?.rules_evaluated ?? rules.length}` },
        { group: 'Outcome', label: 'Vendor status', value: [result?.vendor?.status, result?.vendor?.final_status].filter(Boolean).join(' / ') || '—' },
        ...vendorRows,
        ...(vr.corrected_address ? [{ group: 'Vendor response', label: 'Corrected address', value: vr.corrected_address }] : []),
      ],
    },
    actions: [
      { id: 'report', label: 'Download report', kind: 'ghost', icon: 'download' },
      { id: 'hold', label: 'Hold', kind: 'warning', icon: 'pause' },
      { id: 'decline', label: 'Decline', kind: 'danger', icon: 'x' },
      { id: 'submit', label: 'Submit', kind: 'primary', icon: 'send' },
    ],
  }
}
