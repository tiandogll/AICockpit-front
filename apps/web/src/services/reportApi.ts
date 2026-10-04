import { requireJson } from './apiClient'
import { useAuthStore } from '../stores/auth'

export type EvidenceTrace = {
  criterion_code: string
  score: number
  confidence: number
  quote: string
  rationale: string
  evidence_hash: string
  verified: boolean
}
export type DecisionTrace = {
  decision_id: string
  item_type: string
  score: number
  confidence: number
  source: 'auto' | 'human'
  policy_version: string
  tasks: Array<{
    id: string
    role: string
    model: string
    prompt_version: string
    result_hash: string
    evidence: EvidenceTrace[]
  }>
}
export type DimensionReport = {
  theta?: number
  standard_error?: number
  evidence_count?: number
  level?: string
  objective_measurement?: {
    theta: number
    standard_error: number
    evidence_count: number
    level: string
  } | null
  rubric_measurement?: {
    mean_score: number | null
    mean_confidence: number | null
    completed: number
    pending: number
    decisions: DecisionTrace[]
  }
  synthesis?: {
    index: number | null
    level: string
    method_version: string
    evidence_count: number
  }
}
export type TrustedReport = {
  id: string
  session_id: string
  is_complete: boolean
  revision: number
  processing?: {
    state: 'complete' | 'needs_review' | 'paused' | 'pending' | 'retrying' | 'blocked'
    automatic_scoring_enabled: boolean
    failed_answers: number
    pending_answers: number
    review_answers: number
  }
  payload: {
    data_origin?: string | null
    assessment?: {
      mode?: string
      scenario?: string
      data_origin?: string | null
      blueprint?: { configuration?: Record<string, unknown> }
    }
    summary?: Record<string, number | null>
    scoring_setup_issues?: unknown[]
    dimensions?: Record<string, DimensionReport>
    measurement_status?: 'pending_scoring' | 'needs_review' | 'complete' | null
    measurement_note?: string
    recommendations?: Array<{ dimension_code: string; action: string }>
    strengths?: string[]
    scoring_policy_version?: string
  }
}

export async function getReport(sessionId: string, signal?: AbortSignal) {
  const response = await useAuthStore().request(`/reports/${sessionId}`, { signal })
  return requireJson<TrustedReport>(response, '无法读取本次能力报告。')
}

export async function downloadReportPdf(sessionId: string) {
  const response = await useAuthStore().request(`/reports/${sessionId}/export.pdf`, {
    headers: { 'X-Request-ID': crypto.randomUUID() },
  })
  if (!response.ok) throw new Error('报告PDF导出失败。')
  return response.blob()
}
