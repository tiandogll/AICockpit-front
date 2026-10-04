import { ApiError, requireJson } from './apiClient'
import { useAuthStore } from '../stores/auth'
import { useAccessStore } from '../stores/access'
import type { WorkspaceDimension, WorkspacePage } from './workspaceApi'

export type TrainingSubmission = { response?: string; application?: string; verification?: string }
export type TrainingLesson = {
  code: string
  title: string
  objective: string
  paragraphs: string[]
  case: { scenario: string; pitfall: string; approach: string }
  steps: string[]
  reflection_questions: string[]
}
export type TrainingTask = {
  id: string
  sequence: number
  kind: 'learning' | 'exercise' | 'application' | 'retest'
  title: string
  status: 'pending' | 'completed'
  content: {
    instructions: string
    material?: string
    checklist?: string[]
    prompt?: string
    lessons?: TrainingLesson[]
    feedback_mode?: string
    response_outline?: string
    verification_outline?: string
    next_step?: string
  }
  supplemental_lessons?: TrainingLesson[]
  submission: (TrainingSubmission & { session_id?: string }) | null
  feedback: string | null
  completed_at: string | null
}
export type TrainingRetest = {
  session_id: string
  status: 'active' | 'completed' | 'abandoned'
  paused: boolean
  expired: boolean
  report_id: string | null
  report_is_complete: boolean
  report_status: string | null
}
export type TrainingComparison = {
  source_report_revision: number
  retest_report_revision: number
  dimensions: { code: string; before_index: number; after_index: number; change: number }[]
}
export type TrainingPlan = {
  generation_basis?: {
    goal: 'remedial' | 'consolidate' | 'challenge'
    goal_label: string
    method: string
    completed_exercises: number
    material_revisited: boolean
    targets: {
      code: string
      index: number
      evidence_count: number
      incorrect_count: number
      objective_count: number
      question_sequences: number[]
      focus_labels: string[]
      reason: string
    }[]
  } | null
  id: string
  organization_id: string
  source_report_id: string
  source_session_id: string
  source_report_revision: number
  source_report_changed: boolean
  retest_available: boolean
  retest_unavailable_reason: string | null
  privacy_redacted: boolean
  replaces_plan_id: string | null
  template_version: string
  content_provenance: string
  data_origin?: 'synthetic' | null
  status: 'active' | 'completed'
  created_at: string
  completed_at: string | null
  dimensions: WorkspaceDimension[]
  assessment: { mode: string; scenario: string; blueprint_version_id: string | null }
  completed_tasks: number
  total_tasks: number
  tasks: TrainingTask[]
  // Additive fields: old training records / rolling deployments may omit them.
  retest?: TrainingRetest | null
  comparison?: TrainingComparison | null
}
export type CreateTrainingInput = {
  goal?: 'auto' | 'consolidate' | 'challenge'
  organization_id: string
  source_report_id: string
  expected_report_revision: number
  replaces_plan_id?: string
}
export type TrainingMutation = { plan: TrainingPlan; replayed: boolean }
const conflictMessages: Record<string, string> = {
  'Training record not found':
    '当前账号在此组织没有可访问的训练记录。请切换至本人所属组织，或确认记录仍然有效；系统管理权限不等于个人训练成员身份。',
  'No sufficiently evidenced low dimensions for training':
    '当前报告尚无至少 2 项证据的有效维度，暂不能生成有依据的个人计划。可先补充测评或阅读通用学习资料。',
  'Source report revision changed; review it before generating':
    '来源报告已更新，请重新读取并确认最新报告后再生成计划。',
  'Training requires a final completed report':
    '请等待评分和复核全部完成，再从最终报告生成训练计划。',
  'Pinned blueprint must still be published to create training':
    '来源题卷已停用，暂时无法建立可关联复测的训练计划。请联系组织管理员。',
  'Training source was withdrawn from its pilot': '来源测评已从试测中撤回，不能据此创建训练计划。',
  'Please confirm regeneration of the latest existing training plan':
    '此报告已有训练计划，请确认重新生成；原记录会保留。',
  'Replacement must identify the latest plan for this source report':
    '训练计划已发生变化，请重新读取最新计划后再确认替换。',
  'Training evidence was redacted; this plan is read-only':
    '训练证据已按隐私策略清理，这份计划只能查看。',
  'Completed training submissions are immutable': '已提交的训练记录不能修改，请继续下一项任务。',
  'Complete previous training tasks first': '请先按顺序完成前面的训练任务。',
  'Retest assessment was withdrawn from its pilot': '该复测已从试测中撤回，不能关联到训练计划。',
  'Finish or end the existing assessment before starting this training retest':
    '你还有同方案测评未结束，请先在测评中心继续完成或主动结束原会话，再开始本计划复测；系统不会自动结束原会话。',
  'Retest unavailable: pinned_blueprint_not_in_catalog':
    '来源方案已移出当前测评目录，无法新建同方案复测。原训练和复测记录仍保留，请联系管理员确认可用方案。',
  'Retest unavailable: pinned_blueprint_not_published':
    '来源题卷已停用，暂时无法完成兼容复测关联。已绑定的测评记录仍可查看，请联系管理员确认版本。',
  'Retest unavailable: pinned_blueprint_missing':
    '来源题卷不存在，暂时无法开始或关联兼容复测。原记录仍保留，请联系管理员确认版本。',
  'Retest unavailable: pinned_blueprint_snapshot_changed':
    '来源方案配置已改变，无法创建同口径复测。请联系管理员确认来源版本，不会使用其他方案替代。',
  'Retest clock must be later than training completion; retry shortly':
    '应用核验刚刚完成，请稍后重试开始同方案复测。',
  'Link the bound training retest; another assessment cannot replace it':
    '此计划已有专属复测，请刷新计划并查看已绑定记录，不能替换成另一场测评。',
  'Retest must be a new compatible completed assessment with a final report':
    '复测必须在应用核验任务完成后新开始，使用同组织、模式、场景及题卷版本，并已完成全部评分。请检查所选报告。',
  'Idempotency key was used for a different request':
    '该次保存请求的内容已发生变化，请检查记录并重新提交。',
  'Training is not enabled': '训练服务当前已关闭，请刷新服务状态或联系管理员。',
  'Security rate limiter is unavailable': '安全服务暂不可用，本次训练记录未写入，请稍后重试。',
  'Too many training changes': '提交操作过于频繁，请稍后保持内容不变重试。',
}
async function trainingJson<T>(response: Response, fallback: string): Promise<T> {
  try {
    return await requireJson<T>(response, fallback)
  } catch (cause) {
    if (cause instanceof ApiError && conflictMessages[cause.message])
      throw new ApiError(conflictMessages[cause.message]!, cause.status)
    throw cause
  }
}
export async function getTrainingPlans(
  organizationId: string,
  limit = 20,
  offset = 0,
  sourceReportId = '',
) {
  const query = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  if (organizationId && !useAccessStore().singlePlatform)
    query.set('organization_id', organizationId)
  if (sourceReportId) query.set('source_report_id', sourceReportId)
  return trainingJson<WorkspacePage<TrainingPlan>>(
    await useAuthStore().request(`/training?${query}`),
    '无法读取训练计划，请稍后重试。',
  )
}
export function trainingUnavailableReason(reason: string | null | undefined) {
  const labels: Record<string, string> = {
    legacy_platform_baseline:
      '历史计划保留，可继续练习；复测需使用当前平台已发布测评并重新建立可比基线。',
    pinned_blueprint_missing: '来源题卷已不存在，当前无法开始兼容复测。',
    pinned_blueprint_not_published: '来源题卷已停用，当前无法开始兼容复测。',
    pinned_blueprint_not_in_catalog:
      '来源方案已移出当前测评目录，无法新建同方案复测；已有记录仍保留。',
    pinned_blueprint_snapshot_changed:
      '来源方案配置已改变，无法新建同口径复测；请联系管理员确认版本。',
    training_evidence_redacted: '训练证据已按隐私策略清理，不能继续提交。',
  }
  return reason
    ? (labels[reason] ?? reason)
    : '当前无法开始兼容复测，请联系组织管理员确认题卷状态。'
}
export async function getTrainingPlan(planId: string) {
  return trainingJson<TrainingPlan>(
    await useAuthStore().request(`/training/${encodeURIComponent(planId)}`),
    '无法读取这份训练计划。',
  )
}
async function write(path: string, payload: unknown, idempotencyKey: string) {
  return trainingJson<TrainingMutation>(
    await useAuthStore().request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(payload),
    }),
    '训练记录未能保存，请保持内容不变后重试。',
  )
}
export function createTrainingPlan(payload: CreateTrainingInput, idempotencyKey: string) {
  return write('/training', payload, idempotencyKey)
}
export function submitTrainingTask(
  planId: string,
  taskId: string,
  payload: TrainingSubmission,
  idempotencyKey: string,
) {
  return write(
    `/training/${encodeURIComponent(planId)}/tasks/${encodeURIComponent(taskId)}/submit`,
    payload,
    idempotencyKey,
  )
}
export function linkTrainingRetest(planId: string, sessionId: string, idempotencyKey: string) {
  return write(
    `/training/${encodeURIComponent(planId)}/retest`,
    { session_id: sessionId },
    idempotencyKey,
  )
}
export function startTrainingRetest(planId: string, idempotencyKey: string) {
  return write(`/training/${encodeURIComponent(planId)}/retest/start`, {}, idempotencyKey)
}
