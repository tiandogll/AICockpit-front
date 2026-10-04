import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'
import { reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WorkspaceView from '../views/WorkspaceView.vue'
import { useAuthStore } from '../stores/auth'

const context = vi.hoisted(() => ({
  features: null as unknown as {
    trainingEnabled: boolean
    ready: boolean
    loading: boolean
    error: string
    load: () => Promise<void>
  },
  access: null as unknown as {
    organizationId: string
    organizations?: { id: string; can_participate_assessment: boolean }[]
    ready: boolean
    error: string
    load: () => Promise<void>
  },
}))
vi.mock('../stores/access', () => ({ useAccessStore: () => context.access }))
vi.mock('../stores/features', () => ({ useFeatureStore: () => context.features }))

function json(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200 })
}
const overview = {
  active_sessions: [
    {
      id: 'active-1',
      name: '高校标准测评',
      mode: 'standard',
      scenario: 'higher_education',
      answered: 7,
      max_items: 36,
      dimension_counts: { prompting: 2 },
      last_saved_at: null,
    },
  ],
  recent_reports: [
    {
      id: 'report-1',
      session_id: 'session-1',
      name: '我的能力报告',
      mode: 'standard',
      scenario: 'higher_education',
      status: 'complete',
      completed_at: '2026-09-01T08:00:00Z',
      revision: 2,
      dimensions: [{ code: 'evaluation', index: null, level: 'insufficient', evidence_count: 0 }],
    },
  ],
  report_count: 1,
  service_status: { state: 'available', label: '测评服务可用' },
}
const mountView = () =>
  mount(WorkspaceView, {
    global: {
      stubs: {
        Teleport: true,
        RouterLink: RouterLinkStub,
        WorkspaceAbilityChart: {
          props: ['dimensions'],
          template: '<div data-testid="six-dimension-chart">{{ JSON.stringify(dimensions) }}</div>',
        },
        GrowthAssistantEntry: { template: '<section data-testid="growth-assistant-entry" />' },
      },
    },
  })

describe('WorkspaceView', () => {
  beforeEach(() => {
    context.features = reactive({
      trainingEnabled: false,
      ready: true,
      loading: false,
      error: '',
      load: vi.fn<() => Promise<void>>(async () => {}),
    })
    sessionStorage.clear()
    sessionStorage.setItem(
      'zhijian-auth-session',
      JSON.stringify({ accessToken: 'token', refreshToken: 'refresh' }),
    )
    setActivePinia(createPinia())
    context.access = reactive({
      organizationId: 'org-1',
      ready: true,
      error: '',
      load: vi.fn<() => Promise<void>>(async () => {}),
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('uses persisted progress and leaves missing scores and timestamps missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => json(overview)),
    )
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.text()).toContain('已保存 7 题')
    expect(wrapper.find('progress').exists()).toBe(false)
    expect(wrapper.text()).toContain('暂无保存时间')
    expect(wrapper.get('[data-testid="six-dimension-chart"]').text()).toContain('"index":null')
    expect(wrapper.text()).not.toContain('综合分')
    expect(
      wrapper
        .findAllComponents(RouterLinkStub)
        .some((link) => link.props('to') === '/assessment/active-1'),
    ).toBe(true)
  })

  it('keeps real dashboard regions without displaying unavailable training as four tasks', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => json(overview)),
    )
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.findAll('[data-testid="evidence-coverage"] li')).toHaveLength(6)
    expect(wrapper.find('[data-testid="training-steps"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('训练服务尚未启用')
    expect(wrapper.find('[data-testid="assistant-image-slot"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('机器人素材待提供')
    expect(wrapper.find('.assistant-launcher img').exists()).toBe(false)
    expect(wrapper.find('.workspace-composer').exists()).toBe(false)
    expect(wrapper.find('[data-testid="growth-assistant-entry"]').exists()).toBe(false)
    expect(wrapper.findAll('.reports-table thead th').map((cell) => cell.text())).toEqual([
      '测评名称',
      '模式',
      '完成时间',
      '状态',
      '操作',
    ])
    expect(wrapper.text()).not.toMatch(/预计提升|结果可信度|已完成\s*\d+%/)
  })

  it('does not turn a specialized session or report into six required dimensions', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () =>
        json({
          ...overview,
          active_sessions: [{ ...overview.active_sessions[0], mode: 'specialized' }],
          recent_reports: [{ ...overview.recent_reports[0], mode: 'specialized' }],
        }),
      ),
    )
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.find('[data-testid="evidence-coverage"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="specialized-session-note"]').text()).toContain(
      '仅评估所选能力维度',
    )
    expect(wrapper.find('[data-testid="six-dimension-chart"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('专项能力概览')
    expect(wrapper.text()).toContain('不作六维整体能力判断')
  })

  it('does not invent pending training tasks before a personal plan exists', async () => {
    context.features.trainingEnabled = true
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (url) =>
        json(String(url).includes('/training?') ? { items: [], total: 0 } : overview),
      ),
    )
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.find('[data-testid="training-steps"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('建立训练计划')
  })

  it('keeps six-dimensional reference structure for a new learner without inventing progress', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () =>
        json({
          ...overview,
          active_sessions: [],
          recent_reports: [],
          report_count: 0,
        }),
      ),
    )
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.findAll('[data-testid="initial-dimensions"] li')).toHaveLength(6)
    expect(wrapper.get('[data-testid="initial-dimensions"]').text()).toContain('待测评')
    expect(wrapper.find('.reports-table thead').exists()).toBe(true)
    expect(wrapper.text()).toContain('选择方案后进入答题工作区')
    expect(wrapper.find('progress').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('已完成 61%')
  })

  it('does not request learner data when an administrator has no assessment membership', async () => {
    context.access.organizations = [{ id: 'org-1', can_participate_assessment: false }]
    context.features.trainingEnabled = true
    const request = vi.fn<typeof fetch>(async () => json(overview))
    vi.stubGlobal('fetch', request)
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.text()).toContain('当前账号暂无测评参与资格')
    expect(wrapper.text()).toContain('联系管理员确认账号状态')
    expect(request).not.toHaveBeenCalled()
    expect(wrapper.find('.workspace-grid').exists()).toBe(false)
  })

  it('limits recent reports to three real entries', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () =>
        json({
          ...overview,
          recent_reports: Array.from({ length: 5 }, (_, index) => ({
            ...overview.recent_reports[0],
            id: `report-${index}`,
            session_id: `session-${index}`,
          })),
        }),
      ),
    )
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.findAll('.reports-table tbody tr')).toHaveLength(3)
  })

  it('greets the real learner and lets them choose another persisted active session', async () => {
    useAuthStore().user = {
      id: 'learner-1',
      display_name: '小林',
      email: 'lin@example.test',
      is_active: true,
    }
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () =>
        json({
          ...overview,
          active_sessions: [
            ...overview.active_sessions,
            {
              ...overview.active_sessions[0],
              id: 'active-2',
              name: '固定题卷',
              mode: 'fixed',
              answered: 12,
              max_items: 24,
            },
          ],
        }),
      ),
    )
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.text()).toContain('小林')
    await wrapper.get('[data-testid="active-session-select"]').setValue('active-2')
    expect(wrapper.text()).toContain('已保存 12 题')
    expect(wrapper.get('progress').attributes('value')).toBe('50')
    expect(
      wrapper
        .findAllComponents(RouterLinkStub)
        .some((link) => link.props('to') === '/assessment/active-2'),
    ).toBe(true)
  })

  it('clears previous organization data and ignores delayed responses after switching', async () => {
    let resolveFirst!: (response: Response) => void
    const first = new Promise<Response>((resolve) => {
      resolveFirst = resolve
    })
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockReturnValueOnce(first)
        .mockResolvedValueOnce(
          json({ ...overview, active_sessions: [], recent_reports: [], report_count: 0 }),
        ),
    )
    const wrapper = mountView()
    await flushPromises()
    context.access.organizationId = 'org-2'
    await flushPromises()
    resolveFirst(json(overview))
    await flushPromises()
    expect(wrapper.text()).not.toContain('高校标准测评')
    expect(wrapper.text()).toContain('暂无能力报告')
  })

  it('does not describe a fixed form with missing metadata as adaptive', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () =>
        json({
          ...overview,
          active_sessions: [{ ...overview.active_sessions[0], mode: 'fixed', max_items: null }],
        }),
      ),
    )
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.text()).not.toMatch(/实时调整|按证据覆盖结束|自适应题量/)
    expect(wrapper.text()).toContain('题量上限未记录')
  })

  it.each([
    { status: 'completed', privacy_redacted: false },
    { status: 'active', privacy_redacted: true },
  ])('offers read-only record navigation for sealed training: %o', async (state) => {
    context.features.trainingEnabled = true
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input) =>
        String(input).includes('/training?')
          ? json({
              items: [
                {
                  id: 'archived-plan',
                  dimensions: [],
                  completed_tasks: 4,
                  total_tasks: 4,
                  tasks: [],
                  ...state,
                },
              ],
              total: 1,
              limit: 1,
              offset: 0,
            })
          : json(overview),
      ),
    )
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.text()).not.toContain('继续训练')
    expect(wrapper.text()).toContain('查看训练记录')
    expect(wrapper.text()).not.toContain('本周训练计划')
  })

  it('shows a retryable error instead of a success state when the overview fails', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(json(overview))
    vi.stubGlobal('fetch', request)
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('无法读取工作台')
    await wrapper.get('[data-testid="retry-workspace"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('高校标准测评')
  })

  it('shows persisted training progress when the service is enabled', async () => {
    context.features.trainingEnabled = true
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input) =>
        String(input).includes('/training?')
          ? json({
              items: [
                {
                  id: 'plan-1',
                  dimensions: [{ code: 'evaluation' }],
                  status: 'active',
                  completed_tasks: 2,
                  total_tasks: 4,
                  tasks: [{ id: 'task-3', title: '应用核验任务', status: 'pending' }],
                  privacy_redacted: false,
                },
              ],
              total: 1,
              limit: 1,
              offset: 0,
            })
          : json(overview),
      ),
    )
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.text()).toContain('已完成 2 / 4 项')
    expect(wrapper.text()).toContain('应用核验任务')
    expect(
      wrapper
        .findAllComponents(RouterLinkStub)
        .some(
          (link) =>
            JSON.stringify(link.props('to')) ===
            JSON.stringify({ path: '/training', query: { plan: 'plan-1' } }),
        ),
    ).toBe(true)
  })

  it('keeps the assessment usable if the independent training summary request fails', async () => {
    context.features.trainingEnabled = true
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input) =>
        String(input).includes('/training?')
          ? new Response('{"detail":"训练服务暂不可用"}', { status: 503 })
          : json(overview),
      ),
    )
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.text()).toContain('高校标准测评')
    expect(wrapper.text()).toContain('训练服务暂不可用')
    expect(wrapper.find('[data-testid="retry-training-summary"]').exists()).toBe(true)
  })

  it('keeps assessment usable while feature availability is unknown or failed', async () => {
    context.features.ready = false
    context.features.loading = true
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => json(overview)),
    )
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.text()).toContain('正在确认训练服务状态')
    expect(wrapper.text()).toContain('高校标准测评')
    expect(wrapper.text()).not.toContain('训练服务尚未启用')
    context.features.loading = false
    context.features.error = '无法确认训练服务状态'
    await flushPromises()
    await wrapper.get('[data-testid="retry-training-availability"]').trigger('click')
    expect(context.features.load).toHaveBeenCalledTimes(2)
  })
})
