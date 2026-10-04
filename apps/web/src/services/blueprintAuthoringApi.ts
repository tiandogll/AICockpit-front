import { useAuthStore } from '../stores/auth'
import { requireJson } from './apiClient'
import type { ContentIdentity } from './contentApi'

export type PoolItem = {
  id: string
  stem: string
  dimension_code: string
  item_type: 'objective' | 'dialogue' | 'practical'
  version: number
  bank_version: string | null
}
export type TargetOrganization = {
  id: string
  name: string
  slug: string
  member_count: number
  experience_only: boolean
  accepts_experience: boolean
}
export type PlanRequest = {
  name: string
  mode: 'rapid' | 'standard' | 'specialized' | 'fixed'
  scenario: 'general' | 'higher_education' | 'enterprise'
  data_origin: 'formal' | 'synthetic'
  item_ids: string[]
  organization_ids: string[]
  dimensions: Record<string, number>
  item_type_minimums: Record<string, number>
  min_items: number
  max_items: number
  assessment_time_limit_seconds: number | null
}
export type PlanPreview = {
  valid: boolean
  issues: string[]
  candidate_count: number
  dimensions: Record<string, number>
  item_types: Record<string, number>
}
const root = '/admin/blueprint-authoring'
export async function planOptions<T>(
  kind: 'items' | 'organizations',
  query: Record<string, string | string[]>,
) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    for (const entry of Array.isArray(value) ? value : [value]) params.append(key, entry)
  }
  return requireJson<{ items: T[]; total: number }>(
    await useAuthStore().request(`${root}/${kind}?${params}`),
    '选项读取失败，请重试。',
  )
}
export async function previewPlan(body: PlanRequest) {
  return requireJson<PlanPreview>(
    await useAuthStore().request(`${root}/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    '方案校验失败，请检查配置。',
  )
}
export async function publishPlan(body: PlanRequest, key: string) {
  return requireJson<ContentIdentity>(
    await useAuthStore().request(`${root}/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify(body),
    }),
    '发布未确认，请使用相同内容重试；系统会避免重复创建。',
  )
}
