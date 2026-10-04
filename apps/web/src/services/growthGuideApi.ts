import { useAuthStore } from '../stores/auth'
import { requireJson } from './apiClient'

export type GrowthGuideSource = {
  report_id: string
  session_id: string
  revision: number
  status: string
}
export type GrowthGuideResponse = {
  mode: 'local_guidance' | 'deepseek'
  scope: 'rules_only' | 'personal_growth'
  paragraphs: string[]
  actions: { label: string; path: string }[]
  source: GrowthGuideSource | null
  generation?: GrowthGeneration
}

export type GrowthGeneration = {
  requested_provider: 'local_guidance' | 'deepseek'
  status: 'local' | 'succeeded' | 'fallback' | 'restricted'
  model: string | null
  error_code: string | null
  usage: { input_tokens: number; output_tokens: number; total_tokens: number } | null
}
const generationErrors = new Set([
  'not_enabled',
  'provider_not_configured',
  'timeout',
  'rate_limited',
  'rate_limit_unavailable',
  'quota_exceeded',
  'organization_quota_exceeded',
  'authentication_failed',
  'insufficient_balance',
  'provider_unavailable',
  'transport_error',
  'invalid_response',
  'privacy_restricted',
  'context_changed',
  'assessment_active',
  'report_pending',
])
const formatError = () => new Error('引导响应格式异常，请稍后重试。')

export class GrowthGuideError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'GrowthGuideError'
  }
}
const errorMessages: Record<string, string> = {
  assessment_active: '正在正式作答，请先在测评页暂存退出，再使用 DeepSeek 问答或分析材料。',
  context_changed: '测评或访问状态已变化，请重新连接后再提问。',
  timeout: 'DeepSeek 请求超时，本次未生成回答。请稍后重试。',
  provider_not_configured: 'DeepSeek 尚未配置，请联系管理员。',
  not_enabled: 'DeepSeek 服务尚未启用，请联系管理员。',
  report_pending: '报告尚未定稿，本次服务未返回模型回答，请重新连接后再试。',
  privacy_restricted: '资料受隐私保护，本次未返回模型回答。',
  request_already_processed:
    '这次问题已尝试处理，为避免重复计费，不会再次调用。请查看本页记录；重新提问会作为一次新请求，可能产生费用。',
  idempotency_conflict: '请求标识与问题或材料不一致，请重新提问。',
}
function modelError(code: string, message?: string) {
  return new GrowthGuideError(
    code,
    message || errorMessages[code] || 'DeepSeek 本次未返回有效回答，请稍后重试。',
  )
}

async function requireGuideResponse(response: Response): Promise<unknown> {
  if (response.ok) return requireJson<unknown>(response, '暂时无法读取成长建议，请重试。')
  const value: unknown = await response.json().catch(() => null)
  if (record(value) && record(value.detail) && typeof value.detail.code === 'string') {
    throw modelError(
      value.detail.code,
      typeof value.detail.message === 'string' ? value.detail.message : undefined,
    )
  }
  if (record(value) && typeof value.detail === 'string') {
    throw modelError(
      value.detail in errorMessages ? value.detail : 'request_failed',
      value.detail in errorMessages ? undefined : value.detail,
    )
  }
  throw modelError('request_failed')
}

function parseGeneration(
  value: unknown,
  mode: unknown,
  scope: unknown,
): GrowthGeneration | undefined {
  if (value === undefined && mode === 'local_guidance') return undefined
  if (
    !record(value) ||
    !['local_guidance', 'deepseek'].includes(String(value.requested_provider)) ||
    !['local', 'succeeded', 'fallback', 'restricted'].includes(String(value.status)) ||
    !(
      value.error_code === null ||
      (typeof value.error_code === 'string' && generationErrors.has(value.error_code))
    )
  )
    throw formatError()
  const success = value.status === 'succeeded'
  if (
    success !== (mode === 'deepseek') ||
    (success &&
      (value.requested_provider !== 'deepseek' ||
        scope !== 'personal_growth' ||
        value.error_code !== null ||
        typeof value.model !== 'string' ||
        !value.model.trim() ||
        value.model.length > 120)) ||
    (!success && (value.model !== null || value.usage !== null)) ||
    (value.status === 'local' &&
      (value.requested_provider !== 'local_guidance' || value.error_code !== null)) ||
    (value.status === 'fallback' &&
      (value.requested_provider !== 'deepseek' || value.error_code === null))
  )
    throw formatError()
  let usage: GrowthGeneration['usage'] = null
  if (value.usage !== null) {
    if (!record(value.usage)) throw formatError()
    const { input_tokens, output_tokens, total_tokens } = value.usage
    if (
      ![input_tokens, output_tokens, total_tokens].every(
        (n) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0,
      )
    )
      throw formatError()
    usage = {
      input_tokens: input_tokens as number,
      output_tokens: output_tokens as number,
      total_tokens: total_tokens as number,
    }
  }
  return {
    requested_provider: value.requested_provider as GrowthGeneration['requested_provider'],
    status: value.status as GrowthGeneration['status'],
    model: value.model as string | null,
    error_code: value.error_code as string | null,
    usage,
  }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const learnerPaths = new Set([
  '/workspace',
  '/assessment',
  '/reports',
  '/training',
  '/history',
  '/help',
])

export function isSafeGrowthGuidePath(path: unknown): path is string {
  if (typeof path !== 'string') return false
  if (learnerPaths.has(path)) return true
  const match = /^\/(reports|assessment)\/([^/]+)$/.exec(path)
  return Boolean(match && uuid.test(match[2]!))
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function parseGuide(value: unknown): GrowthGuideResponse {
  if (
    !record(value) ||
    !['local_guidance', 'deepseek'].includes(String(value.mode)) ||
    !['rules_only', 'personal_growth'].includes(String(value.scope)) ||
    !Array.isArray(value.paragraphs) ||
    !value.paragraphs.length ||
    value.paragraphs.length > 10 ||
    !value.paragraphs.every(
      (paragraph) => typeof paragraph === 'string' && paragraph.length <= 4000,
    ) ||
    !Array.isArray(value.actions)
  )
    throw formatError()

  const generation = parseGeneration(value.generation, value.mode, value.scope)
  // Older servers may still return fixed local guidance with HTTP 200. It is a
  // system failure for this model-only client, never a conversational answer.
  if (value.mode !== 'deepseek' || generation?.status !== 'succeeded')
    throw modelError(generation?.error_code || 'model_response_required')

  const actions = value.actions
    .filter(
      (action): action is { label: string; path: string } =>
        record(action) &&
        typeof action.label === 'string' &&
        action.label.length <= 100 &&
        isSafeGrowthGuidePath(action.path),
    )
    .slice(0, 8)
    .map(({ label, path }) => ({ label, path }))
  const source = value.source
  const validSource =
    record(source) &&
    typeof source.report_id === 'string' &&
    uuid.test(source.report_id) &&
    typeof source.session_id === 'string' &&
    uuid.test(source.session_id) &&
    typeof source.revision === 'number' &&
    Number.isSafeInteger(source.revision) &&
    source.revision > 0 &&
    typeof source.status === 'string' &&
    source.status.length <= 80

  return {
    mode: value.mode as GrowthGuideResponse['mode'],
    scope: value.scope as GrowthGuideResponse['scope'],
    paragraphs: value.paragraphs,
    actions,
    source: validSource
      ? {
          report_id: source.report_id as string,
          session_id: source.session_id as string,
          revision: source.revision as number,
          status: source.status as string,
        }
      : null,
    ...(generation ? { generation } : {}),
  }
}

export async function getGrowthGuide(
  organizationId: string,
  question: string,
  options?: {
    provider: GrowthGuideResponse['mode']
    idempotencyKey?: string
    attachmentIds?: string[]
  },
) {
  const trimmed = question.trim()
  if (!trimmed || trimmed.length > 200) throw new Error('请输入 1–200 字的问题。')
  if (!organizationId) throw new Error('请先选择一个可访问的组织。')
  if (options?.provider && options.provider !== 'deepseek')
    throw modelError('model_response_required', '成长助手仅使用 DeepSeek 回答。')
  if (!options?.idempotencyKey) throw new Error('缺少本次问题的请求标识，请重新提问。')
  const response = await useAuthStore().request('/workspace/guide', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(options?.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
    },
    body: JSON.stringify({
      organization_id: organizationId,
      question: trimmed,
      provider: 'deepseek',
      ...(options?.attachmentIds?.length ? { attachment_ids: options.attachmentIds } : {}),
    }),
  })
  return parseGuide(await requireGuideResponse(response))
}

export type GuideMaterial = {
  id: string
  name: string
  text: string
  method: 'text' | 'ocr'
  truncated: boolean
  sha256: string
  expires_in_seconds: number
}
export async function uploadGuideMaterial(
  organizationId: string,
  file: File,
): Promise<GuideMaterial> {
  const form = new FormData()
  form.append('organization_id', organizationId)
  form.append('file', file)
  const response = await useAuthStore().request('/workspace/guide/materials', {
    method: 'POST',
    body: form,
  })
  const result = (await requireGuideResponse(response)) as GuideMaterial
  if (!result || typeof result.id !== 'string' || typeof result.text !== 'string')
    throw new Error('材料响应无效，请重新上传。')
  return result
}
export async function deleteGuideMaterial(organizationId: string, id: string) {
  const response = await useAuthStore().request(
    `/workspace/guide/materials/${encodeURIComponent(id)}?organization_id=${encodeURIComponent(organizationId)}`,
    { method: 'DELETE' },
  )
  if (!response.ok) await requireJson(response, '材料删除失败，请重试。')
}
