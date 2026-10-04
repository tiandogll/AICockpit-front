// These integration regressions use the real feature store and only synthetic HTTP fixtures.
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TrainingView from '../views/TrainingView.vue'
import WorkspaceAssistant from '../components/WorkspaceAssistant.vue'
import { useAuthStore } from '../stores/auth'
import { useAccessStore } from '../stores/access'
import { useFeatureStore } from '../stores/features'

const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal')
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close')
const wrappers: VueWrapper[] = []
const text = '合成测试文字：先检查来源，再核验事实，并记录无法确认的内容。'
const configuration = {
  training_enabled: true,
  training_content_status: 'formative_preview',
  growth_guide_mode: 'deepseek',
  attachments_enabled: true,
  assessment_in_progress: false,
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
async function setup(refreshOnMount = false, firstKind = 'learning') {
  const pinia = createPinia()
  setActivePinia(pinia)
  const auth = useAuthStore()
  auth.accessToken = 'synthetic-token'
  auth.refreshToken = 'synthetic-refresh'
  auth.user = { id: 'synthetic-actor', email: null, display_name: '测试', is_active: true }
  const access = useAccessStore()
  access.ready = true
  access.organizationId = 'synthetic-org'
  let currentPlan = {
    id: 'synthetic-plan',
    organization_id: 'synthetic-org',
    source_report_id: 'synthetic-report',
    source_session_id: 'synthetic-session',
    source_report_revision: 1,
    source_report_changed: false,
    retest_available: true,
    retest_unavailable_reason: null,
    privacy_redacted: false,
    replaces_plan_id: null,
    template_version: 'engineering-v1',
    content_provenance: 'synthetic fixture',
    status: 'active',
    created_at: '2026-09-01T08:00:00Z',
    completed_at: null,
    dimensions: [{ code: 'evaluation', index: 35, level: 'L1', evidence_count: 3 }],
    assessment: {
      mode: 'standard',
      scenario: 'general',
      blueprint_version_id: 'synthetic-blueprint',
    },
    completed_tasks: 0,
    total_tasks: 2,
    tasks: [firstKind, 'exercise'].map((kind, index) => ({
      id: `synthetic-task-${index}`,
      sequence: index + 1,
      kind,
      title: `合成${kind}`,
      status: 'pending',
      content: { instructions: 'synthetic', material: 'synthetic' },
      submission: null,
      feedback: null as string | null,
      completed_at: null,
    })),
  }
  const featureQueue: Promise<Response>[] = []
  const writeQueue: Promise<Response>[] = []
  const api = vi.fn<typeof fetch>(async (input, init) => {
    const path = String(input)
    if (path.endsWith('/workspace/features'))
      return featureQueue.shift() ?? Response.json(configuration)
    if (init?.method === 'POST') {
      if (writeQueue.length) return writeQueue.shift()!
      currentPlan = {
        ...currentPlan,
        completed_tasks: 1,
        tasks: currentPlan.tasks.map((task, index) =>
          index === 0 ? { ...task, status: 'completed', feedback: '合成记录已保存。' } : task,
        ),
      }
      return Response.json({ plan: currentPlan, replayed: false })
    }
    const scopedPlan = { ...currentPlan, organization_id: access.organizationId }
    if (path.includes('/workspace/reports'))
      return Response.json({
        items: [
          {
            id: 'synthetic-report',
            session_id: 'synthetic-session',
            name: 'synthetic',
            mode: 'standard',
            scenario: 'general',
            status: 'complete',
            revision: 1,
            completed_at: '2026-08-31T08:00:00Z',
            dimensions: scopedPlan.dimensions,
          },
          {
            id: 'synthetic-retest-report',
            session_id: 'synthetic-retest-session',
            name: 'synthetic retest',
            mode: 'standard',
            scenario: 'general',
            status: 'complete',
            revision: 1,
            completed_at: '2026-09-02T08:00:00Z',
            dimensions: scopedPlan.dimensions,
          },
        ],
        total: 2,
        limit: 100,
        offset: 0,
      })
    if (path.endsWith('/training/synthetic-plan')) return Response.json(scopedPlan)
    if (path.includes('/training'))
      return Response.json({ items: [scopedPlan], total: 1, limit: 20, offset: 0 })
    throw new Error(`Unexpected synthetic request: ${path}`)
  })
  vi.stubGlobal('fetch', api)
  const features = useFeatureStore()
  await features.load()
  const mountedRefresh = deferred<Response>()
  if (refreshOnMount) {
    featureQueue.push(mountedRefresh.promise)
    void features.load(true)
  }
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/training', component: TrainingView },
      { path: '/reports', component: { template: '<div />' } },
      { path: '/reports/:session', component: { template: '<div />' } },
    ],
  })
  await router.push('/training')
  const wrapper = mount(
    {
      components: { TrainingView, WorkspaceAssistant },
      template: '<TrainingView /><WorkspaceAssistant name="测试" />',
    },
    { global: { plugins: [pinia, router], stubs: { Teleport: true } } },
  )
  wrappers.push(wrapper)
  await flushPromises()
  function queueRefresh() {
    const next = deferred<Response>()
    featureQueue.push(next.promise)
    return next
  }
  async function beginRefresh() {
    const next = queueRefresh()
    void features.load(true)
    await flushPromises()
    expect(features.ready).toBe(false)
    expect(features.trainingEnabled).toBe(false)
    return next
  }
  const writes = () => api.mock.calls.filter(([, init]) => init?.method === 'POST')
  const details = () =>
    api.mock.calls.filter(([input]) => String(input).endsWith('/training/synthetic-plan'))
  return {
    wrapper,
    auth,
    access,
    features,
    api,
    writes,
    details,
    queueRefresh,
    beginRefresh,
    writeQueue,
    mountedRefresh,
    currentPlan,
  }
}
function response(wrapper: VueWrapper) {
  return (wrapper.get('[data-testid="task-response"]').element as HTMLTextAreaElement).value
}
describe('training feature refresh', () => {
  beforeEach(() => {
    sessionStorage.clear()
    for (const name of ['showModal', 'close'])
      Object.defineProperty(HTMLDialogElement.prototype, name, {
        configurable: true,
        value: vi.fn(),
      })
  })
  afterEach(() => {
    for (const wrapper of wrappers.splice(0)) wrapper.unmount()
    vi.unstubAllGlobals()
    for (const [name, descriptor] of [
      ['showModal', originalShowModal],
      ['close', originalClose],
    ] as const) {
      if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor)
      else Reflect.deleteProperty(HTMLDialogElement.prototype, name)
    }
  })
  it('keeps an unsaved response when opening the actual robot, without reloading the plan', async () => {
    const state = await setup()
    await state.wrapper.get('[data-testid="task-response"]').setValue(text)
    const reads = state.details().length
    const refresh = state.queueRefresh()
    await state.wrapper.get('[aria-label="打开成长助手问答"]').trigger('click')
    await flushPromises()
    expect(state.features.trainingEnabled).toBe(false)
    expect(state.wrapper.find('[data-testid="submit-task"]').exists()).toBe(false)
    refresh.resolve(Response.json(configuration))
    await flushPromises()
    expect(response(state.wrapper)).toBe(text)
    expect(state.details()).toHaveLength(reads)
    expect(state.writes()).toHaveLength(0)
  })
  it('keeps the draft after a failed refresh and recovery while denying new writes', async () => {
    const state = await setup()
    await state.wrapper.get('[data-testid="task-response"]').setValue(text)
    const refresh = await state.beginRefresh()
    refresh.resolve(Response.json({ detail: '合成状态检查失败' }, { status: 503 }))
    await flushPromises()
    expect(state.wrapper.find('[data-testid="submit-task"]').exists()).toBe(false)
    const recovery = await state.beginRefresh()
    recovery.resolve(Response.json(configuration))
    await flushPromises()
    expect(response(state.wrapper)).toBe(text)
    expect(state.writes()).toHaveLength(0)
  })
  it('preserves both application fields across a refresh without submitting them', async () => {
    const state = await setup(false, 'application')
    const application = text.repeat(2)
    const verification = '合成核验记录：对照原始材料检查引用位置，并交叉验证结果。'.repeat(2)
    await state.wrapper.get('[data-testid="application-record"]').setValue(application)
    await state.wrapper.get('[data-testid="verification-record"]').setValue(verification)
    const refresh = await state.beginRefresh()
    refresh.resolve(Response.json(configuration))
    await flushPromises()
    expect(
      (state.wrapper.get('[data-testid="application-record"]').element as HTMLTextAreaElement)
        .value,
    ).toBe(application)
    expect(
      (state.wrapper.get('[data-testid="verification-record"]').element as HTMLTextAreaElement)
        .value,
    ).toBe(verification)
    expect(state.writes()).toHaveLength(0)
  })
  it('preserves a selected manual retest without linking it during refresh', async () => {
    const state = await setup(false, 'retest')
    await state.wrapper.get('[data-testid="manual-retest"]').setValue('synthetic-retest-session')
    const refresh = await state.beginRefresh()
    refresh.resolve(Response.json(configuration))
    await flushPromises()
    expect(
      (state.wrapper.get('[data-testid="manual-retest"]').element as HTMLSelectElement).value,
    ).toBe('synthetic-retest-session')
    expect(state.writes()).toHaveLength(0)
  })
  it('clears private drafts on a confirmed service shutdown, even if later re-enabled', async () => {
    const state = await setup()
    await state.wrapper.get('[data-testid="task-response"]').setValue(text)
    const refresh = await state.beginRefresh()
    refresh.resolve(Response.json({ ...configuration, training_enabled: false }))
    await flushPromises()
    expect(state.wrapper.text()).toContain('训练服务尚未启用')
    const recovery = await state.beginRefresh()
    recovery.resolve(Response.json(configuration))
    await flushPromises()
    expect(response(state.wrapper)).toBe('')
    expect(state.writes()).toHaveLength(0)
  })
  it('does not restore the old draft after switching organization during refresh', async () => {
    const state = await setup()
    await state.wrapper.get('[data-testid="task-response"]').setValue(text)
    const refresh = await state.beginRefresh()
    state.access.organizationId = 'other-synthetic-org'
    await flushPromises()
    refresh.resolve(Response.json(configuration))
    await flushPromises()
    expect(response(state.wrapper)).toBe('')
    expect(state.writes()).toHaveLength(0)
  })
  it('does not restore another account draft from a stale feature refresh', async () => {
    const state = await setup()
    await state.wrapper.get('[data-testid="task-response"]').setValue(text)
    const refresh = await state.beginRefresh()
    state.auth.user = {
      id: 'another-synthetic-actor',
      email: null,
      display_name: '另一人',
      is_active: true,
    }
    await flushPromises()
    state.access.organizationId = 'synthetic-org'
    state.access.ready = true
    await flushPromises()
    refresh.resolve(Response.json(configuration))
    await flushPromises()
    expect(response(state.wrapper)).toBe('')
    expect(state.writes()).toHaveLength(0)
  })
  it('initializes training when mounted during an existing same-user refresh', async () => {
    const state = await setup(true)
    expect(state.features.ready).toBe(false)
    expect(state.details()).toHaveLength(0)
    state.mountedRefresh.resolve(Response.json(configuration))
    await flushPromises()
    expect(response(state.wrapper)).toBe('')
    expect(state.details()).toHaveLength(1)
  })
  it('accepts an in-flight save receipt during refresh and releases the saving state', async () => {
    const state = await setup()
    await state.wrapper.get('[data-testid="task-response"]').setValue(text)
    const save = deferred<Response>()
    state.writeQueue.push(save.promise)
    await state.wrapper.get('[data-testid="submit-task"]').trigger('submit')
    const refresh = await state.beginRefresh()
    save.resolve(
      Response.json({
        plan: {
          ...state.currentPlan,
          completed_tasks: 1,
          tasks: state.currentPlan.tasks.map((task, index) =>
            index === 0 ? { ...task, status: 'completed', feedback: '合成记录已保存。' } : task,
          ),
        },
        replayed: false,
      }),
    )
    await flushPromises()
    refresh.resolve(Response.json(configuration))
    await flushPromises()
    expect(state.wrapper.text()).toContain('已完成 1 / 2 项')
    expect(state.wrapper.text()).toContain('合成记录已保存。')
    await state.wrapper.get('[data-testid="task-response"]').setValue(text)
    expect(
      state.wrapper.get('[data-testid="submit-task"] button[type="submit"]').attributes('disabled'),
    ).toBeUndefined()
    expect(state.writes()).toHaveLength(1)
  })
  it('preserves the error and original idempotency key for a failed in-flight save retry', async () => {
    const state = await setup()
    await state.wrapper.get('[data-testid="task-response"]').setValue(text)
    const save = deferred<Response>()
    state.writeQueue.push(save.promise)
    await state.wrapper.get('[data-testid="submit-task"]').trigger('submit')
    const refresh = await state.beginRefresh()
    save.resolve(Response.json({ detail: '合成保存失败，请重试' }, { status: 503 }))
    await flushPromises()
    refresh.resolve(Response.json(configuration))
    await flushPromises()
    expect(response(state.wrapper)).toBe(text)
    expect(state.wrapper.text()).toContain('合成保存失败')
    await state.wrapper.get('[data-testid="submit-task"]').trigger('submit')
    await flushPromises()
    const calls = state.writes()
    expect(calls).toHaveLength(2)
    const key = (index: number) => new Headers(calls[index]![1]?.headers).get('Idempotency-Key')
    expect(key(0)).toBeTruthy()
    expect(key(1)).toBe(key(0))
    expect(state.wrapper.text()).toContain('已完成 1 / 2 项')
  })
})
