import { requireJson } from './apiClient'
import { useAuthStore } from '../stores/auth'
import { useAccessStore } from '../stores/access'
import { DIMENSIONS } from '../domain/capabilities'

export type WorkspaceDimension = {
  code: string
  index: number | null
  level: string
  evidence_count: number
}
export type ReportSummary = {
  organization_id?: string | null
  data_origin?: string | null
  id: string
  session_id: string
  name: string
  mode: string
  scenario: string
  status: string
  completed_at: string | null
  revision: number
  dimensions: WorkspaceDimension[]
}
export type ActiveSession = {
  data_origin?: string | null
  id: string
  name: string
  mode: string
  scenario: string
  answered: number
  max_items: number | null
  dimension_counts: Record<string, number>
  last_saved_at: string | null
}
export type WorkspaceOverview = {
  active_sessions: ActiveSession[]
  recent_reports: ReportSummary[]
  report_count: number
  service_status: { state: string; label: string }
}
export type HistoryEntry = {
  data_origin?: string | null
  ended_at?: string | null
  ended_reason?: string | null
  id: string
  session_id: string
  name: string
  mode: string
  scenario: string
  status: string
  created_at: string
  completed_at: string | null
  answered: number
  max_items: number | null
  report_id: string | null
  report_status: string | null
}
export type WorkspacePage<T> = { items: T[]; total: number; limit: number; offset: number }
export type WorkspaceFilters = {
  organization_id?: string
  mode?: string
  scenario?: string
  status?: string
  limit?: number
  offset?: number
}
export type TrendGroup = {
  dimension_code: string
  construct: string
  method_version: string
  scoring_policy_version: string | null
  blueprint_version_id: string | null
  blueprint_version: number | null
  mode: string
  scenario: string
  points: Array<{
    report_id: string
    session_id: string
    completed_at: string | null
    index: number
    level: string
    evidence_count: number
    revision: number
  }>
}

function queryString(filters: WorkspaceFilters) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    // These endpoints are always owner-scoped server-side. Preserve the owner's
    // historical records after joining the unified operational platform.
    if (key === 'organization_id' && useAccessStore().singlePlatform) continue
    if (value !== undefined && value !== '') query.set(key, String(value))
  }
  return query.size ? `?${query}` : ''
}

async function read<T>(path: string, filters: WorkspaceFilters, fallback: string) {
  return requireJson<T>(await useAuthStore().request(path + queryString(filters)), fallback)
}

export function getWorkspaceOverview(organizationId: string) {
  return read<WorkspaceOverview>(
    '/workspace/overview',
    { organization_id: organizationId },
    '无法读取工作台，请稍后重试。',
  )
}
export function getWorkspaceReports(filters: WorkspaceFilters = {}) {
  return read<WorkspacePage<ReportSummary>>(
    '/workspace/reports',
    filters,
    '无法读取能力报告，请稍后重试。',
  )
}
export function getWorkspaceHistory(filters: WorkspaceFilters = {}) {
  return read<WorkspacePage<HistoryEntry>>(
    '/workspace/history',
    filters,
    '无法读取测评历史，请稍后重试。',
  )
}
export function getWorkspaceTrends(filters: WorkspaceFilters = {}) {
  return read<{ groups: TrendGroup[]; total: number; limit: number; offset: number }>(
    '/workspace/trends',
    filters,
    '无法读取可比记录，请稍后重试。',
  )
}

export const modeLabels: Record<string, string> = {
  rapid: '快速测评',
  standard: '标准测评',
  specialized: '专项测评',
  fixed: '固定题卷',
}
export const scenarioLabels: Record<string, string> = {
  general: '通用场景',
  higher_education: '高校场景',
  enterprise: '企业场景',
}
export const reportStatusLabels: Record<string, string> = {
  complete: '评分完成',
  pending_scoring: '评分中',
  needs_review: '待专家复核',
}
export const dimensionLabels = DIMENSIONS.reduce<Record<string, string>>((labels, dimension) => {
  labels[dimension.code] = dimension.name
  return labels
}, {})
export function formatWorkspaceDate(value: string | null | undefined, missing = '暂无时间记录') {
  if (!value) return missing
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return missing
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}
