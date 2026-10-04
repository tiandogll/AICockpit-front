import { useAuthStore } from '../stores/auth'
import { requireJson, responseError } from './apiClient'
import type { AssessmentItem, AssessmentSession } from './assessmentApi'

export type AssessmentDraft = {
  response: Record<string, unknown>
  revision: number
  context_revision: number
  saved_at: string
}
export type DraftSnapshot = {
  draft: AssessmentDraft | null
  context_revision: number
  can_edit: boolean
}
export type IssuedAssessmentItem = {
  item_version_id: string
  sequence: number
  item_type: AssessmentItem['item_type']
  dimension_code: string
  answered_at: string | null
  flagged: boolean
}
export type AssessmentWorkspace = {
  data_origin?: string | null
  session: AssessmentSession
  server_now: string
  blueprint_name: string
  min_items: number
  max_items: number
  answered_count: number
  dispatched_count: number
  flagged_count: number
  current_item: AssessmentItem | null
  items: IssuedAssessmentItem[]
  type_coverage: {
    item_type: AssessmentItem['item_type']
    answered_count: number
    minimum: number
  }[]
  can_complete: boolean
  completion_reason: string
  stopping_policy_version?: string | null
  unmet_dimensions: string[]
  unmet_item_types: string[]
}
export type AssessmentReview = {
  item: AssessmentItem
  response: Record<string, unknown> | null
  draft: AssessmentDraft | null
  dialogue_turns: { sequence: number; user_content: string; assistant_content: string | null }[]
  answered_at: string | null
  read_only: true
}
const itemPath = (session: string, item: string) => `/sessions/${session}/items/${item}`
async function json<T>(path: string, init: RequestInit = {}) {
  return requireJson<T>(await useAuthStore().request(path, init), '测评状态未能同步，请重试。')
}
export const getAssessmentWorkspace = (id: string, signal?: AbortSignal) =>
  json<AssessmentWorkspace>(`/sessions/${id}/workspace`, { signal })
// Ending the same session again is a no-op on the server, including network retries.
export const abandonAssessment = (id: string) =>
  json<AssessmentSession>(`/sessions/${id}/abandon`, { method: 'POST' })
export const setAssessmentActivity = (id: string, paused: boolean, revision: number) =>
  json<AssessmentSession>(`/sessions/${id}/activity`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paused, revision }),
  })
export const getAssessmentReview = (id: string, item: string, signal?: AbortSignal) =>
  json<AssessmentReview>(`${itemPath(id, item)}/review`, { signal })
export const getAssessmentDraft = (id: string, item: string, signal?: AbortSignal) =>
  json<DraftSnapshot>(`${itemPath(id, item)}/draft`, { signal })
export function putAssessmentDraft(
  id: string,
  item: string,
  value: { response: Record<string, unknown>; revision: number; context_revision: number },
  key: string,
  signal?: AbortSignal,
) {
  return json<DraftSnapshot>(`${itemPath(id, item)}/draft`, {
    method: 'PUT',
    signal,
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify(value),
  })
}
export function setAssessmentFlag(id: string, item: string, flagged: boolean, key: string) {
  return json<{ item_version_id: string; flagged: boolean }>(`${itemPath(id, item)}/flag`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify({ flagged }),
  })
}

export type DialogueAttachment = {
  id: string
  filename: string
  media_type: string
  byte_size: number
  sha256: string
  state: 'uploading' | 'ready' | 'failed' | 'deleted'
  parse_status: 'text_ready' | 'manual_review' | 'unavailable'
  bound_turn_id: string | null
  created_at: string
}
const attachmentPath = (session: string, item: string) =>
  `/sessions/${session}/dialogue/${item}/attachments`
export const getDialogueAttachments = (id: string, item: string) =>
  json<{ attachments: DialogueAttachment[] }>(attachmentPath(id, item))
export function uploadDialogueAttachment(id: string, item: string, file: File, key: string) {
  const body = new FormData()
  body.append('file', file)
  return json<DialogueAttachment>(attachmentPath(id, item), {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body,
  })
}
export async function deleteDialogueAttachment(
  id: string,
  item: string,
  attachment: string,
  key: string,
) {
  const response = await useAuthStore().request(`${attachmentPath(id, item)}/${attachment}`, {
    method: 'DELETE',
    headers: { 'Idempotency-Key': key },
  })
  if (!response.ok) throw await responseError(response, '附件未能删除。')
}
export async function downloadDialogueAttachment(
  id: string,
  item: string,
  attachment: DialogueAttachment,
  signal?: AbortSignal,
) {
  const response = await useAuthStore().request(
    `${attachmentPath(id, item)}/${attachment.id}/content`,
    { signal },
  )
  if (!response.ok) throw await responseError(response, '附件暂时无法下载。')
  const blob = await response.blob()
  signal?.throwIfAborted()
  if (
    blob.size !== attachment.byte_size ||
    blob.size > 5 * 1024 * 1024 ||
    response.headers.get('X-Artifact-SHA256') !== attachment.sha256 ||
    blob.type.split(';')[0] !== attachment.media_type
  )
    throw new Error('附件信息与封存记录不一致，已停止下载。')
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = attachment.filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
