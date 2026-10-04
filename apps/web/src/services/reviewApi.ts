import { requireJson, responseError } from './apiClient'
import { useAuthStore } from '../stores/auth'
import type { DialogueAttachment } from './assessmentWorkspaceApi'

export type ReviewQueueItem = {
  decision_id: string
  session_id: string
  item_type: string
  dimension_code: string
  provisional_score: number | null
  confidence: number | null
  review_reasons: string[]
  updated_at: string
}
export type ReviewEvidence = {
  criterion_code: string
  score: number
  confidence: number
  quote: string
  rationale: string
  evidence_hash: string
  verified: boolean
}
export type ReviewTask = {
  id: string
  role: 'primary' | 'verifier'
  state: string
  model: string
  prompt_version: string
  score: number | null
  confidence: number | null
  result_hash: string | null
  evidence: ReviewEvidence[]
}
export type ReviewDetail = {
  decision_id: string
  state: 'needs_review' | 'completed'
  provisional_score: number | null
  final_score: number | null
  confidence: number | null
  final_source: 'auto' | 'human' | null
  review_reasons: string[]
  answer: Record<string, unknown>
  item: { id: string; stem: string; item_type: string; dimension_code: string; media?: unknown }
  rubric: { id: string; version: number; title: string; criteria: Record<string, unknown> }
  tasks: ReviewTask[]
}

export type ReviewArtifact = {
  id: string
  filename: string
  media_type: string
  byte_size: number
  sha256: string
}
export type ReviewDialogueAttachment = DialogueAttachment

export function getReviewDialogueAttachments(decisionId: string) {
  return authenticatedJson<{ attachments: ReviewDialogueAttachment[] }>(
    `/admin/reviews/${encodeURIComponent(decisionId)}/dialogue-attachments`,
    {},
    '无法读取封存对话附件。',
  )
}

export async function downloadReviewDialogueAttachment(
  decisionId: string,
  attachment: ReviewDialogueAttachment,
) {
  const response = await useAuthStore().request(
    `/admin/reviews/${encodeURIComponent(decisionId)}/dialogue-attachments/${encodeURIComponent(attachment.id)}/content`,
    {},
  )
  if (!response.ok) throw await responseError(response, '无法读取封存对话附件。')
  const blob = await response.blob()
  if (
    blob.size !== attachment.byte_size ||
    blob.size > 5 * 1024 * 1024 ||
    response.headers.get('X-Artifact-SHA256') !== attachment.sha256 ||
    blob.type.split(';')[0] !== attachment.media_type
  )
    throw new Error('文件信息与封存记录不一致，已停止显示。')
  return blob
}
export type ReviewMaterials = {
  events: Array<{
    source_id: string
    sequence: number
    event_type: string
    payload: Record<string, unknown>
    occurred_at: string
  }>
  interactions: Array<{
    source_id: string
    sequence: number
    prompt: string
    response: string | null
    model_call_id: string | null
    degraded: boolean
    completed_at: string | null
  }>
  next_event_after: number | null
  next_interaction_after: number | null
  artifact: ReviewArtifact | null
}

export function getReviewMaterials(decisionId: string, eventAfter = 0, interactionAfter = 0) {
  const query = new URLSearchParams({
    event_after: String(eventAfter),
    interaction_after: String(interactionAfter),
    limit: '50',
  })
  return authenticatedJson<ReviewMaterials>(
    `/admin/reviews/${encodeURIComponent(decisionId)}/materials?${query}`,
    {},
    '无法读取封存实操材料。',
  )
}

export async function downloadReviewArtifact(decisionId: string, artifact: ReviewArtifact) {
  const response = await useAuthStore().request(
    `/admin/reviews/${encodeURIComponent(decisionId)}/artifacts/${encodeURIComponent(artifact.id)}`,
    {},
  )
  if (!response.ok) throw await responseError(response, '无法下载封存产物。')
  const blob = await response.blob()
  if (
    blob.size !== artifact.byte_size ||
    blob.size > 5 * 1024 * 1024 ||
    response.headers.get('X-Artifact-SHA256') !== artifact.sha256 ||
    blob.type.split(';')[0] !== artifact.media_type
  ) {
    throw new Error('文件信息与封存记录不一致，已停止显示。')
  }
  return blob
}

async function authenticatedJson<T>(path: string, init: RequestInit, fallback: string) {
  const response = await useAuthStore().request(path, init)
  return requireJson<T>(response, fallback)
}

export function listReviews(organizationId: string) {
  return authenticatedJson<ReviewQueueItem[]>(
    `/admin/reviews?organization_id=${encodeURIComponent(organizationId)}`,
    {},
    '无法读取人工复核队列。',
  )
}

export function getReview(decisionId: string) {
  return authenticatedJson<ReviewDetail>(
    `/admin/reviews/${decisionId}`,
    {},
    '无法读取评分证据卷宗。',
  )
}

export function resolveReview(
  decisionId: string,
  payload: { score: number; rationale: string; evidence: string },
  idempotencyKey: string,
) {
  return authenticatedJson<{ review_id: string; state: string; final_score: number }>(
    `/admin/reviews/${decisionId}/resolve`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(payload),
    },
    '最终评分未能封存，请保持内容不变后重试。',
  )
}
