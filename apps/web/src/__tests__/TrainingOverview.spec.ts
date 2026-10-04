import { mount, RouterLinkStub } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TrainingOverview from '../components/TrainingOverview.vue'
import type { TrainingPlan } from '../services/trainingApi'

const plan: TrainingPlan = {
  id: 'plan',
  organization_id: 'org',
  source_report_id: 'report',
  source_session_id: 'session',
  source_report_revision: 1,
  source_report_changed: false,
  retest_available: true,
  retest_unavailable_reason: null,
  privacy_redacted: false,
  replaces_plan_id: null,
  template_version: 'v1',
  content_provenance: '测试材料',
  status: 'active',
  created_at: '2026-09-01T08:00:00Z',
  completed_at: null,
  dimensions: [{ code: 'evaluation', index: 35, level: 'L1', evidence_count: 3 }],
  assessment: { mode: 'standard', scenario: 'general', blueprint_version_id: 'blueprint' },
  completed_tasks: 1,
  total_tasks: 4,
  tasks: (['learning', 'exercise', 'application', 'retest'] as const).map((kind, index) => ({
    id: `task-${index}`,
    sequence: index + 1,
    kind,
    title: `任务${index + 1}`,
    status: index === 0 ? 'completed' : 'pending',
    content: {
      instructions: `说明${index + 1}`,
      material: '原任务学习材料',
      checklist: ['核验原始来源'],
    },
    submission: index === 0 ? { response: '原始核验记录' } : null,
    feedback: index === 0 ? '完成反馈' : null,
    completed_at: index === 0 ? '2026-09-02T08:00:00Z' : null,
  })),
}
const render = (overrides: Partial<TrainingPlan> = {}) =>
  mount(TrainingOverview, {
    props: { plan: { ...plan, ...overrides } },
    global: { stubs: { RouterLink: RouterLinkStub } },
  })
describe('TrainingOverview actions', () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = vi.fn()
    HTMLDialogElement.prototype.close = vi.fn()
  })
  it('starts only the current pending task and previews future tasks without submitting', async () => {
    const wrapper = render()
    await wrapper.get('.today-task button').trigger('click')
    expect(wrapper.emitted('start')).toHaveLength(1)
    await wrapper.findAll('.road-stages button')[2]!.trigger('click')
    expect(wrapper.get('dialog').text()).toContain('任务说明预览')
    expect(wrapper.get('dialog').text()).toContain('说明3')
    expect(wrapper.emitted('start')).toHaveLength(1)
    expect(wrapper.get('dialog').find('textarea').exists()).toBe(false)
  })
  it('opens immutable completed evidence and explicit retest requirements', async () => {
    const wrapper = render()
    await wrapper.findAll('.overview-task-row button')[0]!.trigger('click')
    expect(wrapper.get('dialog').text()).toContain('原始核验记录')
    expect(wrapper.get('dialog').text()).toContain('完成反馈')
    expect(wrapper.get('dialog').text()).toContain('原任务学习材料')
    expect(wrapper.get('dialog').text()).toContain('你的反思')
    expect(wrapper.get('dialog').text()).toContain('当时的反馈')
    expect(wrapper.get('dialog').text()).toContain('不代表内容已通过评价')
    expect(wrapper.get('dialog').find('textarea').exists()).toBe(false)
    await wrapper.get('.retest-panel button').trigger('click')
    expect(wrapper.get('dialog').text()).toContain('最终是否可关联由服务端校验')
    expect(wrapper.get('dialog').text()).not.toContain('原始核验记录')
  })
  it('continues the actual next task from review, without submitting historical answers', async () => {
    const wrapper = render()
    await wrapper.findAll('.overview-task-row button')[0]!.trigger('click')
    await wrapper.get('[data-testid="review-next-task"]').trigger('click')
    expect(wrapper.emitted('start')).toHaveLength(1)
    expect(HTMLDialogElement.prototype.close).toHaveBeenCalled()
  })
  it('labels synthetic provenance and does not offer a next task on a complete plan', async () => {
    const wrapper = render({
      data_origin: 'synthetic',
      status: 'completed',
      tasks: plan.tasks.map((t) => ({ ...t, status: 'completed' })),
    })
    expect(wrapper.text()).toContain('合成演示记录')
    await wrapper.findAll('.overview-task-row button')[0]!.trigger('click')
    expect(wrapper.get('dialog').text()).toContain('合成演示记录')
    expect(wrapper.find('[data-testid="review-next-task"]').exists()).toBe(false)
  })
  it('hides redacted submissions and clears an open review when plans change', async () => {
    const wrapper = render({ privacy_redacted: true })
    await wrapper.findAll('.overview-task-row button')[0]!.trigger('click')
    expect(wrapper.get('dialog').text()).toContain('内容已按隐私策略移除')
    expect(wrapper.text()).not.toContain('原始核验记录')
    expect(wrapper.find('.today-task button').exists()).toBe(false)
    await wrapper.setProps({ plan: { ...plan, id: 'other' } })
    expect(HTMLDialogElement.prototype.close).toHaveBeenCalled()
    expect(wrapper.get('dialog').text()).not.toContain('原始核验记录')
  })
})
