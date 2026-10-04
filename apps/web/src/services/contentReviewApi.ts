import { useAuthStore } from '../stores/auth'
import { requireJson } from './apiClient'

export type ReviewStatus = 'pending' | 'in_review' | 'reviewed' | 'changes_requested' | 'superseded'
export type PublicationStatus = 'published' | 'unpublished'
export type PublicationFilter = '' | PublicationStatus | 'ready'
export type ReviewChecks = { source: boolean; answer: boolean; rubric: boolean; fairness: boolean }
export type ReviewDecision = 'approve' | 'request_changes'
export type ReviewSource = {
  id: string
  title: string
  authors: string
  url: string | null
  version: string
  use: string
  license: string
  license_url: string | null
  license_evidence: string
  locator: string
  limitations: string
  delivery_rule: string
}
export type ReviewRevision = {
  id: string
  original_id: string
  dimension: string
  item_type: string
  tier: string
  family: string
  change_note: string
  source_locator: string
  stem: string
  options?: string[]
  correct_index?: number
  option_notes?: string[]
  reference_answer: string
  criteria: Array<{ name: string; levels: string[] }>
  examples: Array<{ label: string; answer: string; scores: number[]; explanation: string }>
  followups: string[]
  human_checks: string[]
  adaptation: null | {
    source: string
    locator: string
    license: string
    attribution: string
    changes: string
  }
  reference_sql?: string
  reference_json?: unknown
  verification_cases?: unknown[]
}
export type ReviewRow = {
  id: string
  item_version_id: string
  code: string
  original_code: string
  dimension: string
  item_type: string
  stem: string
  revision: number
  digest: string
  status: ReviewStatus
  publication_status?: PublicationStatus
  published_at?: string | null
  review_count: number
  approval_count: number
  required_approvals?: number
  own_decision?: ReviewDecision | null
  trial_eligible?: boolean
  created_at: string
}
export type ReviewDetail = ReviewRow & {
  revision_content: ReviewRevision
  sources: ReviewSource[]
  reviews: Array<{
    id: string
    actor_id: string
    reviewer_name: string
    decision: ReviewDecision
    comment: string
    checks: ReviewChecks
    created_at: string
  }>
  can_review: boolean
  publication_blocked: boolean
}
export type ReviewPage = { items: ReviewRow[]; total: number; limit: number; offset: number }
export type ReviewFilters = {
  status: string
  dimension: string
  item_type: string
  publication_status?: PublicationFilter
}
export type SubmitReview = {
  expected_digest: string
  decision: ReviewDecision
  comment: string
  checks: ReviewChecks
}
export type PublicationTarget = {
  blueprint_id: string
  name: string
  mode: string
  scenario: string
  version: number
  pool_size: number
  organization_names: string[]
  eligible: boolean
  reason: string | null
}
export type PublicationReceipt = {
  item_version_id: string
  rubric_version_id: string | null
  published_at: string
  targets: Array<{ previous_blueprint_id: string; blueprint_id: string; name: string }>
}
export type PublicationPreview = {
  packet_id: string
  digest: string
  eligible: boolean
  issues: string[]
  preview_token: string
  targets: PublicationTarget[]
  publication: PublicationReceipt | null
}
export type SubmitPublication = {
  expected_digest: string
  preview_token: string
  blueprint_ids: string[]
}

export async function listContentReviews(filters: ReviewFilters, offset = 0) {
  const query = new URLSearchParams({
    limit: '20',
    offset: String(Math.max(0, Math.min(10000, offset))),
  })
  for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value)
  return requireJson<ReviewPage>(
    await useAuthStore().request(`/content-reviews?${query}`),
    '待审核题目读取失败，请重试。',
  )
}
export async function getContentReview(id: string) {
  return requireJson<ReviewDetail>(
    await useAuthStore().request(`/content-reviews/${encodeURIComponent(id)}`),
    '审题资料读取失败，请重试。',
  )
}
export async function submitContentReview(id: string, body: SubmitReview, key: string) {
  return requireJson<ReviewDetail>(
    await useAuthStore().request(`/content-reviews/${encodeURIComponent(id)}/decisions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify(body),
    }),
    '审核意见未能保存。请保留当前内容，重试本次提交。',
  )
}
export async function getPublicationPreview(id: string) {
  return requireJson<PublicationPreview>(
    await useAuthStore().request(`/content-reviews/${encodeURIComponent(id)}/publication-preview`),
    '发布预览读取失败，尚未确认发布状态。请重试。',
  )
}
export async function publishContentReview(id: string, body: SubmitPublication, key: string) {
  return requireJson<PublicationReceipt>(
    await useAuthStore().request(`/content-reviews/${encodeURIComponent(id)}/publication`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify(body),
    }),
    '正式发布结果尚未确认。请保留当前请求，重试同一次发布。',
  )
}
