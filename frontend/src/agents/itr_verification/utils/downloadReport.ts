// The comparison report the officer downloads from the result page, as a PDF: the customer-vs-vendor comparison first,
// the vendor report attached at the bottom (on its own page).
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { VerificationResponse } from '../types'
import { formatValue, humanize, toCalculations, toPoints, toRules } from './resultView'

/** the PDF's built-in font has no rupee sign or typographic characters */
const pdfText = (v: unknown) =>
  String(v ?? '').replace(/₹/g, 'Rs. ').replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\x20-\x7E -ÿ\n]/g, '?')

const fieldValue = (v: unknown) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : formatValue(v))

export function buildReportPdf(report: VerificationResponse, application?: { panNumber?: string; assessmentYear?: string }): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const margin = 40
  const width = doc.internal.pageSize.getWidth() - margin * 2
  let y = margin

  const heading = (text: string) => {
    if (y > doc.internal.pageSize.getHeight() - 90) { doc.addPage(); y = margin }
    doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(15, 23, 42).text(pdfText(text), margin, y)
    y += 8
  }
  const after = () => { y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 22 }
  const style = { styles: { fontSize: 8.5, cellPadding: 4, overflow: 'linebreak' as const, textColor: [15, 23, 42] as [number, number, number] },
                  headStyles: { fillColor: [30, 64, 175] as [number, number, number], textColor: 255 }, margin: { left: margin, right: margin } }

  const results = report.field_results || []
  const byId = new Map(results.map((r) => [r.field, r]))

  doc.setFont('helvetica', 'bold').setFontSize(18).setTextColor(15, 23, 42).text('ITR comparison report', margin, y)
  y += 18
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(100, 116, 139)
  const meta = `Customer ITR ${report.input_document || '-'} compared with vendor ITR ${report.output_document || '-'}  |  generated ${new Date().toLocaleString('en-IN')}`
  const metaLines = doc.splitTextToSize(pdfText(meta), width) as string[]
  doc.text(metaLines, margin, y)
  y += metaLines.length * 11 + 8

  const facts = [
    `Decision: ${report.decision}`,
    `Match score: ${Number(report.overall_score ?? 0).toFixed(1)}%`,
    report.vendor_final_status ? `Vendor final status: ${humanize(report.vendor_final_status.toLowerCase())}` : '',
    application?.panNumber ? `PAN: ${application.panNumber.toUpperCase()}` : '',
    application?.assessmentYear ? `Assessment year: ${application.assessmentYear}` : '',
  ].filter(Boolean)
  doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(15, 23, 42)
  const factLines = doc.splitTextToSize(pdfText(facts.join('   |   ')), width) as string[]
  doc.text(factLines, margin, y)
  y += factLines.length * 13 + 14

  heading('Summary')
  autoTable(doc, { ...style, startY: y, theme: 'plain', body: toPoints(report).map((p) => [`- ${pdfText(p)}`]) })
  after()

  heading('Field-by-field comparison')
  autoTable(doc, {
    ...style, startY: y,
    head: [['Field', 'Result', 'Severity', 'Customer / application', 'Vendor', 'Score', 'Detail']],
    body: toRules(results).map((rule) => {
      const r = byId.get(rule.id)
      return [rule.name, rule.outcomeLabel ?? '', rule.severity ?? '', formatValue(r?.input_value), formatValue(r?.output_value),
              r ? `${Number(r.score ?? 0).toFixed(0)}%` : '', rule.detail ?? ''].map(pdfText)
    }),
  })
  after()

  heading('Calculations')
  autoTable(doc, { ...style, startY: y, head: [['Group', 'Item', 'Value', 'Note']],
    body: toCalculations(report).map((c) => [c.group ?? '', c.label, String(c.value), c.hint ?? ''].map(pdfText)) })

  // the vendor report, attached at the bottom on its own page
  doc.addPage(); y = margin
  heading(`Attached: vendor report (${report.output_document || 'vendor ITR'})`)
  autoTable(doc, { ...style, startY: y, head: [['Field', 'Value in the vendor ITR']],
    body: Object.entries(report.output_fields || {}).map(([k, v]) => [humanize(k), fieldValue(v)].map(pdfText)) })

  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i).setFont('helvetica', 'normal').setFontSize(8).setTextColor(100, 116, 139)
    doc.text(`Page ${i} of ${pages}`, doc.internal.pageSize.getWidth() - margin, doc.internal.pageSize.getHeight() - 20, { align: 'right' })
  }
  return doc
}

export function downloadReport(report: VerificationResponse, application?: { panNumber?: string; assessmentYear?: string }) {
  const base = (report.input_document || 'itr').replace(/\.[a-z0-9]+$/i, '').replace(/[^\w.-]+/g, '_')
  buildReportPdf(report, application).save(`itr-comparison-${base}.pdf`)
}
