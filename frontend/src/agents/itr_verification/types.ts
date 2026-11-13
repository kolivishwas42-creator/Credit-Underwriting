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
  /** the application / participant the run was for (answered back by the backend) */
  application_number?: string | null
  participant_id?: number | null
  participant_name?: string | null
}

/** GET /applications/{application_number}/participants */
export interface ApplicationParticipants {
  application: { application_id: number; application_number: string }
  participants: { participant_id: number; name: string | null; applicant_type: string | null; is_primary: boolean }[]
}
