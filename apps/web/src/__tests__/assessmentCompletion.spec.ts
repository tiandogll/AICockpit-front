import { describe, expect, it } from 'vitest'
import { completionExplanation, historicalPolicyNotice } from '../domain/assessmentCompletion'
import type { AssessmentWorkspace } from '../services/assessmentWorkspaceApi'

describe('completion explanation', () => {
  it('warns only resumed legacy specialized sessions, not explicit or new policies', () => {
    const workspace = {
      session: { mode: 'specialized', status: 'active', blueprint_snapshot: {} },
    } as AssessmentWorkspace
    expect(historicalPolicyNotice(workspace)).toContain('此前开始')
    workspace.session.blueprint_snapshot = {
      configuration: { cat: { target_standard_error: 0.7 } },
    }
    expect(historicalPolicyNotice(workspace)).toBe('')
    workspace.session.blueprint_snapshot = {}
    workspace.stopping_policy_version = 'specialized-evidence-v2'
    expect(historicalPolicyNotice(workspace)).toBe('')
  })
  it('distinguishes a cap from precision and labels legacy rules', () => {
    const workspace = {
      answered_count: 5,
      max_items: 5,
      completion_reason: 'maximum_items_reached',
    } as AssessmentWorkspace
    expect(completionExplanation(workspace)).toContain('不代表测量误差已达到目标')
    workspace.completion_reason = 'target_precision_reached'
    expect(completionExplanation(workspace)).toContain('历史方案')
    workspace.stopping_policy_version = 'specialized-evidence-v2'
    expect(completionExplanation(workspace)).toContain('工程设置')
    expect(completionExplanation(workspace)).not.toContain('历史方案')
  })
})
