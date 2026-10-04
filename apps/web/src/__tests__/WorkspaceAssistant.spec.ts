import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WorkspaceAssistant from '../components/WorkspaceAssistant.vue'
import { useAuthStore } from '../stores/auth'
import { useAccessStore } from '../stores/access'
import { useFeatureStore } from '../stores/features'

const routing = vi.hoisted(() => ({ current: null as unknown as { fullPath: string } }))
vi.mock('vue-router', () => ({ useRoute: () => routing.current }))
const enabled = {
  training_enabled: true,
  training_content_status: 'formative_preview',
  growth_guide_mode: 'deepseek',
  attachments_enabled: true,
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
let wrapper: VueWrapper | undefined
function render() {
  wrapper = mount(WorkspaceAssistant, {
    props: { name: '测试账号' },
    global: { stubs: { Teleport: true, GrowthAssistantEntry: true } },
  })
  return wrapper
}

describe('global assistant service lifecycle', () => {
  beforeEach(() => {
    routing.current = reactive({ fullPath: '/history' })
    sessionStorage.clear()
    sessionStorage.setItem(
      'zhijian-auth-session',
      JSON.stringify({ accessToken: 'a', refreshToken: 'r' }),
    )
    setActivePinia(createPinia())
    const access = useAccessStore()
    access.ready = true
    access.organizationId = 'org-1'
    vi.spyOn(access, 'load').mockResolvedValue()
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      value: vi.fn(function (this: HTMLDialogElement) {
        this.open = true
      }),
    })
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      configurable: true,
      value: vi.fn(function (this: HTMLDialogElement) {
        this.open = false
        this.dispatchEvent(new Event('close'))
      }),
    })
  })
  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    document.body.style.overflow = ''
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'close')
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('starts compact in the mobile assessment toolbar while retaining movement and route persistence', async () => {
    vi.stubGlobal('innerWidth', 390)
    vi.stubGlobal('innerHeight', 844)
    routing.current.fullPath = '/assessment/session-1'
    const view = render()
    await flushPromises()
    const robot = view.get('.workspace-assistant')
    expect(robot.classes()).toContain('mobile-header-dock')
    expect(robot.attributes('style')).toContain('left: 334px')
    expect(robot.attributes('style')).toContain('top: 8px')
    await view.get('.assistant-launcher').trigger('keydown', { key: 'ArrowLeft' })
    expect(robot.attributes('style')).toContain('left: 310px')
    routing.current.fullPath = '/history'
    await flushPromises()
    expect(robot.classes()).not.toContain('mobile-header-dock')
    expect(view.find('.assistant-launcher').exists()).toBe(true)
    routing.current.fullPath = '/assessment/session-2'
    await flushPromises()
    expect(robot.classes()).toContain('mobile-header-dock')
    expect(robot.attributes('style')).toContain('top: 8px')
    expect(robot.attributes('style')).toContain('left: 334px')
  })

  it('does not move the floating robot when a temporary viewport has no size', async () => {
    vi.stubGlobal('innerWidth', 1440)
    vi.stubGlobal('innerHeight', 1000)
    const view = render()
    await flushPromises()
    const before = view.get('.workspace-assistant').attributes('style')
    vi.stubGlobal('innerWidth', 0)
    vi.stubGlobal('innerHeight', 0)
    window.dispatchEvent(new Event('resize'))
    await flushPromises()
    expect(view.get('.workspace-assistant').attributes('style')).toBe(before)
    expect(view.get('.workspace-assistant').classes()).not.toContain('mobile-header-dock')
  })

  it.each([
    '/assessment/session-1',
    '/assessment/session-1?review=1',
    '/report',
    '/reports',
    '/reports/session-1',
    '/reports?mode=rapid',
    '/training',
    '/training?learn=evaluation',
    '/training#self-study',
    '/pilot-lab',
    '/pilot-lab?batch=one',
  ])(
    'docks compactly on mobile %s and restores normal floating mode on workspace',
    async (path) => {
      vi.stubGlobal('innerWidth', 390)
      vi.stubGlobal('innerHeight', 844)
      routing.current.fullPath = path
      const view = render()
      await flushPromises()
      const robot = view.get('.workspace-assistant')
      expect(robot.classes()).toContain('mobile-header-dock')
      expect(robot.attributes('style')).toContain('left: 334px')
      expect(robot.attributes('style')).toContain('top: 8px')
      await view.get('.assistant-launcher').trigger('keydown', { key: 'ArrowLeft' })
      expect(robot.attributes('style')).toContain('left: 310px')
      routing.current.fullPath = '/workspace'
      await flushPromises()
      expect(robot.classes()).not.toContain('mobile-header-dock')
      expect(view.find('.assistant-launcher').exists()).toBe(true)
      routing.current.fullPath = path
      await flushPromises()
      expect(robot.classes()).toContain('mobile-header-dock')
      expect(robot.attributes('style')).toContain('left: 334px')
      expect(robot.attributes('style')).toContain('top: 8px')
    },
  )

  it.each([
    '/trainingXYZ',
    '/reports-archive',
    '/reporting',
    '/pilot-laboratory',
    '/assessment',
    '/assessmentXYZ/session-1',
    '/workspace',
  ])('does not dock unrelated mobile route %s', async (path) => {
    vi.stubGlobal('innerWidth', 390)
    vi.stubGlobal('innerHeight', 844)
    routing.current.fullPath = path
    const view = render()
    await flushPromises()
    expect(view.get('.workspace-assistant').classes()).not.toContain('mobile-header-dock')
  })

  it('respects the 600px boundary and allows dragging the compact learning-page robot', async () => {
    vi.stubGlobal('innerWidth', 601)
    vi.stubGlobal('innerHeight', 844)
    routing.current.fullPath = '/training?learn=evaluation'
    const view = render()
    await flushPromises()
    expect(view.get('.workspace-assistant').classes()).not.toContain('mobile-header-dock')
    vi.stubGlobal('innerWidth', 600)
    window.dispatchEvent(new Event('resize'))
    await flushPromises()
    const robot = view.get('.workspace-assistant')
    expect(robot.classes()).toContain('mobile-header-dock')
    expect(robot.attributes('style')).toContain('left: 544px')
    const button = view.get('.assistant-launcher')
    Object.defineProperty(button.element, 'setPointerCapture', {
      configurable: true,
      value: vi.fn(),
    })
    button.element.dispatchEvent(
      new MouseEvent('pointerdown', { button: 0, clientX: 560, clientY: 24 }),
    )
    button.element.dispatchEvent(new MouseEvent('pointermove', { clientX: 480, clientY: 120 }))
    button.element.dispatchEvent(new MouseEvent('pointerup'))
    await flushPromises()
    expect(robot.attributes('style')).toContain('left: 464px')
    expect(robot.attributes('style')).toContain('top: 104px')
    await button.trigger('click')
    expect(HTMLDialogElement.prototype.showModal).not.toHaveBeenCalled()
  })

  it('keeps the visible robot animated without a pause control, including when opening the drawer', async () => {
    useAuthStore().user = { id: 'learner', email: null, display_name: '学员', is_active: true }
    useAccessStore().ready = true
    useAccessStore().organizationId = 'org-1'
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(async () => json(enabled)),
    )
    const view = render()
    await flushPromises()
    expect(view.find('.motion-toggle').exists()).toBe(false)
    expect(view.text()).not.toContain('暂停动画')
    expect(view.get('.workspace-assistant').classes()).not.toContain('is-paused')
    await view.get('[aria-label="打开成长助手问答"]').trigger('click')
    await flushPromises()
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledTimes(1)
    expect(view.get('[aria-label="打开成长助手问答"]').attributes('aria-expanded')).toBe('true')
    expect(view.get('.workspace-assistant').classes()).not.toContain('is-paused')
    await view.get('[aria-label="关闭成长助手问答"]').trigger('click')
    expect(view.get('.workspace-assistant').classes()).not.toContain('is-paused')
  })

  it.each(['learner', 'admin'])(
    'loads after /auth/me for %s, without a workspace-view rescue request',
    async (actor) => {
      const request = vi.fn<typeof fetch>().mockResolvedValue(json(enabled))
      vi.stubGlobal('fetch', request)
      render()
      await flushPromises()
      expect(request).not.toHaveBeenCalled()
      useAuthStore().user = { id: actor, email: null, display_name: actor, is_active: true }
      await flushPromises()
      expect(request).toHaveBeenCalledTimes(1)
      expect(String(request.mock.calls[0]?.[0])).toContain('/workspace/features')
      expect(useFeatureStore().ready).toBe(true)
      expect(useFeatureStore().growthGuideMode).toBe('deepseek')
      expect(useFeatureStore().attachmentsEnabled).toBe(true)
      expect(useAccessStore().load).not.toHaveBeenCalled()
    },
  )

  it('refreshes on opening, recovers from a failed read on reopening, and preserves the provider', async () => {
    useAuthStore().user = { id: 'learner', email: null, display_name: '学员', is_active: true }
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(enabled))
      .mockResolvedValueOnce(json({}, 503))
      .mockResolvedValueOnce(json(enabled))
    vi.stubGlobal('fetch', request)
    const view = render()
    await flushPromises()
    const features = useFeatureStore()
    expect(features.ready).toBe(true)
    await view.get('[aria-label="打开成长助手问答"]').trigger('click')
    await flushPromises()
    expect(features.error).toBeTruthy()
    expect(features.ready).toBe(false)
    expect(features.attachmentsEnabled).toBe(false)
    expect(features.growthGuideMode).toBe('deepseek')
    await view.get('[aria-label="关闭成长助手问答"]').trigger('click')
    await view.get('[aria-label="打开成长助手问答"]').trigger('click')
    await flushPromises()
    expect(request).toHaveBeenCalledTimes(3)
    expect(features.error).toBe('')
    expect(features.ready).toBe(true)
    expect(features.attachmentsEnabled).toBe(true)
  })

  it('does not duplicate the identity read when the drawer opens before it finishes', async () => {
    let resolve!: (response: Response) => void
    const request = vi.fn<typeof fetch>(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    vi.stubGlobal('fetch', request)
    const view = render()
    useAuthStore().user = { id: 'admin', email: null, display_name: '管理员', is_active: true }
    await view.get('[aria-label="打开成长助手问答"]').trigger('click')
    expect(request).toHaveBeenCalledTimes(1)
    resolve(json(enabled))
    await flushPromises()
    expect(useFeatureStore().attachmentsEnabled).toBe(true)
  })

  it('does not load organization scope during login identity hydration', async () => {
    routing.current.fullPath = '/login'
    const access = useAccessStore()
    access.ready = false
    access.organizationId = ''
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(json(enabled)))
    render()
    useAuthStore().user = { id: 'learner', email: null, display_name: '学员', is_active: true }
    await flushPromises()
    expect(useFeatureStore().ready).toBe(true)
    expect(access.load).not.toHaveBeenCalled()
    expect(access.organizationId).toBe('')
  })

  it('resolves missing scope before opening and stays open after the initial organization change', async () => {
    useAuthStore().user = { id: 'learner', email: null, display_name: '学员', is_active: true }
    const access = useAccessStore()
    access.ready = false
    access.organizationId = ''
    let resolve!: () => void
    vi.mocked(access.load).mockImplementation(
      () =>
        new Promise<void>((done) => {
          resolve = () => {
            access.organizationId = 'org-initial'
            access.ready = true
            done()
          }
        }),
    )
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(json(enabled)))
    const view = render()
    await flushPromises()
    expect(access.load).not.toHaveBeenCalled()
    await view.get('[aria-label="打开成长助手问答"]').trigger('click')
    expect(access.load).toHaveBeenCalledTimes(1)
    expect((view.get('dialog').element as HTMLDialogElement).open).toBe(false)
    resolve()
    await flushPromises()
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledTimes(1)
    expect(HTMLDialogElement.prototype.close).not.toHaveBeenCalled()
    expect(view.get('[aria-label="打开成长助手问答"]').attributes('aria-expanded')).toBe('true')
    expect(document.body.style.overflow).toBe('hidden')
  })

  it.each(['identity', 'route'])(
    'does not open after %s changes while scope is loading',
    async (change) => {
      const auth = useAuthStore()
      auth.user = { id: 'learner', email: null, display_name: '学员', is_active: true }
      const access = useAccessStore()
      access.ready = false
      let resolve!: () => void
      vi.mocked(access.load).mockImplementation(
        () =>
          new Promise<void>((done) => {
            resolve = done
          }),
      )
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>().mockImplementation(async () => json(enabled)),
      )
      const view = render()
      await view.get('[aria-label="打开成长助手问答"]').trigger('click')
      if (change === 'identity') {
        auth.user = { id: 'admin', email: null, display_name: '管理员', is_active: true }
      } else routing.current.fullPath = '/help'
      resolve()
      await flushPromises()
      expect((view.get('dialog').element as HTMLDialogElement).open).toBe(false)
      expect(document.body.style.overflow).toBe('')
    },
  )
})
