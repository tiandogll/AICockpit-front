import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AssessmentSessionFrame from '../components/AssessmentSessionFrame.vue'
import type { AssessmentWorkspace } from '../services/assessmentWorkspaceApi'

const workspace: AssessmentWorkspace = {
  session: {
    id: 's',
    organization_id: 'o',
    blueprint_version_id: null,
    mode: 'standard',
    scenario: 'higher_education',
    status: 'active',
    blueprint_snapshot: {},
    replayed: false,
  },
  server_now: '2026-09-15T08:00:00Z',
  blueprint_name: 'AI能力标准测',
  min_items: 12,
  max_items: 18,
  answered_count: 11,
  dispatched_count: 12,
  flagged_count: 1,
  current_item: {
    session_id: 's',
    item_version_id: 'i12',
    sequence: 12,
    item_type: 'dialogue',
    dimension_code: 'evaluation',
    difficulty: 0.75,
    stem: '说明核验步骤',
    configuration: { target_level: 'L3' },
  },
  items: [
    {
      item_version_id: 'i11',
      sequence: 11,
      item_type: 'dialogue',
      dimension_code: 'evaluation',
      answered_at: '2026-09-15T07:59:00Z',
      flagged: true,
    },
    {
      item_version_id: 'i12',
      sequence: 12,
      item_type: 'dialogue',
      dimension_code: 'evaluation',
      answered_at: null,
      flagged: false,
    },
  ],
  type_coverage: [
    { item_type: 'objective', answered_count: 6, minimum: 6 },
    { item_type: 'dialogue', answered_count: 5, minimum: 6 },
    { item_type: 'practical', answered_count: 0, minimum: 1 },
  ],
  can_complete: false,
  completion_reason: 'minimum_coverage',
  unmet_dimensions: [],
  unmet_item_types: ['practical'],
}
describe('reference assessment frame', () => {
  function objectiveWorkspace(mode = 'rapid'): AssessmentWorkspace {
    const item = { ...workspace.current_item!, item_type: 'objective' as const, sequence: 1 }
    return {
      ...workspace,
      session: { ...workspace.session, mode },
      answered_count: 0,
      dispatched_count: 1,
      flagged_count: 0,
      current_item: item,
      items: [{ ...item, answered_at: null, flagged: false }],
      type_coverage: [
        { item_type: 'objective', answered_count: 0, minimum: 12 },
        { item_type: 'dialogue', answered_count: 0, minimum: 0 },
        { item_type: 'practical', answered_count: 0, minimum: 0 },
      ],
    }
  }

  it.each(['rapid', 'specialized', 'standard'])(
    'shows only configured types for an objective-only %s plan, not mode-name assumptions',
    (mode) => {
      const value = objectiveWorkspace(mode)
      const wrapper = mount(AssessmentSessionFrame, {
        props: { workspace: value, item: value.current_item },
      })
      const strip = wrapper.get('[data-testid="assessment-coverage"]')
      expect(strip.text()).toContain('本次仅含')
      expect(strip.text()).toContain('客观题')
      expect(strip.text()).toContain('已完成 0 题 · 至少 12 题')
      expect(strip.text()).not.toContain('对话测评')
      expect(strip.text()).not.toContain('实操任务')
      expect(strip.text()).not.toContain('0/0')
      expect(strip.findAll('.exam-coverage-line')).toHaveLength(0)
      expect(strip.findAll('.exam-step-square')).toHaveLength(0)
      expect(wrapper.get('.exam-legend').text()).toContain('当前待答1')
      expect(wrapper.get('.exam-progress-caption').text()).toContain('题量上限不等于必答题数')
      expect(wrapper.find('.exam-evidence-focus').exists()).toBe(false)
      expect(wrapper.get('dialog').text()).not.toContain('本题能力证据')
    },
  )

  it('updates to a two-type plan without reserving an empty practical step', async () => {
    const value = objectiveWorkspace()
    const wrapper = mount(AssessmentSessionFrame, {
      props: { workspace: value, item: value.current_item },
    })
    await wrapper.setProps({
      workspace: {
        ...value,
        type_coverage: [
          value.type_coverage[0]!,
          { item_type: 'dialogue', minimum: 2, answered_count: 0 },
        ],
      },
    })
    const strip = wrapper.get('[data-testid="assessment-coverage"]')
    expect(strip.findAll('.exam-coverage-step')).toHaveLength(2)
    expect(strip.findAll('.exam-coverage-line')).toHaveLength(1)
    expect(strip.text()).not.toContain('本次仅含')
    expect(strip.text()).not.toContain('实操任务')
    expect(strip.attributes('aria-label')).toBe('本次测评题型覆盖情况')
  })

  it('retains issued legacy evidence without displaying a zero denominator', () => {
    const value = objectiveWorkspace()
    const wrapper = mount(AssessmentSessionFrame, {
      props: {
        workspace: {
          ...value,
          type_coverage: [
            value.type_coverage[0]!,
            { item_type: 'dialogue', minimum: 0, answered_count: 1 },
          ],
          items: [...value.items, workspace.items[0]!],
        },
        item: value.current_item,
      },
    })
    expect(wrapper.get('[data-testid="assessment-coverage"]').text()).toContain(
      '对话测评已完成 1 题',
    )
    expect(wrapper.get('[data-testid="assessment-navigation"]').text()).toContain('对话测评')
    expect(wrapper.find('[data-testid="question-11"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="assessment-coverage"]').text()).not.toContain('/0')
  })

  it('does not invent three empty types while the workspace is loading', () => {
    const wrapper = mount(AssessmentSessionFrame, { props: { workspace: null } })
    expect(wrapper.find('[data-testid="assessment-coverage"]').exists()).toBe(false)
  })

  it('keeps a restored current question visible when legacy coverage metadata is missing', () => {
    const wrapper = mount(AssessmentSessionFrame, {
      props: {
        workspace: { ...workspace, type_coverage: [], items: [] },
        item: workspace.current_item,
      },
    })
    const strip = wrapper.get('[data-testid="assessment-coverage"]')
    expect(strip.text()).toContain('对话测评已完成 0 题')
    expect(strip.text()).not.toContain('/0')
    expect(strip.text()).not.toContain('客观题')
  })

  it('distinguishes adaptive minimum coverage from an exact fixed-paper total', async () => {
    const value = objectiveWorkspace()
    value.type_coverage[0]!.answered_count = 13
    const wrapper = mount(AssessmentSessionFrame, {
      props: { workspace: value, item: value.current_item },
    })
    expect(wrapper.get('[data-testid="assessment-coverage"]').text()).toContain(
      '已完成 13 题 · 至少 12 题',
    )
    await wrapper.setProps({
      workspace: { ...value, session: { ...value.session, mode: 'fixed' } },
    })
    expect(wrapper.get('[data-testid="assessment-coverage"]').text()).toContain('至少 12 题')
    await wrapper.setProps({
      workspace: {
        ...value,
        session: { ...value.session, mode: 'fixed' },
        type_coverage: [{ item_type: 'objective', answered_count: 13, minimum: 18 }],
      },
    })
    expect(wrapper.get('[data-testid="assessment-coverage"]').text()).toContain('13/18 题')
    expect(wrapper.get('[data-testid="assessment-coverage"]').text()).not.toContain('至少')
  })

  it('shows actual evidence focus in desktop and mobile navigation', () => {
    const value = objectiveWorkspace()
    const wrapper = mount(AssessmentSessionFrame, {
      props: {
        workspace: value,
        item: {
          ...value.current_item!,
          configuration: { evidence_focus: ['识别数据来源是否可信'] },
        },
      },
    })
    expect(wrapper.get('.exam-evidence-focus').text()).toContain('识别数据来源是否可信')
    expect(wrapper.get('dialog').text()).toContain('识别数据来源是否可信')
  })

  it('does not list unissued future questions once completion conditions are met', () => {
    const value = objectiveWorkspace()
    const wrapper = mount(AssessmentSessionFrame, {
      props: { workspace: { ...value, can_complete: true }, item: null },
    })
    expect(wrapper.get('[data-testid="assessment-navigation"]').text()).not.toContain('待派发')
    expect(wrapper.find('[data-testid="question-2"]').exists()).toBe(false)
    expect(wrapper.get('.exam-review-navigation button').text()).toContain('题目导航')
  })

  it('hides editing actions and unissued placeholders in an ended-session review', () => {
    const value = objectiveWorkspace()
    const wrapper = mount(AssessmentSessionFrame, {
      props: {
        workspace: { ...value, session: { ...value.session, status: 'completed' } },
        item: value.current_item,
        readOnly: true,
      },
    })
    expect(wrapper.get('[data-testid="assessment-session-toolbar"]').text()).not.toContain(
      '暂存退出',
    )
    expect(wrapper.find('.exam-finish').exists()).toBe(false)
    expect(wrapper.find('[data-testid="early-end-assessment"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="assessment-navigation"]').text()).not.toContain('待派发')
  })

  it('renders reference regions without pretending CAT is a fixed paper', () => {
    const wrapper = mount(AssessmentSessionFrame, {
      props: {
        workspace,
        item: workspace.current_item,
        clockLabel: '已用时间 08:00',
        saveLabel: '草稿已保存',
      },
      slots: { default: '<p>作答内容</p>' },
    })
    expect(wrapper.get('[data-testid="assessment-session-toolbar"]').text()).toContain('暂存退出')
    expect(wrapper.get('[data-testid="assessment-coverage"]').text()).toContain('对话测评')
    expect(wrapper.get('[data-testid="assessment-navigation"]').text()).toContain('待派发')
    expect(wrapper.text()).toContain('已完成 11 题，最多 18 题')
    expect(wrapper.text()).not.toContain('已完成61%')
    expect(wrapper.text()).not.toContain('SESSION STUB')
    expect(wrapper.get('[data-testid="question-13"]').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).not.toContain('本地体验 · 非正式比赛题库')
  })
  it('emits safe review and flag actions for issued questions', async () => {
    const wrapper = mount(AssessmentSessionFrame, {
      props: { workspace, item: workspace.current_item },
    })
    await wrapper.get('[data-testid="question-11"]').trigger('click')
    expect(wrapper.emitted('review')?.[0]).toEqual(['i11'])
    await wrapper.get('[data-testid="flag-question"]').trigger('click')
    expect(wrapper.emitted('flag')).toHaveLength(1)
  })
  it('labels local experience in the answering area while retaining ordinary submission state', () => {
    const wrapper = mount(AssessmentSessionFrame, {
      props: {
        workspace: { ...workspace, data_origin: 'synthetic' },
        item: workspace.current_item,
        saveLabel: '草稿已保存',
      },
    })
    expect(wrapper.text()).toContain('本地体验 · 非正式比赛题库')
    expect(wrapper.text()).toContain('不计入正式统计')
    expect(wrapper.text()).toContain('草稿已保存')
    expect(wrapper.text()).toContain('已完成 11 题，最多 18 题')
  })
})
