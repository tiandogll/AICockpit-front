import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import PilotLabView from '../views/PilotLabView.vue'
import { useAccessStore } from '../stores/access'

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const campaign = {
  id: 'campaign-1',
  organization_id: 'org-1',
  name: 'A01高校真实首轮',
  scenario: 'higher_education',
  data_origin: 'real',
  status: 'analyzing',
  target_participants: 50,
  target_open_answers: 60,
  required_experts: 3,
  preregistration: {},
  version_bundle: { blueprint: 'standard-v1' },
  freeze_hash: null,
  frozen_at: null,
  created_at: '2026-08-25T08:00:00Z',
}

const overview = {
  campaign,
  participant_count: 42,
  completed_participant_count: 38,
  withdrawn_participant_count: 2,
  assigned_answer_count: 55,
  submitted_rating_count: 138,
  expert_count: 3,
  gold_standard_count: 46,
  efficiency_observation_count: 35,
  latest_metric_run: {
    id: 'run-1',
    campaign_id: 'campaign-1',
    data_origin: 'real',
    dataset_hash: 'a'.repeat(64),
    algorithm_version: 'pilot-validation-v1',
    seed: 20260825,
    parameters: { bootstrap_iterations: 2000 },
    exclusions: { withdrawn_participants: 2 },
    results: {
      score_validation: {
        sample_size: 46,
        linear_weighted_kappa: 0.78,
        adjacent_agreement: 0.93,
        mae: 0.31,
      },
      cat_efficiency: {
        sample_size: 35,
        question_reduction: 0.34,
        level_agreement: 0.88,
      },
      thresholds: {},
      notice: 'initial pilot validation; not a formal norm',
    },
    completed_at: '2026-08-25T09:00:00Z',
  },
  gates: [
    {
      code: 'completed_participants',
      label: '完成试测用户',
      passed: false,
      current: 38,
      target: 50,
    },
    { code: 'gold_standards', label: '三专家金标准', passed: false, current: 46, target: 60 },
    {
      code: 'linear_weighted_kappa',
      label: '加权Kappa',
      passed: true,
      current: 0.78,
      target: 0.75,
    },
  ],
}

const launchContext = { organizations: [], blueprints: [], active_sessions: [] }

describe('PilotLabView', () => {
  beforeEach(() => {
    sessionStorage.clear()
    sessionStorage.setItem(
      'zhijian-auth-session',
      JSON.stringify({ accessToken: 'access-token', refreshToken: 'refresh-token' }),
    )
    setActivePinia(createPinia())
  })

  it('does not query administrator-only blind assignments for a single-platform learner', async () => {
    const access = useAccessStore()
    access.singlePlatform = true
    access.ready = true
    access.organizationId = 'platform'
    access.organizations = [
      { id: 'platform', name: 'AI Measure', role: 'learner', capabilities: ['pilot_participate'] },
    ]
    const request = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.endsWith('/organizations'))
        return json([
          { id: 'platform', name: 'AI Measure', slug: 'ai-measure-platform', role: 'learner' },
        ])
      if (url.endsWith('/assessment-definitions/launch-context')) return json(launchContext)
      if (url.includes('/pilot-campaigns?')) return json([])
      if (url.includes('/pilots/available?')) return json([])
      throw new Error(`Unexpected URL: ${url}`)
    })
    vi.stubGlobal('fetch', request)
    const wrapper = mount(PilotLabView)
    await flushPromises()
    expect(
      request.mock.calls.some(([input]) => String(input).includes('/expert/pilot-assignments')),
    ).toBe(false)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    wrapper.unmount()
    vi.unstubAllGlobals()
  })

  it('renders the evidence gate and never presents an incomplete real pilot as frozen', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input) => {
        const url = String(input)
        if (url.endsWith('/organizations')) {
          return json([{ id: 'org-1', name: '浙江智造学院', slug: 'zj', role: 'org_admin' }])
        }
        if (url.endsWith('/assessment-definitions/launch-context')) return json(launchContext)
        if (url.includes('/admin/pilots?')) return json([campaign])
        if (url.endsWith('/admin/pilots/campaign-1')) return json(overview)
        if (url.endsWith('/candidate-answers')) return json([])
        if (url.endsWith('/experts')) return json([])
        if (url.endsWith('/expert/pilot-assignments')) return json([])
        throw new Error(`Unexpected URL: ${url}`)
      }),
    )

    const wrapper = mount(PilotLabView)
    await flushPromises()

    expect(wrapper.text()).toContain('真实试测')
    expect(wrapper.text()).toContain('证据闸门')
    expect(wrapper.get('[data-testid=gate-completed_participants]').text()).toContain('38/50')
    expect(wrapper.get('[data-testid=gate-linear_weighted_kappa]').text()).toContain('0.78')
    expect(wrapper.text()).toContain('尚有 2 项门禁未通过')
    expect(wrapper.get('[data-testid=freeze-campaign]').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('不构成正式常模')
    vi.unstubAllGlobals()
  })

  it('marks synthetic campaigns as software demonstrations', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input) => {
        const url = String(input)
        if (url.endsWith('/organizations')) {
          return json([{ id: 'org-1', name: '浙江智造学院', slug: 'zj', role: 'org_admin' }])
        }
        if (url.endsWith('/assessment-definitions/launch-context')) return json(launchContext)
        if (url.includes('/admin/pilots?')) return json([{ ...campaign, data_origin: 'synthetic' }])
        if (url.endsWith('/admin/pilots/campaign-1')) {
          return json({
            ...overview,
            campaign: { ...campaign, data_origin: 'synthetic' },
            latest_metric_run: null,
            gates: [
              { code: 'real_data', label: '真实数据来源', passed: false, current: 0, target: 1 },
            ],
          })
        }
        if (url.endsWith('/candidate-answers')) return json([])
        if (url.endsWith('/experts')) return json([])
        if (url.endsWith('/expert/pilot-assignments')) return json([])
        throw new Error(`Unexpected URL: ${url}`)
      }),
    )

    const wrapper = mount(PilotLabView)
    await flushPromises()

    expect(wrapper.text()).toContain('合成演示')
    expect(wrapper.text()).toContain('不得写入真实实验结论')
    vi.unstubAllGlobals()
  })

  it('lets a learner explicitly consent to a recruiting real pilot', async () => {
    const recruiting = { ...campaign, status: 'recruiting' }
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input, init) => {
        const url = String(input)
        if (url.endsWith('/organizations')) {
          return json([{ id: 'org-1', name: '浙江智造学院', slug: 'zj', role: 'learner' }])
        }
        if (url.endsWith('/assessment-definitions/launch-context')) return json(launchContext)
        if (url.includes('/pilot-campaigns?')) return json([recruiting])
        if (url.endsWith('/pilot-campaigns/campaign-1/me')) return json(null)
        if (url.endsWith('/expert/pilot-assignments')) return json([])
        if (url.endsWith('/pilot-campaigns/campaign-1/consent') && init?.method === 'POST') {
          return json({
            id: 'participant-1',
            campaign_id: 'campaign-1',
            user_id: 'learner-1',
            session_id: null,
            consented_at: '2026-08-25T10:00:00Z',
            withdrawn_at: null,
            completed_at: null,
            stratum: { scene: 'higher_education' },
          })
        }
        throw new Error(`Unexpected URL: ${url}`)
      }),
    )

    const wrapper = mount(PilotLabView)
    await flushPromises()
    expect(wrapper.text()).toContain('加入真实试测')
    await wrapper.get('input[type=checkbox]').setValue(true)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('完成并关联测评记录')
    expect(wrapper.text()).toContain('知情同意已记录')
    vi.unstubAllGlobals()
  })

  it('shows the blinded workbench to evaluators without admin rights', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input) => {
        const url = String(input)
        if (url.endsWith('/organizations')) {
          return json([{ id: 'org-1', name: '浙江智造学院', slug: 'zj', role: 'evaluator' }])
        }
        if (url.endsWith('/assessment-definitions/launch-context')) return json(launchContext)
        if (url.includes('/pilot-campaigns?')) return json([{ ...campaign, status: 'rating' }])
        if (url.endsWith('/pilot-campaigns/campaign-1/me')) return json(null)
        if (url.endsWith('/expert/pilot-assignments')) {
          return json([
            {
              id: 'assignment-1',
              campaign_name: campaign.name,
              seat: 1,
              status: 'assigned',
              item_stem: '如何核验AI结论？',
              item_type: 'dialogue',
              dimension_code: 'evaluation',
              answer_response: { type: 'dialogue_transcript', messages: [] },
              rubric_title: '核验量规',
              rubric_criteria: { criteria: [] },
            },
          ])
        }
        throw new Error(`Unexpected URL: ${url}`)
      }),
    )

    const wrapper = mount(PilotLabView)
    await flushPromises()
    expect(wrapper.text()).toContain('我的专家盲评任务')
    expect(wrapper.text()).toContain('如何核验AI结论')
    expect(wrapper.text()).toContain('PARTICIPANT WORKFLOW')
    expect(wrapper.text()).not.toContain('加入真实试测')
    vi.unstubAllGlobals()
  })

  it('does not let sealed historical expert work hide a current participant workflow', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input) => {
        const url = String(input)
        if (url.endsWith('/organizations')) {
          return json([{ id: 'org-1', name: '浙江智造学院', slug: 'zj', role: 'evaluator' }])
        }
        if (url.endsWith('/assessment-definitions/launch-context')) return json(launchContext)
        if (url.includes('/pilot-campaigns?')) {
          return json([{ ...campaign, status: 'recruiting' }])
        }
        if (url.endsWith('/pilot-campaigns/campaign-1/me')) return json(null)
        if (url.endsWith('/expert/pilot-assignments')) {
          return json([
            {
              id: 'sealed-assignment',
              campaign_name: '历史批次',
              seat: 1,
              status: 'submitted',
              item_stem: '历史题目',
              item_type: 'dialogue',
              dimension_code: 'evaluation',
              answer_response: {},
              rubric_title: '量规',
              rubric_criteria: {},
            },
          ])
        }
        throw new Error(`Unexpected URL: ${url}`)
      }),
    )

    const wrapper = mount(PilotLabView)
    await flushPromises()
    expect(wrapper.text()).toContain('加入真实试测')
    expect(wrapper.text()).not.toContain('我的专家盲评任务')
    vi.unstubAllGlobals()
  })

  function mockParticipationPage({
    role = 'learner',
    available = [] as (typeof campaign)[],
    assigned = [] as unknown[],
    failed = false,
  } = {}) {
    const request = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.endsWith('/organizations'))
        return json([{ id: 'org-1', name: '浙江智造学院', slug: 'zj', role }])
      if (url.endsWith('/assessment-definitions/launch-context')) return json(launchContext)
      if (url.includes('/pilot-campaigns?') || url.includes('/admin/pilots?'))
        return failed ? json({ detail: '读取失败' }, 503) : json(available)
      if (url.endsWith('/me')) return json(null)
      if (url.endsWith('/expert/pilot-assignments')) return json(assigned)
      throw new Error(`Unexpected URL: ${url}`)
    })
    vi.stubGlobal('fetch', request)
    return request
  }

  const routingStubs = {
    RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
  }

  it('replaces a learner’s empty batch selector with plain guidance and working destinations', async () => {
    mockParticipationPage()
    const wrapper = mount(PilotLabView, { global: { stubs: routingStubs } })
    await flushPromises()
    expect(wrapper.get('h1').text()).toBe('我的试测任务')
    expect(wrapper.text()).toContain('暂时没有可参与的试测')
    expect(wrapper.text()).toContain('不是开始日常测评的必经步骤')
    expect(wrapper.find('select').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('金标准')
    expect(wrapper.text()).not.toContain('新建批次')
    expect(wrapper.get('a[href="/assessment"]').text()).toContain('前往能力测评')
    expect(wrapper.get('a[href="/workspace"]').text()).toBe('返回工作台')
    wrapper.unmount()
    vi.unstubAllGlobals()
  })

  it('shows one recruiting campaign directly, preserving privacy and explicit consent', async () => {
    mockParticipationPage({ available: [{ ...campaign, status: 'recruiting' }] })
    const wrapper = mount(PilotLabView)
    await flushPromises()
    expect(wrapper.find('.selectors').exists()).toBe(false)
    expect(wrapper.text()).toContain(campaign.name)
    expect(wrapper.text()).toContain('可报名参加')
    expect(wrapper.text()).toContain('原始交互默认保留90天')
    expect(wrapper.text()).toContain('可以随时撤回')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.empty').exists()).toBe(false)
    wrapper.unmount()
    vi.unstubAllGlobals()
  })

  it('resets consent when the learner switches to another available campaign', async () => {
    mockParticipationPage({
      available: [
        { ...campaign, status: 'recruiting' },
        { ...campaign, id: 'campaign-2', name: '第二轮试测', status: 'recruiting' },
      ],
    })
    const wrapper = mount(PilotLabView)
    await flushPromises()
    await wrapper.get('input[type="checkbox"]').setValue(true)
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeUndefined()
    await wrapper.get('.selectors select').setValue('campaign-2')
    await flushPromises()
    expect(wrapper.get('.participant-desk h2').text()).toBe('第二轮试测')
    expect((wrapper.get('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(false)
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    wrapper.unmount()
    vi.unstubAllGlobals()
  })

  it('does not show an empty-state contradiction when an expert has work but no participation campaign', async () => {
    mockParticipationPage({
      role: 'evaluator',
      assigned: [
        {
          id: 'assignment-1',
          campaign_name: campaign.name,
          seat: 1,
          status: 'assigned',
          item_stem: '核验AI结论',
          answer_response: {},
          rubric_title: '核验量规',
          rubric_criteria: {},
        },
      ],
    })
    const wrapper = mount(PilotLabView)
    await flushPromises()
    expect(wrapper.get('h1').text()).toBe('试测任务与盲评')
    expect(wrapper.text()).toContain('我的专家盲评任务')
    expect(wrapper.text()).toContain('封存独立评分')
    expect(wrapper.find('.empty').exists()).toBe(false)
    expect(wrapper.find('.selectors').exists()).toBe(false)
    wrapper.unmount()
    vi.unstubAllGlobals()
  })

  it('preserves administrator batch creation without an empty batch dropdown', async () => {
    mockParticipationPage({ role: 'org_admin' })
    const wrapper = mount(PilotLabView)
    await flushPromises()
    expect(wrapper.get('h1').text()).toBe('真实试测与指标验证')
    expect(wrapper.find('.selectors select').exists()).toBe(false)
    await wrapper.get('.empty-actions button').trigger('click')
    expect(wrapper.find('.create-strip').exists()).toBe(true)
    expect(wrapper.text()).toContain('建立预注册批次')
    wrapper.unmount()
    vi.unstubAllGlobals()
  })

  it('shows a retryable loading error instead of claiming there are no tasks', async () => {
    mockParticipationPage({ failed: true })
    const wrapper = mount(PilotLabView)
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    expect(wrapper.find('.empty').exists()).toBe(false)
    mockParticipationPage()
    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('暂时没有可参与的试测')
    wrapper.unmount()
    vi.unstubAllGlobals()
  })

  it('does not expose a join form when participation details fail to load', async () => {
    const request = mockParticipationPage({ available: [{ ...campaign, status: 'recruiting' }] })
    const fallback = request.getMockImplementation()!
    request.mockImplementation(async (input, init) =>
      String(input).endsWith('/me')
        ? json({ detail: '参与状态读取失败' }, 503)
        : fallback(input, init),
    )
    const wrapper = mount(PilotLabView)
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    expect(wrapper.find('.participant-desk').exists()).toBe(false)
    expect(wrapper.find('.empty').exists()).toBe(false)
    wrapper.unmount()
    vi.unstubAllGlobals()
  })

  it('keeps withdrawn participation read-only and explains its exclusion from statistics', async () => {
    const request = mockParticipationPage({ available: [{ ...campaign, status: 'recruiting' }] })
    const fallback = request.getMockImplementation()!
    request.mockImplementation(async (input, init) =>
      String(input).endsWith('/me')
        ? json({ id: 'participant-1', session_id: null, withdrawn_at: '2026-09-28T01:00:00Z' })
        : fallback(input, init),
    )
    const wrapper = mount(PilotLabView)
    await flushPromises()
    expect(wrapper.text()).toContain('已撤回试测')
    expect(wrapper.text()).toContain('不再进入试测统计')
    expect(wrapper.find('.participant-desk form').exists()).toBe(false)
    expect(wrapper.find('.withdraw-button').exists()).toBe(false)
    wrapper.unmount()
    vi.unstubAllGlobals()
  })
})
