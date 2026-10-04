import { useAuthStore } from '../stores/auth'
import { requireJson } from './apiClient'
import type { ContentIdentity, ContentRecord, CreateItemRequest } from './contentApi'

export type ContentPage = { items: ContentRecord[]; total: number; limit: number; offset: number }
export type ContentAssignment = {
  id: string
  user_id: string
  display_name: string
  item_logical_id: string
  active: boolean
  assigned_by: string | null
  created_at: string
  updated_at: string
}
export type AuthoringAdapter = {
  save: (body: CreateItemRequest, key: string) => Promise<ContentIdentity>
  rubrics: (offset: number) => Promise<ContentPage>
}
function writeHeaders(key: string) {
  if (key.length < 8 || key.length > 128 || /\s/.test(key))
    throw new Error('缺少有效的重试标识，请重新打开任务。')
  return { 'Content-Type': 'application/json', 'Idempotency-Key': key }
}
export async function listAssignedItems(status = '', offset = 0) {
  const query = new URLSearchParams({ limit: '20', offset: String(offset) })
  if (status) query.set('publication_status', status)
  return requireJson<ContentPage>(
    await useAuthStore().request(`/teacher/items/details?${query}`),
    '无法读取指派任务，请重新读取。',
  )
}
export async function getAssignedItem(id: string) {
  return requireJson<ContentRecord>(
    await useAuthStore().request(`/teacher/items/${encodeURIComponent(id)}`),
    '无法读取此指派题目，指派可能已被撤销。',
  )
}
export async function listAssignedRubrics(id: string, offset = 0) {
  const query = new URLSearchParams({ limit: '20', offset: String(offset) })
  return requireJson<ContentPage>(
    await useAuthStore().request(`/teacher/items/${encodeURIComponent(id)}/rubrics?${query}`),
    '无法读取此题关联的量规，请重试。',
  )
}
export async function createAssignedVersion(id: string, body: CreateItemRequest, key: string) {
  // The source URL is the authorization boundary; never send an arbitrary logical ID.
  const version = { ...body }
  delete version.logical_id
  return requireJson<ContentIdentity>(
    await useAuthStore().request(`/teacher/items/${encodeURIComponent(id)}/versions`, {
      method: 'POST',
      headers: writeHeaders(key),
      body: JSON.stringify(version),
    }),
    '草稿未能保存，已保留编辑内容，请核对后重试。',
  )
}
export async function submitAssignedItem(id: string, key: string) {
  return requireJson<ContentIdentity>(
    await useAuthStore().request(`/teacher/items/${encodeURIComponent(id)}/submit`, {
      method: 'POST',
      headers: writeHeaders(key),
    }),
    '提交审核未完成，请核对当前状态后重试。',
  )
}
export async function listItemAssignments(id: string) {
  return requireJson<ContentAssignment[]>(
    await useAuthStore().request(`/admin/items/${encodeURIComponent(id)}/assignments`),
    '无法读取题目指派，请重试。',
  )
}
export async function setItemAssignment(id: string, userId: string, active: boolean, key: string) {
  return requireJson<ContentAssignment>(
    await useAuthStore().request(
      `/admin/items/${encodeURIComponent(id)}/assignments/${encodeURIComponent(userId)}`,
      {
        method: 'PUT',
        headers: writeHeaders(key),
        body: JSON.stringify({ active }),
      },
    ),
    '指派未能更新，请核对用户 ID 后重试。',
  )
}
