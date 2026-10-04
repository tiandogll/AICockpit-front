import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { reactive } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ReportView from '../views/ReportView.vue'
import { useAuthStore } from '../stores/auth'

const api = vi.hoisted(() => ({
  report: vi.fn(),
  session: vi.fn(),
  plans: vi.fn(),
  features: null as unknown as {
    ready: boolean
    trainingEnabled: boolean
    loading: boolean
    error: string
    load: ReturnType<typeof vi.fn>
  },
}))
vi.mock('../services/reportApi', () => ({ getReport: api.report, downloadReportPdf: vi.fn() }))
vi.mock('../services/assessmentApi', () => ({ getAssessmentSession: api.session }))
vi.mock('../services/trainingApi', () => ({ getTrainingPlans: api.plans }))
vi.mock('../stores/features', () => ({ useFeatureStore: () => api.features }))

function result(state = 'pending', sessionId = 'session-1') {
  const complete = state === 'complete'
  return {
    id: `report-${sessionId}`,
    session_id: sessionId,
    is_complete: complete,
    revision: complete ? 2 : 1,
    processing: {
      state,
      automatic_scoring_enabled: state !== 'paused',
      pending_answers: complete ? 0 : 1,
      failed_answers: state === 'retrying' ? 1 : 0,
      review_answers: state === 'needs_review' ? 1 : 0,
    },
    payload: {
      measurement_status: complete
        ? 'complete'
        : state === 'needs_review'
          ? 'needs_review'
          : 'pending_scoring',
      summary: {
        pending_scoring: complete ? 0 : 1,
        needs_review: state === 'needs_review' ? 1 : 0,
      },
      dimensions: { evaluation: { synthesis: { index: 35, level: 'L1', evidence_count: 3 } } },
      recommendations: [],
    },
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const wrappers: VueWrapper[] = []
async function render() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/reports/:sessionId', component: ReportView },
      { path: '/reports', component: { template: '<div />' } },
      { path: '/training', component: { template: '<div />' } },
      { path: '/assessment', component: { template: '<div />' } },
    ],
  })
  await router.push('/reports/session-1')
  const wrapper = mount(ReportView, {
    global: { plugins: [router], stubs: { SixDimensionChart: true, ReportEvidencePanel: true } },
  })
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, router }
}
function trainingLinks(wrapper: VueWrapper) {
  // Saved training plans are gated; authored read-only learning is available independently.
  return wrapper.findAll('a').filter((link) => {
    const href = link.attributes('href') ?? ''
    return (
      href.startsWith('/training') && !new URL(href, 'http://localhost').searchParams.has('learn')
    )
  })
}
function learningLinks(wrapper: VueWrapper) {
  return wrapper
    .findAll('a')
    .filter((link) => link.attributes('href')?.startsWith('/training?learn='))
}
function finalResult(index = 50, evidenceCount = 2) {
  const value = result('complete')
  value.payload.dimensions.evaluation.synthesis = {
    index,
    level: 'L3',
    evidence_count: evidenceCount,
  }
  return value
}

describe('report processing refresh and training availability', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    setActivePinia(createPinia())
    const auth = useAuthStore()
    auth.accessToken = 'token'
    auth.refreshToken = 'refresh'
    auth.user = { id: 'learner-1', email: null, display_name: '学员', is_active: true }
    api.features = reactive({
      ready: true,
      trainingEnabled: true,
      loading: false,
      error: '',
      load: vi.fn(),
    })
    api.report.mockReset().mockResolvedValue(result())
    api.session
      .mockReset()
      .mockImplementation(async (id: string) => ({ id, organization_id: 'org-1' }))
    api.plans.mockReset().mockResolvedValue({ items: [] })
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
  })
  afterEach(() => {
    wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
    vi.useRealTimers()
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'close')
  })

  it('silently refreshes pending reports and stops on final completion', async () => {
    api.report.mockResolvedValueOnce(result()).mockResolvedValue(result('complete'))
    const { wrapper } = await render()
    expect(api.plans).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(5000)
    await flushPromises()
    expect(wrapper.text()).toContain('报告版本 R2')
    expect(wrapper.text()).toContain('可信评分完成')
    expect(api.plans).toHaveBeenCalledTimes(1)
    expect(trainingLinks(wrapper).length).toBeGreaterThan(0)
    await vi.advanceTimersByTimeAsync(30000)
    expect(api.report).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['needs_review', '等待人工复核'],
    ['paused', '自动评分已暂停'],
    ['blocked', '评分配置异常'],
    ['complete', '可信评分完成'],
  ])('does not poll %s and offers a read-only manual refresh', async (state, label) => {
    api.report.mockResolvedValue(result(state))
    const { wrapper } = await render()
    expect(wrapper.get('.status-pill').text()).toBe(label)
    await vi.advanceTimersByTimeAsync(30000)
    expect(api.report).toHaveBeenCalledTimes(1)
    await wrapper.get('[data-testid="refresh-report"]').trigger('click')
    await flushPromises()
    expect(api.report).toHaveBeenCalledTimes(2)
  })

  it('shows retryable failure truthfully and keeps read-only polling serial', async () => {
    const waiting = deferred<ReturnType<typeof result>>()
    api.report.mockResolvedValueOnce(result('retrying')).mockReturnValueOnce(waiting.promise)
    const { wrapper } = await render()
    expect(wrapper.text()).toContain('评分暂未成功')
    await vi.advanceTimersByTimeAsync(30000)
    expect(api.report).toHaveBeenCalledTimes(2)
    expect(wrapper.get('[data-testid="refresh-report"]').attributes('disabled')).toBeDefined()
    waiting.resolve(result('needs_review'))
    await flushPromises()
    await vi.advanceTimersByTimeAsync(10000)
    expect(api.report).toHaveBeenCalledTimes(2)
  })

  it('supports old servers and bounds automatic reads to a five-minute window', async () => {
    const legacy = { ...result(), processing: undefined }
    api.report.mockResolvedValue(legacy)
    const { wrapper } = await render()
    await vi.advanceTimersByTimeAsync(310000)
    await flushPromises()
    const requests = api.report.mock.calls.length
    expect(requests).toBeGreaterThan(1)
    expect(requests).toBeLessThanOrEqual(61)
    expect(wrapper.text()).toContain('自动刷新已暂停')
    await vi.advanceTimersByTimeAsync(60000)
    expect(api.report).toHaveBeenCalledTimes(requests)
  })

  it('preserves the last report after a read error and recovers manually', async () => {
    api.report
      .mockResolvedValueOnce(result())
      .mockRejectedValueOnce(new Error('网络断开'))
      .mockResolvedValue(result('complete'))
    const { wrapper } = await render()
    await vi.advanceTimersByTimeAsync(5000)
    await flushPromises()
    expect(wrapper.text()).toContain('报告版本 R1')
    expect(wrapper.text()).toContain('自动刷新已暂停')
    await vi.advanceTimersByTimeAsync(10000)
    expect(api.report).toHaveBeenCalledTimes(2)
    await wrapper.get('[data-testid="refresh-report"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('报告版本 R2')
  })

  it('discards a late response after a route switch and cancels reads on unmount', async () => {
    const waiting = deferred<ReturnType<typeof result>>()
    api.report
      .mockResolvedValueOnce(result())
      .mockReturnValueOnce(waiting.promise)
      .mockResolvedValue(result('paused', 'session-2'))
    const { wrapper, router } = await render()
    await vi.advanceTimersByTimeAsync(5000)
    await router.push('/reports/session-2')
    await flushPromises()
    waiting.resolve(result('complete'))
    await flushPromises()
    expect(wrapper.get('.status-pill').text()).toBe('自动评分已暂停')
    expect(api.plans).not.toHaveBeenCalled()
    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(30000)
    expect(api.report).toHaveBeenCalledTimes(3)
  })

  it('clears identity-scoped data immediately and ignores an old account response', async () => {
    const waiting = deferred<ReturnType<typeof result>>()
    api.report
      .mockResolvedValueOnce(result())
      .mockReturnValueOnce(waiting.promise)
      .mockResolvedValue(result('needs_review'))
    const { wrapper } = await render()
    await vi.advanceTimersByTimeAsync(5000)
    useAuthStore().user = {
      id: 'learner-2',
      email: null,
      display_name: '另一学员',
      is_active: true,
    }
    await flushPromises()
    waiting.resolve(result('complete'))
    await flushPromises()
    expect(wrapper.get('.status-pill').text()).toBe('等待人工复核')
    expect(api.plans).not.toHaveBeenCalled()
    useAuthStore().accessToken = ''
    useAuthStore().user = null
    await flushPromises()
    expect(wrapper.find('.report-summary').exists()).toBe(false)
    await vi.advanceTimersByTimeAsync(30000)
    expect(api.report).toHaveBeenCalledTimes(3)
  })

  it('aborts an in-flight read on unmount and does not follow its late response', async () => {
    const waiting = deferred<ReturnType<typeof result>>()
    api.report.mockResolvedValueOnce(result()).mockReturnValueOnce(waiting.promise)
    const { wrapper } = await render()
    await vi.advanceTimersByTimeAsync(5000)
    const signal = api.report.mock.calls[1]?.[1] as AbortSignal
    expect(signal.aborted).toBe(false)
    wrapper.unmount()
    expect(signal.aborted).toBe(true)
    waiting.resolve(result('complete'))
    await flushPromises()
    await vi.advanceTimersByTimeAsync(30000)
    expect(api.report).toHaveBeenCalledTimes(2)
    expect(api.plans).not.toHaveBeenCalled()
  })

  it.each(['disabled', 'unknown', 'error'])(
    'fails closed for %s training availability',
    async (availability) => {
      api.report.mockResolvedValue(result('complete'))
      api.features.trainingEnabled = availability === 'unknown'
      api.features.ready = availability === 'disabled'
      api.features.error = availability === 'error' ? '无法读取服务状态' : ''
      const { wrapper } = await render()
      expect(api.plans).not.toHaveBeenCalled()
      expect(trainingLinks(wrapper)).toHaveLength(0)
      expect(learningLinks(wrapper).length).toBeGreaterThan(0)
      expect(wrapper.text()).toContain(
        availability === 'disabled'
          ? '训练服务当前未启用'
          : availability === 'error'
            ? '无法确认训练服务状态'
            : '正在确认训练服务状态',
      )
    },
  )

  it('discards a late training response when the feature is disabled', async () => {
    const waiting = deferred<{ items: unknown[] }>()
    api.report.mockResolvedValue(result('complete'))
    api.plans.mockReturnValue(waiting.promise)
    const { wrapper } = await render()
    expect(api.plans).toHaveBeenCalledTimes(1)
    api.features.trainingEnabled = false
    await flushPromises()
    waiting.resolve({ items: [{ id: 'plan-1', tasks: [], completed_tasks: 0, total_tasks: 4 }] })
    await flushPromises()
    expect(trainingLinks(wrapper)).toHaveLength(0)
    expect(wrapper.text()).not.toContain('0/4 已完成')
  })

  it('loads training only after an unknown feature state becomes verified and enabled', async () => {
    api.features.ready = false
    api.report.mockResolvedValue(result('complete'))
    const { wrapper } = await render()
    expect(api.plans).not.toHaveBeenCalled()
    api.features.ready = true
    await flushPromises()
    expect(api.plans).toHaveBeenCalledTimes(1)
    expect(trainingLinks(wrapper).length).toBeGreaterThan(0)
    api.features.ready = false
    await flushPromises()
    expect(trainingLinks(wrapper)).toHaveLength(0)
  })

  it.each(['completed', 'redacted'])(
    'offers viewing instead of starting a %s plan',
    async (kind) => {
      api.report.mockResolvedValue(result('complete'))
      api.plans.mockResolvedValue({
        items: [
          {
            id: 'plan-1',
            status: kind === 'completed' ? 'completed' : 'active',
            privacy_redacted: kind === 'redacted',
            tasks: [{ id: 'task-1', title: '练习', status: 'pending' }],
            completed_tasks: 0,
            total_tasks: 4,
          },
        ],
      })
      const { wrapper } = await render()
      expect(wrapper.get('.training-button').text()).toBe('查看训练计划')
      expect(trainingLinks(wrapper).some((link) => link.text() === '开始')).toBe(false)
    },
  )

  it('does not treat a contradictory complete flag as a final training source', async () => {
    api.report.mockResolvedValue({ ...result('needs_review'), is_complete: true })
    const { wrapper } = await render()
    expect(api.plans).not.toHaveBeenCalled()
    expect(trainingLinks(wrapper)).toHaveLength(0)
  })

  it('accepts a legacy null measurement status when all completion evidence is final', async () => {
    const final = result('complete')
    api.report.mockResolvedValue({
      ...final,
      processing: undefined,
      payload: { ...final.payload, measurement_status: null },
    })
    const { wrapper } = await render()
    expect(wrapper.get('.status-pill').text()).toBe('可信评分完成')
    expect(api.plans).toHaveBeenCalledTimes(1)
    expect(trainingLinks(wrapper).length).toBeGreaterThan(0)
    await vi.advanceTimersByTimeAsync(30000)
    expect(api.report).toHaveBeenCalledTimes(1)
  })

  it.each([50, 71.9])(
    'offers optional consolidation for final index %s without calling it a weakness',
    async (index) => {
      api.report.mockResolvedValue(finalResult(index))
      const { wrapper } = await render()
      expect(wrapper.get('.priority-card').text()).toContain('巩固与进阶')
      expect(wrapper.get('.priority-card').text()).not.toContain('练好结果评估')
      expect(wrapper.get('.priority-card').text()).toContain('无需强行认定短板')
      expect(trainingLinks(wrapper).length).toBeGreaterThan(0)
      expect(wrapper.get('.priority-card a').text()).toBe('生成巩固／进阶计划')
      expect(wrapper.find('.learning-card ol').exists()).toBe(false)
      expect(wrapper.get('.learning-card').text()).toContain('阅读学习方法')
      expect(wrapper.get('.priority-card a').attributes('href')).toBe(
        '/training?report=report-session-1',
      )
    },
  )

  it('offers targeted training for a final index below 50 with at least two evidence items', async () => {
    api.report.mockResolvedValue(finalResult(49.9))
    const { wrapper } = await render()
    expect(wrapper.get('.priority-card').text()).toContain('优先提升项')
    expect(wrapper.get('.priority-card').text()).toContain('练好结果评估')
    expect(wrapper.get('.priority-card').text()).toContain('指数 49.9')
    expect(wrapper.get('.priority-card a').text()).toBe('生成专项训练计划')
    expect(wrapper.get('.priority-card a').attributes('href')).toBe(
      '/training?report=report-session-1',
    )
    expect(wrapper.find('.learning-card ol').exists()).toBe(false)
    expect(
      learningLinks(wrapper).some(
        (link) => link.attributes('href') === '/training?learn=evaluation',
      ),
    ).toBe(true)
  })

  it.each([0, 1])('does not diagnose a low index with only %s evidence item(s)', async (count) => {
    api.report.mockResolvedValue(finalResult(25, count))
    const { wrapper } = await render()
    expect(wrapper.get('.priority-card').text()).toContain('巩固与进阶')
    expect(wrapper.get('.priority-card').text()).toContain('不能把证据不足当作能力不足')
    expect(wrapper.get('.priority-card').text()).not.toContain('练好结果评估')
    expect(trainingLinks(wrapper)).toHaveLength(0)
    expect(learningLinks(wrapper).length).toBeGreaterThan(0)
  })

  it('does not diagnose or promise targeted training until pending scoring is final', async () => {
    const pending = result('needs_review')
    pending.payload.dimensions.evaluation.synthesis.index = 12
    api.report.mockResolvedValue(pending)
    const { wrapper } = await render()
    expect(wrapper.get('.priority-card').text()).toContain('等待评分定稿')
    expect(wrapper.get('.priority-card').text()).toContain('先等评分完成')
    expect(wrapper.get('.priority-card').text()).not.toContain('练好')
    expect(trainingLinks(wrapper)).toHaveLength(0)
    expect(api.plans).not.toHaveBeenCalled()
    await wrapper.get('.priority-card button').trigger('click')
    const dialog = wrapper.get('[aria-label="学习建议与下一步"]')
    expect(dialog.text()).toContain('报告尚未定稿，不据此生成短板训练计划')
    expect(dialog.text()).toContain('可以自主练习的方法')
    expect(learningLinks(wrapper).length).toBeGreaterThan(0)
  })

  it('keeps actionable reading available with the training service disabled and no fake plan', async () => {
    api.features.trainingEnabled = false
    api.report.mockResolvedValue(finalResult(49.9))
    const { wrapper, router } = await render()
    expect(api.plans).not.toHaveBeenCalled()
    expect(wrapper.find('.learning-card ol').exists()).toBe(false)
    expect(trainingLinks(wrapper)).toHaveLength(0)
    await wrapper.get('.priority-card button').trigger('click')
    const dialog = wrapper.get('[aria-label="学习建议与下一步"]')
    expect(dialog.text()).toContain('检查原始出处、发布时间和统计口径')
    expect(dialog.text()).toContain('训练服务当前未启用')
    await dialog.get('a[href="/training?learn=evaluation"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/training?learn=evaluation')
  })

  it('shows an actual existing plan even if the final report has no new weakness', async () => {
    api.report.mockResolvedValue(finalResult(60))
    api.plans.mockResolvedValue({
      items: [
        {
          id: 'existing-plan',
          status: 'active',
          privacy_redacted: false,
          tasks: [{ id: 'task-real', title: '已保存的核验练习', status: 'pending' }],
          completed_tasks: 0,
          total_tasks: 1,
        },
      ],
    })
    const { wrapper } = await render()
    expect(wrapper.get('.priority-card').text()).toContain('巩固与进阶')
    expect(wrapper.get('.training-button').text()).toBe('继续训练计划')
    expect(wrapper.get('.training-button').attributes('href')).toBe('/training?plan=existing-plan')
    expect(wrapper.get('.learning-card ol').text()).toContain('已保存的核验练习')
    expect(wrapper.get('.learning-card').text()).toContain('0/1 已完成')
    expect(wrapper.get('.learning-card').text()).not.toContain('四步成长')
  })
})
