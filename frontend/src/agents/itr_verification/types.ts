export interface MismatchItem {
  field: string
  input: any
  output: any
  severity: 'critical' | 'high' | 'medium' | 'low' | string
  message: string
}

export interface FieldResultItem {
  field: string
  input_value: any
  output_value: any
  matched: boolean
  score: number
  weight: number
  weighted_score: number
  severity: string
  description: string
  message: string
}

export interface VerificationResponse {
  decision: 'ACCEPT' | 'REVIEW' | 'REJECT' | string
  overall_score: number
  summary: string
  vendor_final_status?: string
  critical_failures: string[]
  mismatches: MismatchItem[]
  field_results: FieldResultItem[]
  input_fields: Record<string, any>
  output_fields: Record<string, any>
  input_document?: string
  output_document?: string
}
