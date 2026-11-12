import { describe, expect, it } from 'vitest'
import { buildReportPdf } from '../agents/itr_verification/utils/downloadReport'

describe('ITR comparison report PDF', () => {
  it('builds a PDF with the vendor report on the last page', () => {
    const doc = buildReportPdf({
      decision: 'REVIEW', overall_score: 72.5, summary: 'Income differs.', critical_failures: [], mismatches: [],
      field_results: [{ field: 'total_income', matched: false, severity: 'high', input_value: 850000, output_value: 700000, score: 40, weight: 2, weighted_score: 0.8, message: 'Mismatch' } as never],
      input_fields: {}, output_fields: { pan: 'ABCDE1234F', total_income: 700000 }, input_document: 'c.pdf', output_document: 'v.pdf',
    })
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(2)
    expect(String(doc.output('arraybuffer').byteLength)).not.toBe('0')
  })
})
