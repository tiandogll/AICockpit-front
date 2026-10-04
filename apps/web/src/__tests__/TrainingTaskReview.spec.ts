import { mount, RouterLinkStub } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import TrainingTaskReview from '../components/TrainingTaskReview.vue'
import type { TrainingLesson, TrainingTask } from '../services/trainingApi'

const lesson: TrainingLesson = {
  code: 'evaluation',
  title: '结果评估',
  objective: '区分结论与证据',
  paragraphs: ['追溯原始材料', '独立复算'],
  case: { scenario: '虚构问卷案例', pitfall: '把样本当总体', approach: '核对范围' },
  steps: ['找来源', '核数字', '写限制'],
  reflection_questions: ['如何验证？'],
}
const task: TrainingTask = {
  id: 'task',
  sequence: 1,
  kind: 'learning',
  title: '阅读与反思',
  status: 'completed',
  content: { instructions: '原任务说明', material: '原学习材料' },
  submission: { response: '<img src=x onerror=alert(1)> 这是原回答' },
  feedback: '已保存学习反思',
  completed_at: '2026-09-27T10:00:00Z',
}
function render(overrides: Partial<TrainingTask> = {}) {
  return mount(TrainingTaskReview, {
    props: { task: { ...task, ...overrides } },
    global: { stubs: { RouterLink: RouterLinkStub } },
  })
}
describe('training evidence review', () => {
  it('keeps source material, immutable response and historic feedback in separate regions', () => {
    const wrapper = render({ supplemental_lessons: [lesson] })
    expect(wrapper.get('.original-material').text()).toContain('原学习材料')
    expect(wrapper.get('[data-testid="saved-response"]').text()).toContain('你的反思')
    expect(wrapper.get('[data-testid="saved-response"]').text()).toContain('<img src=x')
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.get('.supplemental-reading').text()).toContain('不属于当时的原任务')
    expect(wrapper.get('.supplemental-reading').text()).toContain('虚构问卷案例')
    expect(wrapper.get('[data-testid="saved-feedback"]').text()).toContain('当时的反馈')
    expect(wrapper.find('textarea').exists()).toBe(false)
  })
  it('renders pinned v2 teaching and identifies local checklist feedback accurately', () => {
    const wrapper = render({
      content: {
        instructions: '新版说明',
        lessons: [lesson],
        feedback_mode: 'local_checklist_v2',
        next_step: '在新情境中练习',
      },
    })
    expect(wrapper.findAll('.lesson')).toHaveLength(1)
    expect(wrapper.get('.case-comparison').text()).toContain('把样本当总体')
    expect(wrapper.get('[data-testid="saved-feedback"]').text()).toContain('非 AI 评分')
    expect(wrapper.get('.next-step').text()).toContain('在新情境中练习')
    expect(wrapper.find('.supplemental-reading').exists()).toBe(false)
  })
  it('previews pending instructions only, never a stale submission', () => {
    const wrapper = render({ status: 'pending' })
    expect(wrapper.text()).toContain('原任务说明')
    expect(wrapper.text()).not.toContain('这是原回答')
    expect(wrapper.find('[data-testid="saved-feedback"]').exists()).toBe(false)
  })
})
