import type {
  TrialDetail,
  TrialResponse,
  TrialStatus,
  TrialType,
} from '../services/contentTrialApi'

export const TRIAL_STATUS: Record<TrialStatus, string> = {
  assigned: '待知情确认',
  in_progress: '试答中',
  submitted: '已提交',
  withdrawn: '已撤回',
  expired: '已到期',
}
export const TRIAL_TYPES: Record<TrialType, string> = {
  objective: '客观题',
  dialogue: '对话题 · 固定追问',
  practical: '实操题 · 文本试答',
}
export type TrialFields = {
  selected_index: number | null
  answers: [string, string, string]
  plan: string
  artifact: string
  verification: string
  reflection: string
}
export function blankTrialFields(): TrialFields {
  return {
    selected_index: null,
    answers: ['', '', ''],
    plan: '',
    artifact: '',
    verification: '',
    reflection: '',
  }
}
export function restoreTrialFields(response: TrialResponse | null): TrialFields {
  const fields = blankTrialFields()
  if (!response) return fields
  if ('selected_index' in response) fields.selected_index = response.selected_index
  if ('answers' in response) fields.answers = [...response.answers]
  if ('plan' in response) Object.assign(fields, response)
  return fields
}
export function trialResponse(type: TrialType, fields: TrialFields): TrialResponse {
  if (type === 'objective') return { selected_index: fields.selected_index }
  if (type === 'dialogue') return { answers: [...fields.answers] }
  return {
    plan: fields.plan,
    artifact: fields.artifact,
    verification: fields.verification,
    reflection: fields.reflection,
  }
}
export function validTrialQuestion(detail: TrialDetail) {
  const q = detail.question
  if (!q || typeof q.stem !== 'string' || !q.stem.trim()) return false
  if (detail.item_type === 'objective')
    return (
      Array.isArray(q.options) &&
      q.options.length === 4 &&
      q.options.every((option) => typeof option === 'string' && option.trim())
    )
  if (detail.item_type === 'dialogue')
    return (
      Array.isArray(q.followups) &&
      q.followups.length === 2 &&
      q.followups.every((prompt) => typeof prompt === 'string' && prompt.trim())
    )
  return detail.item_type === 'practical'
}
export function completeTrialResponse(type: TrialType, fields: TrialFields) {
  if (type === 'objective')
    return fields.selected_index !== null && fields.selected_index >= 0 && fields.selected_index < 4
  if (type === 'dialogue')
    return fields.answers.length === 3 && fields.answers.every((answer) => answer.trim())
  return [fields.plan, fields.artifact, fields.verification, fields.reflection].every((answer) =>
    answer.trim(),
  )
}
export function trialDate(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—'
}
export function trialAnswerSections(response: TrialResponse | null): Array<[string, string]> {
  if (!response) return []
  if ('selected_index' in response)
    return [
      [
        '所选选项',
        response.selected_index === null
          ? '未选择'
          : String.fromCharCode(65 + response.selected_index),
      ],
    ]
  if ('answers' in response)
    return response.answers.map((answer, index) => [
      index === 0 ? '初答' : `固定追问 ${index}`,
      answer,
    ])
  return [
    ['任务拆解', response.plan],
    ['文本 / 代码产出', response.artifact],
    ['验证方法', response.verification],
    ['反思', response.reflection],
  ]
}
