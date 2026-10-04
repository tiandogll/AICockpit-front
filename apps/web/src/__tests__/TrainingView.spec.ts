import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'
import { reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TrainingView from '../views/TrainingView.vue'
import SelfStudyLibrary from '../components/SelfStudyLibrary.vue'
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
    singlePlatform?: boolean
    organizationId: string
    ready: boolean
    error: string
    load: () => Promise<void>
  },
}))
vi.mock('../stores/access', () => ({ useAccessStore: () => context.access }))
vi.mock('../stores/features', () => ({ useFeatureStore: () => context.features }))
const routing = vi.hoisted(() => ({ query: {} as Record<string, string>, push: vi.fn() }))
vi.mock('vue-router', () => ({
  useRoute: () => routing,
  useRouter: () => ({ push: routing.push }),
}))
const plan = {
  id: 'plan-1',
  organization_id: 'org-1',
  source_report_id: 'report-1',
  source_session_id: 'session-1',
  source_report_revision: 2,
  source_report_changed: false,
  retest_available: true,
  retest_unavailable_reason: null,
  privacy_redacted: false,
  replaces_plan_id: null,
  template_version: 'engineering-v1',
  content_provenance: '工程编写 v1 · 非专家认证 · 仅用于形成性训练',
  status: 'active',
  created_at: '2026-09-01T08:00:00Z',
  completed_at: null,
  dimensions: [{ code: 'evaluation', index: 35, level: 'L1', evidence_count: 3 }],
  assessment: { mode: 'standard', scenario: 'general', blueprint_version_id: 'blueprint-1' },
  completed_tasks: 0,
  total_tasks: 4,
  tasks: [
    {
      id: 'task-1',
      sequence: 1,
      kind: 'learning',
      title: '学习核验方法',
      status: 'pending',
      content: { instructions: '阅读材料并记录自己的理解。', material: '先检查来源，再核对结论。' },
      submission: null,
      feedback: null,
      completed_at: null,
    },
    {
      id: 'task-2',
      sequence: 2,
      kind: 'exercise',
      title: '练习核验',
      status: 'pending',
      content: { instructions: '练习' },
      submission: null,
      feedback: null,
      completed_at: null,
    },
    {
      id: 'task-3',
      sequence: 3,
      kind: 'application',
      title: '应用与核验',
      status: 'pending',
      content: { instructions: '应用' },
      submission: null,
      feedback: null,
      completed_at: null,
    },
    {
      id: 'task-4',
      sequence: 4,
      kind: 'retest',
      title: '正式复测',
      status: 'pending',
      content: { instructions: '复测' },
      submission: null,
      feedback: null,
      completed_at: null,
    },
  ],
}
const report = {
  id: 'report-1',
  session_id: 'session-1',
  name: '标准测评',
  mode: 'standard',
  scenario: 'general',
  status: 'complete',
  completed_at: '2026-08-31T08:00:00Z',
  revision: 2,
  dimensions: plan.dimensions,
}
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status })
}
const mountView = () => mount(TrainingView, { global: { stubs: { RouterLink: RouterLinkStub } } })
const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal')
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close')
const readyPlan = () => ({
  ...plan,
  completed_tasks: 3,
  retest: null as null | {
    session_id: string
    status: 'active' | 'completed' | 'abandoned'
    paused: boolean
    expired: boolean
    report_id: string | null
    report_is_complete: boolean
    report_status: string | null
  },
  comparison: null as null | {
    source_report_revision: number
    retest_report_revision: number
    dimensions: { code: string; before_index: number; after_index: number; change: number }[]
  },
  tasks: plan.tasks.map((task) =>
    task.kind === 'retest' ? task : { ...task, status: 'completed' },
  ),
})
function boundRetest(overrides: Partial<NonNullable<ReturnType<typeof readyPlan>['retest']>> = {}) {
  return {
    session_id: 'bound-session',
    status: 'active' as const,
    paused: false,
    expired: false,
    report_id: null,
    report_is_complete: false,
    report_status: null,
    ...overrides,
  }
}
function servePlan(
  value: ReturnType<typeof readyPlan>,
  onWrite?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
) {
  const request = vi.fn<typeof fetch>(async (input, init) => {
    if (init?.method === 'POST' && onWrite) return onWrite(input, init)
    const url = String(input)
    if (url.includes('/workspace/reports'))
      return json({ items: [report], total: 1, limit: 100, offset: 0 })
    if (url.endsWith(`/training/${value.id}`)) return json(value)
    return json({ items: [value], total: 1, limit: 20, offset: 0 })
  })
  vi.stubGlobal('fetch', request)
  return request
}

describe('TrainingView', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = true
      },
    })
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = false
      },
    })
    routing.query = {}
    routing.push.mockReset()
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
    context.features = reactive({
      trainingEnabled: true,
      ready: true,
      loading: false,
      error: '',
      load: vi.fn<() => Promise<void>>(async () => {}),
    })
  })
  afterEach(() => {
    for (const [name, descriptor] of [
      ['showModal', originalShowModal],
      ['close', originalClose],
    ] as const) {
      if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor)
      else Reflect.deleteProperty(HTMLDialogElement.prototype, name)
    }
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('launches a bound same-plan retest with a stable key after a lost response', async () => {
    let attempts = 0
    const ready = readyPlan()
    const request = servePlan(ready, async () => {
      if (++attempts === 1) return json({ detail: '复测暂时无法开始' }, 503)
      return json({ plan: { ...ready, retest: boundRetest() }, replayed: false })
    })
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.find('[data-testid="start-retest"]').text()).toContain('开始同方案复测')
    await wrapper.get('[data-testid="start-retest"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('复测暂时无法开始')
    await wrapper.get('[data-testid="start-retest"]').trigger('click')
    await flushPromises()
    const writes = request.mock.calls.filter(([, init]) => init?.method === 'POST')
    expect(writes).toHaveLength(2)
    expect(String(writes[0]![0])).toContain('/training/plan-1/retest/start')
    expect(JSON.parse(String(writes[0]![1]?.body))).toEqual({})
    expect(new Headers(writes[1]![1]?.headers).get('Idempotency-Key')).toBe(
      new Headers(writes[0]![1]?.headers).get('Idempotency-Key'),
    )
    expect(routing.push).toHaveBeenCalledExactlyOnceWith('/assessment/bound-session')
    wrapper.unmount()
  })

  it('continues an already bound paused retest even when new launch is unavailable', async () => {
    const request = servePlan({
      ...readyPlan(),
      retest_available: false,
      retest: boundRetest({ paused: true }),
    })
    const wrapper = mountView()
    await flushPromises()
    const link = wrapper
      .findAllComponents(RouterLinkStub)
      .find((item) => item.attributes('data-testid') === 'continue-retest')!
    expect(link.props('to')).toBe('/assessment/bound-session')
    expect(link.text()).toContain('继续同方案复测')
    expect(wrapper.find('[data-testid="start-retest"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="manual-retest"]').exists()).toBe(false)
    expect(request.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
    wrapper.unmount()
  })

  it.each(['pending_scoring', 'needs_review'])(
    'keeps bound %s reports visible without another assessment or automatic link',
    async (status) => {
      const request = servePlan({
        ...readyPlan(),
        retest: boundRetest({
          status: 'completed',
          report_id: 'bound-report',
          report_status: status,
          report_is_complete: true,
        }),
      })
      const wrapper = mountView()
      await flushPromises()
      const link = wrapper
        .findAllComponents(RouterLinkStub)
        .find((item) => item.attributes('data-testid') === 'bound-retest-report')!
      expect(link.props('to')).toBe('/reports/bound-session')
      expect(wrapper.text()).toContain(status === 'needs_review' ? '等待人工复核' : '等待评分定稿')
      expect(wrapper.find('[data-testid="start-retest"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="manual-retest"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="training-comparison"]').exists()).toBe(false)
      expect(request.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
      wrapper.unmount()
    },
  )

  it('links a legacy bound final report whose measurement status is null', async () => {
    const ready = {
      ...readyPlan(),
      retest: boundRetest({
        status: 'completed',
        report_id: 'legacy-final-report',
        report_is_complete: true,
        report_status: null,
      }),
    }
    const request = servePlan(ready, async () =>
      json({
        plan: {
          ...ready,
          status: 'completed',
          completed_tasks: 4,
          tasks: ready.tasks.map((task) => ({ ...task, status: 'completed' })),
        },
        replayed: false,
      }),
    )
    const wrapper = mountView()
    await flushPromises()
    const writes = request.mock.calls.filter(([, init]) => init?.method === 'POST')
    expect(writes).toHaveLength(1)
    expect(String(writes[0]![0])).toMatch(/\/training\/plan-1\/retest$/)
    expect(wrapper.text()).toContain('本次训练计划已完成')
    wrapper.unmount()
  })

  it.each([false, true])(
    'shows a neutral unavailable-comparison message only on non-redacted completed plans (redacted: %s)',
    async (redacted) => {
      const ready = readyPlan()
      servePlan({
        ...ready,
        status: 'completed',
        completed_tasks: 4,
        privacy_redacted: redacted,
        tasks: ready.tasks.map((task) => ({ ...task, status: 'completed' })),
        comparison: null,
      })
      const wrapper = mountView()
      await flushPromises()
      const message = '当前记录不满足同口径对比条件，暂不计算指数变化；可查看复测报告。'
      expect(wrapper.text().includes(message)).toBe(!redacted)
      expect(wrapper.find('[data-testid="training-comparison"]').exists()).toBe(false)
      wrapper.unmount()
    },
  )

  it.each([true, false])(
    'links a final bound report once even if new launches are unavailable (%s), displaying only its pinned comparison',
    async (retestAvailable) => {
      const ready = {
        ...readyPlan(),
        retest_available: retestAvailable,
        retest: boundRetest({
          status: 'completed',
          report_id: 'bound-report',
          report_status: 'complete',
          report_is_complete: true,
        }),
      }
      const request = servePlan(ready, async () =>
        json({
          plan: {
            ...ready,
            status: 'completed',
            completed_tasks: 4,
            tasks: ready.tasks.map((task) =>
              task.kind === 'retest'
                ? { ...task, status: 'completed', submission: { session_id: 'bound-session' } }
                : task,
            ),
            comparison: {
              source_report_revision: 2,
              retest_report_revision: 7,
              dimensions: [{ code: 'evaluation', before_index: 35, after_index: 47, change: 12 }],
            },
          },
          replayed: false,
        }),
      )
      const wrapper = mountView()
      await flushPromises()
      const writes = request.mock.calls.filter(([, init]) => init?.method === 'POST')
      expect(writes).toHaveLength(1)
      expect(String(writes[0]![0])).toMatch(/\/training\/plan-1\/retest$/)
      expect(JSON.parse(String(writes[0]![1]?.body))).toEqual({ session_id: 'bound-session' })
      const comparison = wrapper.get('[data-testid="training-comparison"]')
      expect(comparison.text()).toContain('修订 2')
      expect(comparison.text()).toContain('修订 7')
      expect(comparison.text()).toContain('+12.0')
      expect(comparison.text()).toContain('不代表训练的因果效果')
      wrapper.unmount()
    },
  )

  it('never loops automatic linking after a failure and retries with the same key', async () => {
    const ready = {
      ...readyPlan(),
      retest: boundRetest({
        status: 'completed',
        report_id: 'bound-report',
        report_status: 'complete',
        report_is_complete: true,
      }),
    }
    const request = servePlan(ready, async () => json({ detail: '关联暂时失败' }, 503))
    const wrapper = mountView()
    await flushPromises()
    expect(request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
    await wrapper.get('[data-testid="retry-link-retest"]').trigger('click')
    await flushPromises()
    const writes = request.mock.calls.filter(([, init]) => init?.method === 'POST')
    expect(writes).toHaveLength(2)
    expect(new Headers(writes[1]![1]?.headers).get('Idempotency-Key')).toBe(
      new Headers(writes[0]![1]?.headers).get('Idempotency-Key'),
    )
    wrapper.unmount()
  })

  it('does not loop when an idempotent link replay still returns the pending plan', async () => {
    const ready = {
      ...readyPlan(),
      retest: boundRetest({
        status: 'completed',
        report_id: 'bound-report',
        report_status: 'complete',
        report_is_complete: true,
      }),
    }
    const request = servePlan(ready, async () => json({ plan: ready, replayed: true }))
    const wrapper = mountView()
    await flushPromises()
    await flushPromises()
    expect(request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
    expect(wrapper.find('[data-testid="retry-link-retest"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="start-retest"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('refreshes a waiting retest and links it only after the final report is confirmed', async () => {
    const ready = {
      ...readyPlan(),
      retest: boundRetest({
        status: 'completed',
        report_id: 'bound-report',
        report_status: 'needs_review',
      }),
    }
    const request = servePlan(ready, async () =>
      json({
        plan: {
          ...ready,
          status: 'completed',
          completed_tasks: 4,
          tasks: ready.tasks.map((task) => ({ ...task, status: 'completed' })),
        },
        replayed: false,
      }),
    )
    const wrapper = mountView()
    await flushPromises()
    expect(request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0)
    ready.retest = boundRetest({
      status: 'completed',
      report_id: 'bound-report',
      report_status: 'complete',
      report_is_complete: true,
    })
    await wrapper.get('[data-testid="refresh-retest"]').trigger('click')
    await flushPromises()
    expect(request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
    expect(wrapper.text()).toContain('本次训练计划已完成')
    wrapper.unmount()
  })

  it('links a final retest received during feature refresh only once after readiness recovers', async () => {
    const waiting = {
      ...readyPlan(),
      retest: boundRetest({
        status: 'completed',
        report_id: 'bound-report',
        report_status: 'needs_review',
      }),
    }
    const final = {
      ...waiting,
      retest: boundRetest({
        status: 'completed',
        report_id: 'bound-report',
        report_status: 'complete',
        report_is_complete: true,
      }),
    }
    let resolveDetail!: (response: Response) => void
    let resolveLink!: (response: Response) => void
    let detailReads = 0
    const request = vi.fn<typeof fetch>(async (input, init) => {
      if (init?.method === 'POST')
        return new Promise<Response>((resolve) => {
          resolveLink = resolve
        })
      const url = String(input)
      if (url.endsWith('/training/plan-1')) {
        if (++detailReads === 1) return json(waiting)
        return new Promise<Response>((resolve) => {
          resolveDetail = resolve
        })
      }
      if (url.includes('/workspace/reports'))
        return json({ items: [report], total: 1, limit: 100, offset: 0 })
      return json({ items: [waiting], total: 1, limit: 20, offset: 0 })
    })
    vi.stubGlobal('fetch', request)
    const writes = () => request.mock.calls.filter(([, init]) => init?.method === 'POST')
    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('[data-testid="refresh-retest"]').trigger('click')
    context.features.ready = false
    context.features.trainingEnabled = false
    context.features.loading = true
    resolveDetail(json(final))
    await flushPromises()
    expect(writes()).toHaveLength(0)

    context.features.trainingEnabled = true
    context.features.loading = false
    context.features.ready = true
    await flushPromises()
    expect(writes()).toHaveLength(1)
    expect(String(writes()[0]![0])).toMatch(/\/training\/plan-1\/retest$/)
    resolveLink(
      json({
        plan: {
          ...final,
          status: 'completed',
          completed_tasks: 4,
          tasks: final.tasks.map((task) => ({ ...task, status: 'completed' })),
        },
        replayed: false,
      }),
    )
    await flushPromises()
    expect(wrapper.text()).toContain('本次训练计划已完成')

    context.features.ready = false
    context.features.trainingEnabled = false
    await flushPromises()
    context.features.trainingEnabled = true
    context.features.ready = true
    await flushPromises()
    expect(writes()).toHaveLength(1)
    expect(detailReads).toBe(2)
    wrapper.unmount()
  })

  it('does not apply a final-link response after the signed-in identity changes', async () => {
    let resolveLink!: (response: Response) => void
    const ready = {
      ...readyPlan(),
      retest: boundRetest({
        status: 'completed',
        report_id: 'bound-report',
        report_status: 'complete',
        report_is_complete: true,
      }),
    }
    const request = vi.fn<typeof fetch>(async (input, init) => {
      if (init?.method === 'POST')
        return new Promise<Response>((resolve) => {
          resolveLink = resolve
        })
      if (useAuthStore().user?.id === 'next-user')
        return json({ items: [], total: 0, limit: 20, offset: 0 })
      if (String(input).endsWith('/training/plan-1')) return json(ready)
      if (String(input).includes('/workspace/reports'))
        return json({ items: [report], total: 1, limit: 100, offset: 0 })
      return json({ items: [ready], total: 1, limit: 20, offset: 0 })
    })
    vi.stubGlobal('fetch', request)
    const wrapper = mountView()
    await flushPromises()
    useAuthStore().user = {
      id: 'next-user',
      email: null,
      display_name: '下一账号',
      is_active: true,
    }
    await flushPromises()
    resolveLink(json({ plan: { ...ready, status: 'completed' }, replayed: false }))
    await flushPromises()
    expect(wrapper.text()).not.toContain('本次训练计划已完成')
    expect(wrapper.text()).toContain('尚未生成训练计划')
    expect(request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
    wrapper.unmount()
  })

  it('drops a pending launch response after the training feature is disabled', async () => {
    let resolveStart!: (response: Response) => void
    const ready = readyPlan()
    servePlan(
      ready,
      () =>
        new Promise<Response>((resolve) => {
          resolveStart = resolve
        }),
    )
    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('[data-testid="start-retest"]').trigger('click')
    context.features.trainingEnabled = false
    await flushPromises()
    resolveStart(json({ plan: { ...ready, retest: boundRetest() }, replayed: false }))
    await flushPromises()
    expect(routing.push).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('训练服务尚未启用')
    wrapper.unmount()
  })

  it('does not navigate from a late launch response after the organization changes', async () => {
    let resolveStart!: (response: Response) => void
    const ready = readyPlan()
    const request = servePlan(
      ready,
      () =>
        new Promise<Response>((resolve) => {
          resolveStart = resolve
        }),
    )
    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('[data-testid="start-retest"]').trigger('click')
    context.access.organizationId = 'org-2'
    await flushPromises()
    resolveStart(json({ plan: { ...ready, retest: boundRetest() }, replayed: false }))
    await flushPromises()
    expect(routing.push).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="continue-retest"]').exists()).toBe(false)
    expect(request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
    wrapper.unmount()
  })

  it('does not restore the prior plan when its launch response arrives after a route-plan change', async () => {
    routing.query = reactive({ plan: 'plan-1' })
    let resolveStart!: (response: Response) => void
    const ready = readyPlan()
    const next = { ...readyPlan(), id: 'next-plan', tasks: plan.tasks }
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input, init) => {
        if (init?.method === 'POST')
          return new Promise<Response>((resolve) => {
            resolveStart = resolve
          })
        const url = String(input)
        if (url.endsWith('/training/plan-1')) return json(ready)
        if (url.endsWith('/training/next-plan')) return json(next)
        if (url.includes('/workspace/reports'))
          return json({ items: [report], total: 1, limit: 100, offset: 0 })
        return json({ items: [ready, next], total: 2, limit: 20, offset: 0 })
      }),
    )
    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('[data-testid="start-retest"]').trigger('click')
    routing.query.plan = 'next-plan'
    await flushPromises()
    resolveStart(json({ plan: { ...ready, retest: boundRetest() }, replayed: false }))
    await flushPromises()
    expect(routing.push).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="task-response"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="continue-retest"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('offers a new attempt only after the bound retest has ended or expired', async () => {
    servePlan({ ...readyPlan(), retest: boundRetest({ status: 'abandoned', expired: true }) })
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.get('[data-testid="start-retest"]').text()).toContain('重新开始同方案复测')
    expect(wrapper.find('[data-testid="continue-retest"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="manual-retest"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('does not present training as available when the server feature is disabled', async () => {
    context.features.trainingEnabled = false
    const request = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', request)
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.text()).toContain('训练服务尚未启用')
    expect(wrapper.find('[data-testid="create-plan"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('训练记录保存尚未开放')
    expect(wrapper.findAll('[aria-label^="阅读方法："]')).toHaveLength(6)
    await wrapper.get('[aria-label="阅读方法：结果评估"]').trigger('click')
    expect(wrapper.get<HTMLDialogElement>('.study-dialog').element.open).toBe(true)
    expect(wrapper.get('.study-dialog').text()).toContain('原始出处')
    await wrapper.get('[aria-label="关闭学习方法"]').trigger('click')
    expect(wrapper.get<HTMLDialogElement>('.study-dialog').element.open).toBe(false)
    await wrapper.get('[data-testid="retry-training-availability"]').trigger('click')
    expect(context.features.load).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-testid="submit-task"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('已完成 0 / 4')
    expect(request).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it.each([
    { index: 35, evidence_count: 1, copy: '证据还不足' },
    { index: null, evidence_count: 0, copy: '尚无可用于训练的维度证据' },
  ])(
    'offers self-study without an ineligible create button for $index / $evidence_count',
    async ({ index, evidence_count, copy }) => {
      const request = vi.fn<typeof fetch>(async (input) =>
        String(input).includes('/workspace/reports')
          ? json({
              items: [
                {
                  ...report,
                  dimensions: [{ code: 'evaluation', index, level: 'L3', evidence_count }],
                },
              ],
              total: 1,
              limit: 100,
              offset: 0,
            })
          : json({ items: [], total: 0, limit: 20, offset: 0 }),
      )
      vi.stubGlobal('fetch', request)
      const wrapper = mountView()
      await flushPromises()
      expect(wrapper.text()).toContain(copy)
      expect(wrapper.find('[data-testid="create-plan"]').exists()).toBe(false)
      expect(wrapper.find('#self-study').exists()).toBe(false)
      expect(wrapper.text()).toContain('通用学习资料')
      expect(wrapper.find('[data-testid="submit-task"]').exists()).toBe(false)
      expect(request.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
      wrapper.unmount()
    },
  )

  it('keeps an evidenced below-50 report eligible without inventing a saved plan', async () => {
    const request = vi.fn<typeof fetch>(async (input) =>
      String(input).includes('/workspace/reports')
        ? json({
            items: [
              {
                ...report,
                dimensions: [{ code: 'evaluation', index: 49.99, level: 'L2', evidence_count: 2 }],
              },
            ],
            total: 1,
            limit: 100,
            offset: 0,
          })
        : json({ items: [], total: 0, limit: 20, offset: 0 }),
    )
    vi.stubGlobal('fetch', request)
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.get('[data-testid="create-plan"]').attributes('disabled')).toBeUndefined()
    expect(wrapper.find('#self-study').exists()).toBe(false)
    expect(wrapper.text()).toContain('尚未生成训练计划')
    expect(request.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
    wrapper.unmount()
  })

  it.each([50, 72])(
    'can explicitly generate a challenge from evidenced index %s',
    async (index) => {
      const request = vi.fn<typeof fetch>(async (input, init) => {
        if (init?.method === 'POST') return json({ plan, replayed: false })
        return String(input).includes('/workspace/reports')
          ? json({
              items: [
                {
                  ...report,
                  dimensions: [{ code: 'evaluation', index, level: 'L3', evidence_count: 2 }],
                },
              ],
              total: 1,
              limit: 100,
              offset: 0,
            })
          : json({ items: [], total: 0, limit: 20, offset: 0 })
      })
      vi.stubGlobal('fetch', request)
      const wrapper = mountView()
      await flushPromises()
      expect(wrapper.findComponent(SelfStudyLibrary).exists()).toBe(false)
      expect(wrapper.text()).toContain('本次将生成：巩固训练')
      expect(request.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
      await wrapper.get('[data-testid="training-goal"]').setValue('challenge')
      await wrapper.get('[data-testid="generate-personal-plan"]').trigger('click')
      await flushPromises()
      const write = request.mock.calls.find(([, init]) => init?.method === 'POST')
      expect(JSON.parse(write![1]!.body as string).goal).toBe('challenge')
      wrapper.unmount()
    },
  )

  it('opens the general library without fetching or generating a personal plan', async () => {
    routing.query = { view: 'library' }
    const request = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', request)
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.findComponent(SelfStudyLibrary).exists()).toBe(true)
    expect(wrapper.find('[data-testid="create-plan"]').exists()).toBe(false)
    expect(request).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('explains the saved evidence basis without pretending each visit generates new work', async () => {
    servePlan({
      ...readyPlan(),
      generation_basis: {
        goal_label: '巩固训练',
        method: '报告证据匹配；未调用大模型',
        completed_exercises: 1,
        targets: [
          {
            code: 'evaluation',
            index: 50,
            evidence_count: 2,
            incorrect_count: 1,
            question_sequences: [2],
            focus_labels: ['事实与来源核验'],
            reason: '已有证据上巩固方法',
          },
        ],
      },
    } as ReturnType<typeof readyPlan>)
    const wrapper = mountView()
    await flushPromises()
    const basis = wrapper.get('[data-testid="generation-basis"]')
    expect(basis.text()).toContain('未调用大模型')
    expect(basis.text()).toContain('事实与来源核验')
    wrapper.unmount()
  })

  it('switches an active plan into isolated reading and resumes normal loading when the query is removed', async () => {
    routing.query = reactive({ learn: '' })
    const request = servePlan(readyPlan())
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.find('#self-study').exists()).toBe(false)
    expect(wrapper.find('[data-testid="start-retest"]').exists()).toBe(true)
    const beforeReading = request.mock.calls.length
    routing.query.learn = 'evaluation'
    await flushPromises()
    expect(wrapper.getComponent(SelfStudyLibrary).props('initialCode')).toBe('evaluation')
    expect(wrapper.find('[data-testid="start-retest"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="create-plan"]').exists()).toBe(false)
    expect(
      wrapper
        .findAllComponents(RouterLinkStub)
        .find((link) => link.attributes('data-testid') === 'return-to-training')
        ?.props('to'),
    ).toBe('/training')
    expect(request.mock.calls).toHaveLength(beforeReading)
    routing.query.learn = ''
    await flushPromises()
    expect(wrapper.find('[data-testid="start-retest"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="return-to-training"]').exists()).toBe(false)
    expect(request.mock.calls.length).toBeGreaterThan(beforeReading)
    expect(context.features.load).toHaveBeenCalledTimes(2)
    expect(request.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
    wrapper.unmount()
  })

  it.each(['enabled', 'loading', 'failed'])(
    'keeps a direct study link read-only and independent of %s training services',
    async (state) => {
      routing.query = { learn: 'evaluation', plan: 'plan-1', report: 'report-1' }
      if (state === 'loading') {
        context.features.ready = false
        context.features.loading = true
      } else if (state === 'failed') {
        context.features.error = '服务检查失败'
        context.access.error = '权限服务暂不可用'
      }
      const request = vi.fn<typeof fetch>(async () => json({ detail: '服务不可用' }, 503))
      vi.stubGlobal('fetch', request)
      const wrapper = mountView()
      await flushPromises()
      expect(wrapper.getComponent(SelfStudyLibrary).props('initialCode')).toBe('evaluation')
      expect(wrapper.find('[data-testid="return-to-training"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="create-plan"]').exists()).toBe(false)
      expect(wrapper.text()).not.toContain('正在确认训练服务状态')
      expect(wrapper.text()).not.toContain('服务检查失败')
      expect(request).not.toHaveBeenCalled()
      expect(context.features.load).not.toHaveBeenCalled()
      expect(context.access.load).not.toHaveBeenCalled()
      wrapper.unmount()
    },
  )

  it('clears an unsaved plan draft when entering independent reading', async () => {
    routing.query = reactive({ learn: '' })
    const request = servePlan({ ...readyPlan(), completed_tasks: 0, tasks: plan.tasks })
    const wrapper = mountView()
    await flushPromises()
    await wrapper
      .get('[data-testid="task-response"]')
      .setValue('这段尚未提交的练习内容不能被阅读入口意外保存，也不能带入下次作答。')
    routing.query.learn = 'foundations'
    await flushPromises()
    expect(wrapper.find('[data-testid="task-response"]').exists()).toBe(false)
    routing.query.learn = ''
    await flushPromises()
    expect(
      (wrapper.get('[data-testid="task-response"]').element as HTMLTextAreaElement).value,
    ).toBe('')
    expect(request.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
    wrapper.unmount()
  })

  it('does not automatically link a final retest when a late plan response arrives during reading', async () => {
    routing.query = reactive({ learn: '' })
    const completedRetestPlan = {
      ...readyPlan(),
      retest: boundRetest({
        status: 'completed',
        report_id: 'final-report',
        report_is_complete: true,
        report_status: 'complete',
      }),
    }
    let resolveDetail!: (response: Response) => void
    const request = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.endsWith('/training/plan-1'))
        return new Promise((resolve) => {
          resolveDetail = resolve
        })
      if (url.includes('/workspace/reports'))
        return json({ items: [report], total: 1, limit: 100, offset: 0 })
      return json({ items: [completedRetestPlan], total: 1, limit: 20, offset: 0 })
    })
    vi.stubGlobal('fetch', request)
    const wrapper = mountView()
    await flushPromises()
    expect(resolveDetail).toBeTypeOf('function')
    routing.query.learn = 'evaluation'
    await flushPromises()
    const beforeResponse = request.mock.calls.length
    resolveDetail(json(completedRetestPlan))
    await flushPromises()
    expect(wrapper.find('[data-testid="return-to-training"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="start-retest"]').exists()).toBe(false)
    expect(request.mock.calls).toHaveLength(beforeResponse)
    expect(request.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
    wrapper.unmount()
  })

  it.each(['evaluation', 'unknown-dimension'])(
    'validates a direct learning dimension %s without API access when disabled',
    async (learn) => {
      routing.query = { learn }
      context.features.trainingEnabled = false
      const request = vi.fn<typeof fetch>()
      vi.stubGlobal('fetch', request)
      const wrapper = mountView()
      await flushPromises()
      expect(wrapper.getComponent(SelfStudyLibrary).props('initialCode')).toBe(
        learn === 'evaluation' ? learn : undefined,
      )
      expect(request).not.toHaveBeenCalled()
      wrapper.unmount()
    },
  )

  it('retains a missing requested report warning without substituting a training source', async () => {
    routing.query = { report: 'unavailable-report' }
    const request = vi.fn<typeof fetch>(async (input) =>
      String(input).includes('/workspace/reports')
        ? json({ items: [report], total: 1, limit: 100, offset: 0 })
        : json({ items: [], total: 0, limit: 20, offset: 0 }),
    )
    vi.stubGlobal('fetch', request)
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.text()).toContain('不会自动替换为其他报告')
    expect((wrapper.get('[data-testid="source-report"]').element as HTMLSelectElement).value).toBe(
      '',
    )
    expect(wrapper.get('[data-testid="create-plan"]').attributes('disabled')).toBeDefined()
    expect(request.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
    wrapper.unmount()
  })

  it('shows unknown and failed service states without requesting private training records', async () => {
    context.features.trainingEnabled = false
    context.features.ready = false
    context.features.loading = true
    const request = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', request)
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.text()).toContain('正在确认训练服务状态')
    context.features.loading = false
    context.features.error = '服务检查失败'
    await flushPromises()
    expect(wrapper.text()).not.toContain('训练服务尚未启用')
    await wrapper.get('[data-testid="retry-training-availability"]').trigger('click')
    expect(context.features.load).toHaveBeenCalledTimes(2)
    expect(request).not.toHaveBeenCalled()
  })

  it('opens exactly the linked plan even if it is not in the first list page', async () => {
    routing.query = { plan: 'specific-plan' }
    const request = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.endsWith('/training/specific-plan'))
        return json({
          ...plan,
          id: 'specific-plan',
          tasks: plan.tasks.map((task) => ({ ...task, title: '指定计划的任务' })),
        })
      if (url.includes('/workspace/reports'))
        return json({ items: [report], total: 1, limit: 100, offset: 0 })
      return json({ items: [plan], total: 50, limit: 20, offset: 0 })
    })
    vi.stubGlobal('fetch', request)
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.text()).toContain('指定计划的任务')
    expect(wrapper.text()).toContain('形成性训练预览')
    expect(request.mock.calls.some((call) => String(call[0]).endsWith('/training/plan-1'))).toBe(
      false,
    )
  })

  it('does not substitute a plan from another organization into the current page', async () => {
    routing.query = { plan: 'other-plan' }
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input) => {
        const url = String(input)
        if (url.endsWith('/training/other-plan'))
          return json({ ...plan, organization_id: 'other-org' })
        return json({ items: [], total: 0, limit: 20, offset: 0 })
      }),
    )
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.text()).toContain('不属于当前组织')
    expect(wrapper.find('[data-testid="submit-task"]').exists()).toBe(false)
  })

  it('keeps an owned legacy training plan accessible after joining the unified platform', async () => {
    context.access.singlePlatform = true
    context.access.organizationId = 'platform'
    routing.query = { plan: 'plan-1' }
    const request = vi.fn<typeof fetch>(async (input) => {
      if (String(input).endsWith('/training/plan-1')) return json(plan)
      return json({ items: [], total: 0, limit: 20, offset: 0 })
    })
    vi.stubGlobal('fetch', request)
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.text()).toContain('学习核验方法')
    expect(wrapper.text()).not.toContain('不属于当前组织')
    expect(wrapper.find('[data-testid="submit-task"]').exists()).toBe(true)
    for (const call of request.mock.calls.filter(([input]) => String(input).includes('/training?')))
      expect(new URL(String(call[0])).searchParams.has('organization_id')).toBe(false)
  })

  it('discloses template provenance and preserves one idempotency key on a failed task retry', async () => {
    let attempts = 0
    const request = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      if (init?.method === 'POST') {
        attempts += 1
        if (attempts === 1) return json({ detail: '保存暂时失败，请重试' }, 503)
        return json({
          plan: {
            ...plan,
            completed_tasks: 1,
            tasks: plan.tasks.map((task, index) =>
              index === 0 ? { ...task, status: 'completed', feedback: '已保存学习记录。' } : task,
            ),
          },
          replayed: false,
        })
      }
      if (url.includes('/workspace/reports'))
        return json({ items: [report], total: 1, limit: 100, offset: 0 })
      if (url.endsWith('/training/plan-1')) return json(plan)
      return json({ items: [plan], total: 1, limit: 20, offset: 0 })
    })
    vi.stubGlobal('fetch', request)
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.text()).toContain('非专家认证')
    expect(wrapper.text()).toContain('不直接改变正式能力分数')
    await wrapper
      .get('[data-testid="task-response"]')
      .setValue('我会先核对信息来源，再交叉检查事实，并记录仍然无法证实的部分。')
    await wrapper.get('[data-testid="submit-task"]').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('保存暂时失败')
    await wrapper.get('[data-testid="submit-task"]').trigger('submit')
    await flushPromises()
    const writes = request.mock.calls.filter((call) => call[1]?.method === 'POST')
    expect(writes).toHaveLength(2)
    const firstKey = new Headers(writes[0]?.[1]?.headers).get('Idempotency-Key')
    expect(firstKey).toBeTruthy()
    expect(new Headers(writes[1]?.[1]?.headers).get('Idempotency-Key')).toBe(firstKey)
    expect(wrapper.text()).toContain('已完成 1 / 4 项')
    expect(wrapper.get('[data-testid="latest-training-feedback"]').text()).toContain(
      '已保存学习记录。',
    )
    expect(wrapper.get('[data-testid="latest-training-feedback"]').text()).toContain(
      '不代表能力已经提升',
    )
    await wrapper.get('[data-testid="latest-training-feedback"] header button').trigger('click')
    expect(wrapper.find('[data-testid="latest-training-feedback"]').exists()).toBe(false)
  })

  it('requires explicit confirmation before replacing a plan', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input) => {
        const url = String(input)
        if (url.includes('/workspace/reports'))
          return json({ items: [report], total: 1, limit: 100, offset: 0 })
        if (url.endsWith('/training/plan-1')) return json(plan)
        return json({ items: [plan], total: 1, limit: 20, offset: 0 })
      }),
    )
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.get('[data-testid="create-plan"]').attributes('disabled')).toBeDefined()
    await wrapper.get('[data-testid="confirm-replacement"]').setValue(true)
    expect(wrapper.get('[data-testid="create-plan"]').attributes('disabled')).toBeUndefined()
  })

  it.each([
    { nextId: 'replacement-a', requiresConfirmation: false },
    { nextId: 'replacement-b', requiresConfirmation: true },
  ])(
    'binds regeneration confirmation to the verified replacement after refresh ($nextId)',
    async ({ nextId, requiresConfirmation }) => {
      let replacementId = 'replacement-a'
      const request = vi.fn<typeof fetch>(async (input) => {
        const url = String(input)
        if (url.includes('source_report_id=report-1'))
          return json({ items: [{ ...plan, id: replacementId }], total: 1, limit: 1, offset: 0 })
        if (url.includes('/workspace/reports'))
          return json({ items: [report], total: 1, limit: 100, offset: 0 })
        if (url.endsWith('/training/plan-1')) return json(plan)
        return json({ items: [plan], total: 1, limit: 20, offset: 0 })
      })
      vi.stubGlobal('fetch', request)
      const wrapper = mountView()
      await flushPromises()
      await wrapper.get('[data-testid="confirm-replacement"]').setValue(true)
      expect(wrapper.get('[data-testid="create-plan"]').attributes('disabled')).toBeUndefined()

      context.features.ready = false
      context.features.trainingEnabled = false
      context.features.loading = true
      await flushPromises()
      replacementId = nextId
      context.features.trainingEnabled = true
      context.features.loading = false
      context.features.ready = true
      await flushPromises()
      expect(
        wrapper.get<HTMLInputElement>('[data-testid="confirm-replacement"]').element.checked,
      ).toBe(!requiresConfirmation)
      expect(wrapper.get('[data-testid="create-plan"]').attributes('disabled') !== undefined).toBe(
        requiresConfirmation,
      )
      if (requiresConfirmation) {
        await wrapper.get('[data-testid="confirm-replacement"]').setValue(true)
        expect(wrapper.get('[data-testid="create-plan"]').attributes('disabled')).toBeUndefined()
      }
      expect(
        request.mock.calls.filter(([input]) => String(input).includes('source_report_id=report-1')),
      ).toHaveLength(2)
      expect(request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0)
      wrapper.unmount()
    },
  )

  it('creates training against the server-projected source report organization after unification', async () => {
    context.access.singlePlatform = true
    context.access.organizationId = 'platform'
    const request = vi.fn<typeof fetch>(async (input, init) => {
      if (init?.method === 'POST') return json({ plan, replayed: false })
      if (String(input).includes('/workspace/reports'))
        return json({
          items: [{ ...report, organization_id: 'legacy-report-org' }],
          total: 1,
          limit: 100,
          offset: 0,
        })
      return json({ items: [], total: 0, limit: 20, offset: 0 })
    })
    vi.stubGlobal('fetch', request)
    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('[data-testid="create-plan"]').trigger('click')
    await flushPromises()
    const write = request.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(JSON.parse(String(write?.[1]?.body))).toMatchObject({
      organization_id: 'legacy-report-org',
      source_report_id: report.id,
      expected_report_revision: report.revision,
    })
    expect(context.access.organizationId).toBe('platform')
  })

  it('discards an old organization task-save response after the organization changes', async () => {
    let resolveSave!: (response: Response) => void
    const save = new Promise<Response>((resolve) => {
      resolveSave = resolve
    })
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input, init) => {
        const url = String(input)
        if (init?.method === 'POST') return save
        if (url.includes('organization_id=org-2'))
          return json({ items: [], total: 0, limit: 20, offset: 0 })
        if (url.includes('/workspace/reports'))
          return json({ items: [report], total: 1, limit: 100, offset: 0 })
        if (url.endsWith('/training/plan-1')) return json(plan)
        return json({ items: [plan], total: 1, limit: 20, offset: 0 })
      }),
    )
    const wrapper = mountView()
    await flushPromises()
    await wrapper
      .get('[data-testid="task-response"]')
      .setValue('我会先检查来源，再核验事实，并明确标注尚未证实的部分和疑问。')
    await wrapper.get('[data-testid="submit-task"]').trigger('submit')
    context.access.organizationId = 'org-2'
    await flushPromises()
    resolveSave(json({ plan, replayed: false }))
    await flushPromises()
    expect(wrapper.text()).not.toContain('学习核验方法')
    expect(wrapper.text()).not.toContain('训练记录已保存')
    expect(wrapper.text()).toContain('尚未生成训练计划')
  })

  it.each(['identity', 'organization'] as const)(
    'synchronously invalidates a paginated private draft and ignores its late save after a %s switch',
    async (scope) => {
      const auth = useAuthStore()
      auth.user = { id: 'first-user', email: null, display_name: '第一账号', is_active: true }
      let resolveSave!: (response: Response) => void
      const save = new Promise<Response>((resolve) => {
        resolveSave = resolve
      })
      const request = vi.fn<typeof fetch>(async (input, init) => {
        const url = String(input)
        if (init?.method === 'POST') return save
        if (auth.user?.id !== 'first-user' || context.access.organizationId !== 'org-1')
          return json({ items: [], total: 0, limit: 20, offset: 0 })
        if (url.includes('/workspace/reports'))
          return json({ items: [report], total: 1, limit: 100, offset: 0 })
        if (url.endsWith('/training/plan-1')) return json(plan)
        return json({
          items: [plan],
          total: 40,
          limit: 20,
          offset: new URL(url).searchParams.get('offset'),
        })
      })
      vi.stubGlobal('fetch', request)
      const wrapper = mountView()
      await flushPromises()
      await wrapper.get('[aria-label="下一页"]').trigger('click')
      await flushPromises()
      expect(wrapper.get('.plan-pages').text()).toContain('2 / 2')
      await wrapper
        .get('[data-testid="task-response"]')
        .setValue('合成分页草稿：核对信息来源并明确记录尚未证实的结论和问题。')
      await wrapper.get('[data-testid="submit-task"]').trigger('submit')

      if (scope === 'identity')
        auth.user = { id: 'next-user', email: null, display_name: '下一账号', is_active: true }
      else context.access.organizationId = 'org-2'
      const state = wrapper.vm as unknown as {
        draft: { response: string }
        selected: unknown
        saving: boolean
      }
      // This assertion is intentionally before Vue's next tick: pagination must
      // not postpone private-context invalidation until an offset watcher runs.
      expect(state.draft.response).toBe('')
      expect(state.selected).toBeNull()
      expect(state.saving).toBe(false)

      resolveSave(
        json({
          plan: {
            ...plan,
            completed_tasks: 1,
            tasks: plan.tasks.map((task, index) =>
              index === 0 ? { ...task, status: 'completed', feedback: '旧上下文保存回执' } : task,
            ),
          },
          replayed: false,
        }),
      )
      await flushPromises()
      expect(wrapper.text()).not.toContain('学习核验方法')
      expect(wrapper.text()).not.toContain('旧上下文保存回执')
      expect(wrapper.text()).not.toContain('训练记录已保存')
      expect(wrapper.text()).toContain('尚未生成训练计划')
      expect(request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
      wrapper.unmount()
    },
  )

  it('shows server unavailability instead of an empty successful plan', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => json({ detail: '训练服务暂不可用' }, 503)),
    )
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('训练服务暂不可用')
    expect(wrapper.find('[data-testid="create-plan"]').exists()).toBe(false)
  })

  it('selects the exact source report linked from the report page', async () => {
    routing.query = { report: 'report-requested' }
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input) =>
        String(input).includes('/workspace/reports')
          ? json({
              items: [report, { ...report, id: 'report-requested', name: '指定来源报告' }],
              total: 2,
              limit: 100,
              offset: 0,
            })
          : json({ items: [], total: 0, limit: 20, offset: 0 }),
      ),
    )
    const wrapper = mountView()
    await flushPromises()
    expect((wrapper.get('[data-testid="source-report"]').element as HTMLSelectElement).value).toBe(
      'report-requested',
    )
  })

  it('keeps retired-blueprint training records visible and blocks unavailable retest', async () => {
    const unavailable = {
      ...plan,
      completed_tasks: 3,
      retest_available: false,
      retest_unavailable_reason: '来源题卷已停用，当前无法开始兼容复测。',
      tasks: plan.tasks.map((task) =>
        task.kind === 'retest' ? task : { ...task, status: 'completed' },
      ),
    }
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input) => {
        const url = String(input)
        if (url.includes('/workspace/reports'))
          return json({ items: [report], total: 1, limit: 100, offset: 0 })
        if (url.endsWith('/training/plan-1')) return json(unavailable)
        return json({ items: [unavailable], total: 1, limit: 20, offset: 0 })
      }),
    )
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.text()).toContain('来源题卷已停用')
    expect(wrapper.text()).toContain('已完成记录')
    expect(
      wrapper.get('[data-testid="submit-task"] button[type="submit"]').attributes('disabled'),
    ).toBeDefined()
  })

  it('links existing compatible legacy retests without offering a new legacy assessment', async () => {
    context.access.singlePlatform = true
    context.access.organizationId = 'platform'
    const legacy = {
      ...plan,
      completed_tasks: 3,
      retest_available: false,
      retest_unavailable_reason: 'legacy_platform_baseline',
      tasks: plan.tasks.map((task) =>
        task.kind === 'retest' ? task : { ...task, status: 'completed' },
      ),
    }
    const compatible = {
      ...report,
      id: 'compatible-report',
      session_id: 'compatible-session',
      name: '原口径已完成复测',
      organization_id: plan.organization_id,
      completed_at: '2026-09-20T08:00:00Z',
    }
    const request = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      if (init?.method === 'POST') return json({ plan: legacy, replayed: false })
      if (url.includes('/workspace/reports'))
        return json({
          items: [
            report,
            compatible,
            {
              ...compatible,
              id: 'platform-report',
              session_id: 'platform-session',
              name: '不同口径新平台测评',
              organization_id: 'platform',
            },
          ],
          total: 3,
          limit: 100,
          offset: 0,
        })
      if (url.endsWith('/training/plan-1')) return json(legacy)
      return json({ items: [legacy], total: 1, limit: 20, offset: 0 })
    })
    vi.stubGlobal('fetch', request)
    const wrapper = mountView()
    await flushPromises()
    const form = wrapper.get('[data-testid="submit-task"]')
    expect(form.find('a').exists()).toBe(false)
    expect(form.text()).toContain('已有兼容复测记录仍可关联')
    expect(form.text()).not.toContain('不同口径新平台测评')
    await form.get('select').setValue('compatible-session')
    expect(form.get('button[type="submit"]').attributes('disabled')).toBeUndefined()
    await form.trigger('submit')
    await flushPromises()
    const write = request.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(String(write?.[0])).toContain('/training/plan-1/retest')
    expect(JSON.parse(String(write?.[1]?.body))).toEqual({ session_id: 'compatible-session' })
  })

  it('does not expose a write form for privacy-redacted training records', async () => {
    const redacted = { ...plan, privacy_redacted: true }
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input) => {
        const url = String(input)
        if (url.includes('/workspace/reports'))
          return json({ items: [], total: 0, limit: 100, offset: 0 })
        if (url.endsWith('/training/plan-1')) return json(redacted)
        return json({ items: [redacted], total: 1, limit: 20, offset: 0 })
      }),
    )
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.text()).toContain('隐私处理')
    expect(wrapper.find('[data-testid="submit-task"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('本次训练计划已完成')
  })

  it('replaces the latest source plan even when it is absent from the visible plan page', async () => {
    const latest = { ...plan, id: 'latest-source-plan' }
    const request = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      if (init?.method === 'POST')
        return json({ plan: { ...latest, id: 'replacement-new' }, replayed: false })
      if (url.includes('/workspace/reports'))
        return json({ items: [report], total: 1, limit: 100, offset: 0 })
      if (url.includes('source_report_id=report-1'))
        return json({ items: [latest], total: 1, limit: 1, offset: 0 })
      if (url.endsWith('/training/plan-other'))
        return json({ ...plan, id: 'plan-other', source_report_id: 'report-other' })
      return json({
        items: [{ ...plan, id: 'plan-other', source_report_id: 'report-other' }],
        total: 50,
        limit: 20,
        offset: 0,
      })
    })
    vi.stubGlobal('fetch', request)
    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('[data-testid="confirm-replacement"]').setValue(true)
    await wrapper.get('[data-testid="create-plan"]').trigger('click')
    await flushPromises()
    const write = request.mock.calls.find((call) => call[1]?.method === 'POST')
    expect(JSON.parse(String(write?.[1]?.body)).replaces_plan_id).toBe('latest-source-plan')
  })
})
