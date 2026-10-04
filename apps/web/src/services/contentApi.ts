import { useAuthStore } from '../stores/auth'
import { requireJson } from './apiClient'
export type ContentKind = 'items' | 'rubrics' | 'blueprints'
export type ContentStatus = 'draft' | 'in_review' | 'published' | 'retired'
export type ItemMetadata = {
  tags: string[]
  scenarios: Array<'general' | 'higher_education' | 'enterprise'>
  content_tier: 'basic' | 'advanced'
}
export type CreateItemRequest = {
  logical_id?: string
  dimension_code: string
  item_type: 'objective' | 'dialogue' | 'practical'
  difficulty: number
  stem: string
  configuration: Record<string, unknown>
  answer_key: Record<string, unknown> | null
  rubric_version_id: string | null
}
export type ContentIdentity = Pick<
  ContentRecord,
  'id' | 'logical_id' | 'version' | 'publication_status'
>
export type ContentRecord = {
  id: string
  logical_id: string
  version: number
  publication_status: ContentStatus
  created_at: string
  updated_at: string
  approved_at: string | null
  approved_by: string | null
  stem?: string
  title?: string
  name?: string
  dimension_code?: string
  item_type?: string
  difficulty?: number
  configuration?: Record<string, unknown>
  answer_key?: Record<string, unknown> | null
  rubric_version_id?: string | null
  criteria?: Record<string, unknown>
  mode?: string
  scenario?: string
}
export async function listContent(kind: ContentKind, status: string, offset = 0) {
  const query = new URLSearchParams({ limit: '20', offset: String(offset) })
  if (status) query.set('publication_status', status)
  return requireJson<{ items: ContentRecord[]; total: number; limit: number; offset: number }>(
    await useAuthStore().request(`/admin/content/${kind}/details?${query}`),
    '无法读取内容版本。',
  )
}
export function getContent(kind: ContentKind, id: string) {
  return useAuthStore()
    .request(`/admin/content/${kind}/${encodeURIComponent(id)}`)
    .then((response) => requireJson<ContentRecord>(response, '无法读取内容详情。'))
}
export async function createBlueprintTimingVersion(
  id: string,
  seconds: number | null,
  key: string,
) {
  return requireJson<ContentIdentity>(
    await useAuthStore().request(`/admin/blueprints/${encodeURIComponent(id)}/timing-version`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify({ assessment_time_limit_seconds: seconds }),
    }),
    '限时版本未能保存；原版本没有被修改。',
  )
}
export function createItem(body: CreateItemRequest) {
  return useAuthStore()
    .request('/admin/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    .then((response) =>
      requireJson<ContentIdentity>(response, '题目草稿未能保存，请核对内容后重试。'),
    )
}
export function transitionContent(kind: ContentKind, id: string, target: ContentStatus) {
  return useAuthStore()
    .request(`/admin/${kind}/${encodeURIComponent(id)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ target }),
      headers: { 'Content-Type': 'application/json' },
    })
    .then((response) =>
      requireJson<Pick<ContentRecord, 'id' | 'logical_id' | 'version' | 'publication_status'>>(
        response,
        '状态更新未完成，请重新读取当前版本后核对。',
      ),
    )
}
