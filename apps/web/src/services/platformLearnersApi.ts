import { useAuthStore } from '../stores/auth'
import { requireJson } from './apiClient'

export type PlatformLearner = {
  id: string
  username: string | null
  display_name: string
  email: string | null
  affiliation: string | null
  specialty: string | null
  learning_goal: string | null
  is_active: boolean
  created_at: string
  updated_at: string
  assessment_count: number
}
export type LearnerPage = { items: PlatformLearner[]; total: number; limit: number; offset: number }
export type LearnerUpdate = Pick<
  PlatformLearner,
  'display_name' | 'email' | 'affiliation' | 'specialty' | 'learning_goal' | 'is_active'
> & { expected_updated_at: string }

export async function listLearners(q = '', offset = 0) {
  const params = new URLSearchParams({ q, offset: String(offset), limit: '20' })
  return requireJson<LearnerPage>(
    await useAuthStore().request(`/platform/learners?${params}`),
    '暂时无法读取学员信息，请重试。',
  )
}
export async function updateLearner(id: string, body: LearnerUpdate, requestId: string) {
  return requireJson<PlatformLearner>(
    await useAuthStore().request(`/platform/learners/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Request-ID': requestId },
      body: JSON.stringify(body),
    }),
    '学员信息保存失败，请重试。',
  )
}
