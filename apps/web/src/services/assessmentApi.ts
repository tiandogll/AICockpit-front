import { ApiError, requireJson } from './apiClient'
import { useAuthStore } from '../stores/auth'
import type { AssessmentMedia } from '../domain/assessmentMedia'

export type LaunchOrganization = { id: string; name: string; role: string }
export type LaunchBlueprint = {
  id: string
  name: string
  mode: 'rapid' | 'standard' | 'specialized' | 'fixed'
  scenario: 'general' | 'higher_education' | 'enterprise'
  min_items: number
  max_items: number
  item_type_minimums: Record<'objective' | 'dialogue' | 'practical', number>
  dimension_codes: string[]
  assessment_time_limit_seconds?: number | null
  organization_ids?: string[] | null
  data_origin?: string | null
}
export type LaunchSession = {
  id: string
  organization_id: string
  blueprint_version_id: string | null
  blueprint_name: string
  mode: string
  scenario: string
  status: 'active'
  created_at: string
  data_origin?: string | null
}
export type LaunchContext = {
  organizations: LaunchOrganization[]
  blueprints: LaunchBlueprint[]
  active_sessions: LaunchSession[]
}
export type AssessmentSession = {
  data_origin?: string | null
  id: string
  organization_id: string
  blueprint_version_id: string | null
  mode: string
  scenario: string
  status: 'active' | 'completed' | 'abandoned'
  blueprint_snapshot: Record<string, unknown>
  replayed: boolean
  created_at?: string
  completed_at?: string | null
  expires_at?: string | null
  ended_at?: string | null
  ended_reason?: string | null
  paused_at?: string | null
  activity_revision?: number
}
export type AssessmentItem = {
  session_id: string
  item_version_id: string
  sequence: number
  item_type: 'objective' | 'dialogue' | 'practical'
  dimension_code: string
  difficulty: number
  stem: string
  configuration: Record<string, unknown> & { media?: AssessmentMedia | null }
}
export type ObjectiveAnswer = {
  answer_id: string
  item_version_id: string
  score: number
  max_score: number
  is_correct: boolean
  dimension_code: string
  theta: number
  standard_error: number
  evidence_count: number
  replayed: boolean
}
export type StoppingDecision = {
  should_stop: boolean
  reason: string
  unmet_dimensions: string[]
  unmet_item_types: string[]
}

async function authenticatedJson<T>(path: string, init: RequestInit, fallback: string) {
  const response = await useAuthStore().request(path, init)
  return requireJson<T>(response, fallback)
}

export function getLaunchContext() {
  return authenticatedJson<LaunchContext>(
    '/assessment-definitions/launch-context',
    {},
    '无法读取可用测评，请稍后重试。',
  )
}

export function createAssessmentSession(
  organizationId: string,
  blueprintVersionId: string,
  idempotencyKey: string,
) {
  return authenticatedJson<AssessmentSession>(
    '/sessions',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({
        organization_id: organizationId,
        blueprint_version_id: blueprintVersionId,
      }),
    },
    '无法创建测评会话。',
  )
}

export function getAssessmentSession(sessionId: string) {
  return authenticatedJson<AssessmentSession>(`/sessions/${sessionId}`, {}, '无法恢复测评会话。')
}

export function getNextItem(sessionId: string) {
  return authenticatedJson<AssessmentItem>(
    `/sessions/${sessionId}/next`,
    { method: 'POST' },
    '暂时无法派发下一题。',
  )
}

export function submitObjectiveAnswer(
  sessionId: string,
  itemVersionId: string,
  selectedOption: string,
  idempotencyKey: string,
) {
  return authenticatedJson<ObjectiveAnswer>(
    `/sessions/${sessionId}/answers`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({
        item_version_id: itemVersionId,
        response: { selected_option: selectedOption },
      }),
    },
    '回答未能保存，请保持选项不变后重试。',
  )
}

export function getStoppingDecision(sessionId: string) {
  return authenticatedJson<StoppingDecision>(
    `/sessions/${sessionId}/stopping-decision`,
    {},
    '无法确认测评是否完成。',
  )
}

export function completeAssessment(sessionId: string, key?: string) {
  return authenticatedJson<{ session_id: string; report_id: string; is_complete: boolean }>(
    `/sessions/${sessionId}/complete`,
    { method: 'POST', headers: key ? { 'Idempotency-Key': key } : undefined },
    '测评完成状态未能封存。',
  )
}

export function operationKey(prefix: string) {
  return `${prefix}:${crypto.randomUUID()}`
}

export { ApiError }
