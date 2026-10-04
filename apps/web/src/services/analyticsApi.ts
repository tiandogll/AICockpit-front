import { requireJson } from './apiClient'
import { useAuthStore } from '../stores/auth'

export type OrganizationOption = {
  id: string
  name: string
  slug: string
  role: 'learner' | 'evaluator' | 'org_admin' | 'system_admin'
}
export type CohortOption = {
  id: string
  organization_id: string
  name: string
  kind: 'class' | 'department'
  code: string
  is_active: boolean
  member_count: number
}
export type DimensionAggregate = {
  code: string
  sample_size: number
  levels: Record<'L1' | 'L2' | 'L3' | 'L4', number>
  mean_theta: number
  mean_standard_error: number
  mean_evidence_count: number
}
export type AnalyticsOverview = {
  organization_id: string
  organization_name: string
  cohort_id: string | null
  cohort_name: string | null
  measurement_count: number
  methodology: string
  generated_at: string
  suppressed: boolean
  participant_count: number | null
  minimum_group_size: number
  dimensions: DimensionAggregate[]
  common_gaps: Array<{ code: string; mean_theta: number; sample_size: number }>
}
export type ItemQuality = {
  item_id: string
  logical_id: string
  version: number
  dimension_code: string
  item_type: 'objective' | 'dialogue' | 'practical'
  difficulty: number
  response_count: number | null
  participant_count: number | null
  objective_correct_rate: number | null
  objective_discrimination: number | null
  finalized_count: number
  mean_final_score: number | null
  human_review_rate: number | null
  suppressed: boolean
}
export type SecurityStatus = {
  organization_id: string
  model_tokens_used_today: number
  model_daily_token_quota: number
  recent_audit_events: number
  retention_days: number
  minimum_group_size: number
}
export type AuditEvent = {
  id: string
  action: string
  outcome: 'succeeded' | 'denied' | 'failed'
  resource_type: string
  occurred_at: string
  event_metadata: Record<string, unknown>
}
export type PrivacyPreview = {
  organization_id: string
  cutoff_at: string
  retention_days: number
  result_counts: Record<string, number>
}

function cohortQuery(cohortId: string) {
  return cohortId ? `?cohort_id=${encodeURIComponent(cohortId)}` : ''
}

export async function listOrganizations() {
  const response = await useAuthStore().request('/organizations')
  return requireJson<OrganizationOption[]>(response, '无法读取可访问组织。')
}

export async function listCohorts(organizationId: string) {
  const response = await useAuthStore().request(`/organizations/${organizationId}/cohorts`)
  return requireJson<CohortOption[]>(response, '无法读取班级与部门分组。')
}

export async function getAnalyticsOverview(organizationId: string, cohortId = '') {
  const response = await useAuthStore().request(
    `/admin/organizations/${organizationId}/analytics/overview${cohortQuery(cohortId)}`,
  )
  return requireJson<AnalyticsOverview>(response, '无法读取组织能力分布。')
}

export async function getItemQuality(organizationId: string, cohortId = '') {
  const response = await useAuthStore().request(
    `/admin/organizations/${organizationId}/analytics/items${cohortQuery(cohortId)}`,
  )
  return requireJson<ItemQuality[]>(response, '无法读取题目质量。')
}

export async function getSecurityStatus(organizationId: string) {
  const response = await useAuthStore().request(
    `/admin/organizations/${organizationId}/security/status`,
  )
  return requireJson<SecurityStatus>(response, '无法读取安全治理状态。')
}

export async function getAuditEvents(organizationId: string) {
  const response = await useAuthStore().request(
    `/admin/organizations/${organizationId}/audit-events?limit=8`,
  )
  return requireJson<AuditEvent[]>(response, '无法读取最近审计事件。')
}

export async function previewPrivacyRun(organizationId: string) {
  const response = await useAuthStore().request(
    `/admin/organizations/${organizationId}/privacy-runs/preview`,
    { method: 'POST', headers: { 'X-Request-ID': crypto.randomUUID() } },
  )
  return requireJson<PrivacyPreview>(response, '无法预览匿名化范围。')
}

export async function executePrivacyRun(organizationId: string) {
  const response = await useAuthStore().request(
    `/admin/organizations/${organizationId}/privacy-runs`,
    {
      method: 'POST',
      headers: {
        'Idempotency-Key': crypto.randomUUID(),
        'X-Request-ID': crypto.randomUUID(),
      },
    },
  )
  return requireJson<{ status: string; result_counts: Record<string, number> }>(
    response,
    '匿名化作业执行失败。',
  )
}

export async function downloadAnalyticsCsv(organizationId: string, cohortId = '') {
  const response = await useAuthStore().request(
    `/admin/organizations/${organizationId}/analytics/export.csv${cohortQuery(cohortId)}`,
    { headers: { 'X-Request-ID': crypto.randomUUID() } },
  )
  if (!response.ok) throw new Error('组织分析导出失败。')
  return response.blob()
}
