import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '../stores/auth'

import ReportView from '../views/ReportView.vue'
import ReportEvidencePanel from '../components/ReportEvidencePanel.vue'

vi.mock('../services/assessmentWorkspaceApi', () => ({
  getAssessmentWorkspace: vi.fn().mockResolvedValue({ items: [] }),
  getAssessmentReview: vi.fn(),
}))

vi.mock('../stores/features', () => ({
  useFeatureStore: () => ({
    ready: true,
    trainingEnabled: false,
    loading: false,
    error: '',
    load: vi.fn(),
  }),
}))

vi.mock('echarts/core', () => ({
  use: vi.fn<(modules: unknown[]) => void>(),
  init: () => ({
    setOption: vi.fn<(option: unknown) => void>(),
    resize: vi.fn<() => void>(),
    dispose: vi.fn<() => void>(),
  }),
}))
vi.mock('echarts/charts', () => ({ RadarChart: {} }))
vi.mock('echarts/components', () => ({ RadarComponent: {} }))
vi.mock('echarts/renderers', () => ({ SVGRenderer: {} }))

const report = {
  id: 'report-1',
  session_id: 'session-1',
  is_complete: false,
  revision: 3,
  payload: {
    assessment: { mode: 'standard', scenario: 'higher_education' },
    summary: { answered: 18, pending_scoring: 1, needs_review: 1, scored_open_answers: 2 },
    measurement_status: 'needs_review',
    measurement_note: 'Some open evidence awaits human review.',
    dimensions: {
      evaluation: {
        objective_measurement: { theta: 0.4, standard_error: 0.5, evidence_count: 2, level: 'L3' },
        rubric_measurement: {
          mean_score: 3.5,
          mean_confidence: 0.86,
          completed: 1,
          pending: 1,
          decisions: [{ decision_id: 'decision-1', score: 3.5, source: 'human', tasks: [] }],
        },
        synthesis: {
          index: 73.4,
          level: 'L4',
          method_version: 'evidence-synthesis-v1',
          evidence_count: 3,
        },
      },
    },
    recommendations: [{ dimension_code: 'evaluation', action: '建立来源、计算和反例核验清单。' }],
    strengths: ['evaluation'],
  },
}

describe('ReportView', () => {
  beforeEach(() => {
    sessionStorage.clear()
    sessionStorage.setItem(
      'zhijian-auth-session',
      JSON.stringify({ accessToken: 'access-token', refreshToken: 'refresh-token' }),
    )
    setActivePinia(createPinia())
    useAuthStore().user = { id: 'learner-1', email: null, display_name: '学员', is_active: true }
  })
  afterEach(() => vi.unstubAllGlobals())

  it('shows review state, revision and traceable dimension evidence', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(JSON.stringify(report), { status: 200 })),
    )
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/reports/:sessionId', component: ReportView }],
    })
    await router.push('/reports/session-1')
    await router.isReady()
    const wrapper = mount(ReportView, { global: { plugins: [router] } })
    await flushPromises()

    expect(wrapper.text()).toContain('等待人工复核')
    expect(wrapper.text()).toContain('报告版本 R3')
    expect(wrapper.text()).toContain('结果评估')
    expect(wrapper.text()).toContain('73.4')
    expect(wrapper.text()).not.toContain('建立来源、计算和反例核验清单')
    expect(wrapper.get('.priority-card').text()).toContain('等待评分定稿')
    expect(wrapper.get('.priority-card').text()).not.toContain('练好结果评估')
    expect(wrapper.get('[data-testid=dimension-evaluation]').attributes('style')).toContain('73.4%')
    expect(wrapper.get('[data-testid=dimension-foundations]').text()).toContain('证据不足')
    expect(wrapper.find('[data-testid=radar-profile]').exists()).toBe(false)
    wrapper.unmount()
    vi.unstubAllGlobals()
  })

  it('marks the experience source without changing evidence values or review status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            ...report,
            payload: { ...report.payload, data_origin: 'synthetic' },
          }),
          { status: 200 },
        ),
      ),
    )
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/reports/:sessionId', component: ReportView }],
    })
    await router.push('/reports/session-1')
    const wrapper = mount(ReportView, { global: { plugins: [router] } })
    await flushPromises()
    expect(wrapper.text()).toContain('本地体验 · 非正式比赛题库')
    expect(wrapper.text()).toContain('不计入正式统计')
    expect(wrapper.text()).toContain('等待人工复核')
    expect(wrapper.text()).toContain('73.4')
    wrapper.unmount()
    vi.unstubAllGlobals()
  })

  it('uses frozen specialized scope, retaining required dimensions that still lack evidence', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              ...report,
              payload: {
                ...report.payload,
                assessment: {
                  mode: 'specialized',
                  scenario: 'higher_education',
                  blueprint: { configuration: { dimensions: { evaluation: 2, prompting: 1 } } },
                },
              },
            }),
          ),
      ),
    )
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/reports/:sessionId', component: ReportView }],
    })
    await router.push('/reports/session-1')
    const wrapper = mount(ReportView, { global: { plugins: [router] } })
    await flushPromises()
    expect(wrapper.get('.profile-card').text()).toContain('专项能力结果')
    expect(wrapper.findAll('.dimension-row')).toHaveLength(2)
    expect(wrapper.get('[data-testid="dimension-prompting"]').text()).toContain('证据不足')
    expect(wrapper.find('[data-testid="dimension-foundations"]').exists()).toBe(false)
    expect(wrapper.get('.report-summary').text()).toContain('1/2')
    expect(wrapper.find('.six-chart').exists()).toBe(false)
    expect(wrapper.getComponent(ReportEvidencePanel).props('dimensionCodes')).toEqual([
      'prompting',
      'evaluation',
    ])
    wrapper.unmount()
  })

  it('does not invent specialized scope when frozen configuration is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              ...report,
              payload: { ...report.payload, assessment: { mode: 'specialized' } },
            }),
          ),
      ),
    )
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/reports/:sessionId', component: ReportView }],
    })
    await router.push('/reports/session-1')
    const wrapper = mount(ReportView, { global: { plugins: [router] } })
    await flushPromises()
    expect(wrapper.findAll('.dimension-row')).toHaveLength(6)
    expect(wrapper.text()).toContain('测评范围信息暂不可用')
    expect(wrapper.get('.report-summary').text()).not.toContain('/6')
    wrapper.unmount()
  })

  it.each([
    { mode: 'standard', expectedDimensions: 6 },
    { mode: 'specialized', expectedDimensions: 1 },
  ])(
    'stacks results and evidence independently of advice for $mode reports',
    async ({ mode, expectedDimensions }) => {
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>().mockImplementation(
          async () =>
            new Response(
              JSON.stringify({
                ...report,
                payload: {
                  ...report.payload,
                  assessment: {
                    mode,
                    scenario: 'higher_education',
                    blueprint: { configuration: { dimensions: { evaluation: 2 } } },
                  },
                },
              }),
            ),
        ),
      )
      const router = createRouter({
        history: createMemoryHistory(),
        routes: [{ path: '/reports/:sessionId', component: ReportView }],
      })
      await router.push('/reports/session-1')
      const wrapper = mount(ReportView, { global: { plugins: [router] } })
      await flushPromises()

      const grid = wrapper.get('.report-grid')
      const main = wrapper.get('.report-column.report-main')
      const sidebar = wrapper.get('.report-column.report-sidebar')
      const profile = wrapper.get('.profile-card')
      const evidence = wrapper.getComponent(ReportEvidencePanel)
      const advice = wrapper.get('.priority-card')
      const learning = wrapper.get('.learning-card')

      expect(Array.from(grid.element.children)).toEqual([main.element, sidebar.element])
      expect(Array.from(main.element.children)).toEqual([profile.element, evidence.element])
      expect(Array.from(sidebar.element.children)).toEqual([advice.element, learning.element])
      expect(wrapper.findAll('.profile-card')).toHaveLength(1)
      expect(wrapper.findAllComponents(ReportEvidencePanel)).toHaveLength(1)
      expect(wrapper.findAll('.priority-card')).toHaveLength(1)
      expect(wrapper.findAll('.learning-card')).toHaveLength(1)
      expect(wrapper.findAll('.dimension-row')).toHaveLength(expectedDimensions)
      expect(wrapper.get('[data-testid="dimension-evaluation"]').text()).toContain('73.4')
      if (mode === 'specialized') {
        expect(profile.classes()).toContain('specialized')
        expect(profile.text()).toContain('专项能力结果')
        expect(evidence.props('dimensionCodes')).toEqual(['evaluation'])
        expect(wrapper.find('[data-testid="dimension-foundations"]').exists()).toBe(false)
      }
      wrapper.unmount()
    },
  )

  it('omits open-question scoring only for a confirmed final objective-only report', async () => {
    const payload = {
      ...report.payload,
      assessment: {
        mode: 'rapid',
        blueprint: {
          configuration: { item_type_minimums: { objective: 12, dialogue: 0, practical: 0 } },
        },
      },
      summary: { answered: 12, pending_scoring: 0 },
      measurement_status: 'complete',
      dimensions: { evaluation: { theta: 0.4, evidence_count: 2, level: 'L3' } },
    }
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockImplementation(
          async () => new Response(JSON.stringify({ ...report, is_complete: true, payload })),
        ),
    )
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/reports/:sessionId', component: ReportView }],
    })
    await router.push('/reports/session-1')
    const wrapper = mount(ReportView, { global: { plugins: [router] } })
    await flushPromises()
    expect(wrapper.find('[data-testid="open-scoring-progress"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('开放题已完成裁决')
    expect(wrapper.getComponent(ReportEvidencePanel).props('objectiveOnly')).toBe(true)
    expect(wrapper.get('.report-evidence').text()).not.toContain('关键证据 0')
    wrapper.unmount()
  })

  it('keeps open scoring information when mode is rapid but required type configuration is unknown', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              ...report,
              payload: { ...report.payload, assessment: { mode: 'rapid' } },
            }),
          ),
      ),
    )
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/reports/:sessionId', component: ReportView }],
    })
    await router.push('/reports/session-1')
    const wrapper = mount(ReportView, { global: { plugins: [router] } })
    await flushPromises()
    expect(wrapper.find('[data-testid="open-scoring-progress"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('surfaces blocked scoring configuration rather than promising normal processing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              ...report,
              payload: {
                ...report.payload,
                measurement_status: 'pending_scoring',
                summary: { ...report.payload.summary, blocked_scoring: 1 },
              },
            }),
          ),
      ),
    )
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/reports/:sessionId', component: ReportView }],
    })
    await router.push('/reports/session-1')
    const wrapper = mount(ReportView, { global: { plugins: [router] } })
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('缺少已发布的评分量规')
    expect(wrapper.get('.status-pill').text()).toBe('评分配置异常')
    expect(wrapper.text()).toContain('当前报告尚未定稿')
    wrapper.unmount()
    vi.unstubAllGlobals()
  })
})
