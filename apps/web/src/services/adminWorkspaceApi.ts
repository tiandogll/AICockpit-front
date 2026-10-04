import { requireJson } from './apiClient'
import { useAuthStore } from '../stores/auth'
import type { AuditEvent, CohortOption, PrivacyPreview, SecurityStatus } from './analyticsApi'

export type OrganizationRole = 'learner' | 'evaluator' | 'org_admin'
export type OrganizationMember = {
  membership_id: string
  user_id: string
  username?: string | null
  email: string | null
  display_name: string
  role: OrganizationRole | 'system_admin'
  is_active: boolean
}
export type ProviderHealth = {
  requested_provider: string
  active_provider: string
  configured: boolean
  ready: boolean
  model: string
  circuit_state: string
  failure_count: number
  retry_after_seconds: number | null
  fallback_enabled: boolean
  daily_token_quota: number
  tokens_used_today: number
  timeout_seconds: number
  max_retries: number
}
export type PrivacyRun = {
  id: string
  organization_id: string
  cutoff_at: string
  mode: string
  status: string
  result_counts: Record<string, number>
  failure_code: string | null
  completed_at: string | null
  replayed: boolean
}
export type { AuditEvent, CohortOption, PrivacyPreview, SecurityStatus }

function organizationPath(id: string, admin = false) {
  if (!id) throw new Error('请先选择可访问的组织。')
  return `${admin ? '/admin' : ''}/organizations/${encodeURIComponent(id)}`
}
async function request<T>(path: string, fallback: string, init?: RequestInit) {
  return requireJson<T>(await useAuthStore().request(path, init), fallback)
}
const jsonBody = (method: string, payload: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
})
const writeHeaders = (key: string) => ({ 'Idempotency-Key': key, 'X-Request-ID': key })

export async function listOrganizationMembers(organizationId: string) {
  return request<OrganizationMember[]>(
    `${organizationPath(organizationId)}/members`,
    '无法读取组织成员，请重试。',
  )
}
export async function addOrganizationMember(
  organizationId: string,
  userId: string,
  role: OrganizationRole,
) {
  return request<OrganizationMember>(
    `${organizationPath(organizationId)}/members`,
    '添加成员失败，请核对用户 ID 和权限。',
    jsonBody('POST', { user_id: userId, role }),
  )
}
export async function changeOrganizationRole(
  organizationId: string,
  userId: string,
  role: OrganizationRole,
) {
  return request<OrganizationMember>(
    `${organizationPath(organizationId)}/members/${encodeURIComponent(userId)}`,
    '修改角色失败。最后一位组织管理员不能降级。',
    jsonBody('PATCH', { role }),
  )
}
export async function listAdminCohorts(organizationId: string) {
  return request<CohortOption[]>(
    `${organizationPath(organizationId)}/cohorts`,
    '无法读取班级与部门，请重试。',
  )
}
export async function createAdminCohort(
  organizationId: string,
  payload: { name: string; kind: 'class' | 'department'; code: string },
  key: string,
) {
  const init = jsonBody('POST', payload)
  return request<CohortOption>(
    `${organizationPath(organizationId)}/cohorts`,
    '创建分组失败，请确认代号没有重复。',
    { ...init, headers: { ...init.headers, ...writeHeaders(key) } },
  )
}
export async function assignCohortMember(
  organizationId: string,
  cohortId: string,
  userId: string,
  key: string,
) {
  return request<CohortOption>(
    `${organizationPath(organizationId)}/cohorts/${encodeURIComponent(cohortId)}/members/${encodeURIComponent(userId)}`,
    '分配成员失败，请核对组织和分组。',
    { method: 'PUT', headers: writeHeaders(key) },
  )
}
export async function readProviderHealth() {
  return request<ProviderHealth>('/ai/providers/health', '无法读取模型服务状态，请重试。')
}
export async function readOrganizationSecurity(organizationId: string) {
  return request<SecurityStatus>(
    `${organizationPath(organizationId, true)}/security/status`,
    '无法读取组织安全状态，请重试。',
  )
}
export async function readOrganizationAudit(organizationId: string) {
  return request<AuditEvent[]>(
    `${organizationPath(organizationId, true)}/audit-events?limit=50`,
    '无法读取组织审计记录，请重试。',
  )
}
export async function previewRetention(organizationId: string) {
  return request<PrivacyPreview>(
    `${organizationPath(organizationId, true)}/privacy-runs/preview`,
    '无法预览保留期清理范围，请重试。',
    { method: 'POST', headers: { 'X-Request-ID': crypto.randomUUID() } },
  )
}
export async function executeRetention(organizationId: string, key: string) {
  return request<PrivacyRun>(
    `${organizationPath(organizationId, true)}/privacy-runs`,
    '清理尚未确认完成。请使用同一请求重试，不要新建清理任务。',
    { method: 'POST', headers: writeHeaders(key) },
  )
}
