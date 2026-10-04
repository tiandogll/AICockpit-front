import { useAuthStore } from '../stores/auth'
import { requireJson } from './apiClient'

export type TrialStatus = 'assigned' | 'in_progress' | 'submitted' | 'withdrawn' | 'expired'
export type TrialType = 'objective' | 'dialogue' | 'practical'
export type TrialResponse =
  | { selected_index: number | null }
  | { answers: [string, string, string] }
  | { plan: string; artifact: string; verification: string; reflection: string }
export type TrialQuestion = {
  stem: string
  options: string[]
  followups: string[]
  attribution: string | null
}
export type TrialSummary = {
  id: string
  packet_id: string
  organization_id: string
  code: string
  dimension: string
  item_type: TrialType
  status: TrialStatus
  revision: number
  created_at: string
  expires_at: string
  consented_at: string | null
  submitted_at: string | null
  withdrawn_at: string | null
  purpose: 'content_quality_trial'
  notice: string
}
export type TrialDetail = TrialSummary & {
  can_edit: boolean
  blocked_reason: string | null
  question: TrialQuestion | null
  response: TrialResponse | null
  feedback: string | null
}
export type TrialResult = TrialSummary & {
  learner_username: string | null
  response: TrialResponse | null
  feedback: string | null
}
export type TrialPage<T = TrialSummary> = {
  items: T[]
  total: number
  limit: number
  offset: number
}
export type TrialWrite = { expected_revision: number; response: TrialResponse; feedback: string }
export type TrialAssignment = {
  expected_digest: string
  organization_id: string
  learner_username: string
}
const trialPath = (id: string) => `/content-trials/${encodeURIComponent(id)}`
const reviewPath = (id: string) => `/content-reviews/${encodeURIComponent(id)}`
const pageQuery = (offset: number) =>
  new URLSearchParams({ limit: '20', offset: String(Math.max(0, Math.min(10000, offset))) })

async function write<T>(path: string, method: string, body: unknown, key: string, failure: string) {
  return requireJson<T>(
    await useAuthStore().request(path, {
      method,
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    failure,
  )
}
export async function listContentTrials(offset = 0) {
  return requireJson<TrialPage>(
    await useAuthStore().request(`/content-trials?${pageQuery(offset)}`),
    '试答任务读取失败，请重试。',
  )
}
export async function getContentTrial(id: string) {
  return requireJson<TrialDetail>(
    await useAuthStore().request(trialPath(id)),
    '试答内容读取失败，请重试。',
  )
}
export async function listTrialResults(packetId: string, offset = 0) {
  return requireJson<TrialPage<TrialResult>>(
    await useAuthStore().request(`${reviewPath(packetId)}/trial-results?${pageQuery(offset)}`),
    '试答记录读取失败，请重试。',
  )
}
export function assignContentTrial(packetId: string, body: TrialAssignment, key: string) {
  return write<TrialSummary>(
    `${reviewPath(packetId)}/trial-assignments`,
    'POST',
    body,
    key,
    '试答指派未确认成功，请重试同一次指派。',
  )
}
export function consentContentTrial(id: string, key: string) {
  return write<TrialDetail>(
    `${trialPath(id)}/consent`,
    'POST',
    { consent_version: 'content-quality-trial-v1' },
    key,
    '知情确认未保存，请重试。',
  )
}
export function saveContentTrialDraft(id: string, body: TrialWrite, key: string) {
  return write<TrialDetail>(
    `${trialPath(id)}/draft`,
    'PUT',
    body,
    key,
    '草稿未确认保存，请重试或读取服务器最新状态。',
  )
}
export function submitContentTrial(id: string, body: TrialWrite, key: string) {
  return write<TrialDetail>(
    `${trialPath(id)}/submit`,
    'POST',
    body,
    key,
    '提交结果尚未确认，请重试同一次提交或读取最新状态。',
  )
}
export function withdrawContentTrial(id: string, key: string) {
  return write<TrialDetail>(
    `${trialPath(id)}/withdraw`,
    'POST',
    undefined,
    key,
    '撤回结果尚未确认，请重试。',
  )
}
