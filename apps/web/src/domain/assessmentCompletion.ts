import type { AssessmentWorkspace } from '../services/assessmentWorkspaceApi'

export function historicalPolicyNotice(workspace: AssessmentWorkspace | null) {
  if (
    !workspace ||
    workspace.session.mode !== 'specialized' ||
    workspace.session.status !== 'active' ||
    workspace.stopping_policy_version
  )
    return ''
  const config = workspace.session.blueprint_snapshot?.configuration as
    { cat?: unknown } | undefined
  if (config?.cat) return ''
  return '这是此前开始的专项测，继续沿用当时的结束规则，可能在两题后结束。新开始的专项测已更新规则；本次已保存的回答不会被重置。'
}

export function completionExplanation(workspace: AssessmentWorkspace | null) {
  if (!workspace) return ''
  if (workspace.completion_reason === 'maximum_items_reached')
    return `已回答 ${workspace.answered_count} 题，达到本方案 ${workspace.max_items} 题上限。本次按题量上限结束，不代表测量误差已达到目标。`
  if (workspace.completion_reason === 'target_precision_reached')
    return workspace.stopping_policy_version === 'specialized-evidence-v2'
      ? `已回答 ${workspace.answered_count} 题，维度覆盖与本版误差阈值均已满足，可提前结束。该阈值是工程设置，不代表经过真人校准的准确率。`
      : `已回答 ${workspace.answered_count} 题，满足本会话保存的结束规则。历史方案可能较早结束；新专项测使用更新后的规则，旧记录保持不变。`
  return '题量和证据覆盖已满足完成条件，可以封存。'
}
