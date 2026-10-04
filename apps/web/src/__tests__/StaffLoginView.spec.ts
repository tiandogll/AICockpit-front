import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LoginView from '../views/LoginView.vue'
import { useAuthStore } from '../stores/auth'
import { useAccessStore } from '../stores/access'

const user = {
  id: 'user-1',
  username: 'admin',
  email: null,
  display_name: '当前账号',
  is_active: true,
}
const personal = {
  id: 'personal',
  name: '个人空间',
  role: 'learner',
  capabilities: ['pilot_participate'],
}
const teacher = {
  id: 'school',
  name: '学校',
  role: 'evaluator',
  capabilities: ['analytics', 'reviews'],
}
const accessData = { organizations: [personal], global_capabilities: [] as string[] }
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
const wrappers: VueWrapper[] = []

function respondWithAccess(data = accessData) {
  const request = vi.fn<typeof fetch>().mockImplementation(async (input) => {
    const path = new URL(String(input)).pathname
    if (path.endsWith('/auth/login'))
      return json({ access_token: 'token', refresh_token: 'refresh', token_type: 'bearer' })
    if (path.endsWith('/auth/me')) return json(user)
    if (path.endsWith('/workspace/access')) return json(data)
    if (path.endsWith('/auth/logout')) return new Response(null, { status: 204 })
    throw new Error(`Unexpected endpoint: ${path}`)
  })
  vi.stubGlobal('fetch', request)
  return request
}
function signedIn() {
  const auth = useAuthStore()
  auth.accessToken = 'token'
  auth.refreshToken = 'refresh'
  auth.user = user
}
async function render(path = '/staff/login') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/login', name: 'login', component: LoginView },
      { path: '/staff/login', name: 'staff-login', component: LoginView },
      { path: '/register', name: 'register', component: { template: '<div />' } },
      ...[
        '/workspace',
        '/teaching',
        '/item-bank',
        '/analytics',
        '/reviews',
        '/members',
        '/system',
      ].map((path) => ({ path, component: { template: '<div>目标页面</div>' } })),
    ],
  })
  await router.push(path)
  const wrapper = mount(LoginView, { global: { plugins: [router] } })
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, router }
}
async function submit(wrapper: VueWrapper) {
  await wrapper.get('#login-identifier').setValue('admin')
  await wrapper.get('#login-password').setValue('safe-test-password')
  await wrapper.get('form').trigger('submit')
  await flushPromises()
}

describe('staff login entrance', () => {
  beforeEach(() => {
    sessionStorage.clear()
    setActivePinia(createPinia())
    respondWithAccess()
  })
  afterEach(() => {
    wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })
  it('clearly separates entrances and does not offer self-registration as a teacher', async () => {
    const { wrapper } = await render('/staff/login?redirect=/item-bank')
    expect(wrapper.get('h2').text()).toBe('欢迎回来')
    expect(wrapper.text()).toContain('登录，进入教师管理工作台')
    expect(wrapper.text()).toContain('需要管理权限？请联系平台负责人')
    expect(wrapper.get('button[type="submit"]').text()).toBe('登录教师管理端')
    expect(wrapper.get('[data-testid="staff-login-tab"]').text()).toBe('教师管理端')
    expect(wrapper.find('a[href^="/register"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="student-login-tab"]').attributes('href')).toContain(
      '/login?redirect=/item-bank',
    )
    expect(wrapper.get('[data-testid="staff-login-tab"]').attributes('aria-current')).toBe('page')
  })
  it('retains the student login and safe management destination when switching entrances', async () => {
    const { wrapper } = await render('/login?redirect=/item-bank')
    expect(wrapper.get('h2').text()).toBe('欢迎回来')
    expect(wrapper.text()).toContain('登录，继续你的能力成长之旅')
    expect(wrapper.get('button[type="submit"]').text()).toBe('登录并继续测评')
    expect(wrapper.get('[data-testid="student-login-tab"]').text()).toBe('学员端')
    expect(wrapper.get('[data-testid="staff-login-tab"]').attributes('href')).toContain(
      '/staff/login?redirect=/item-bank',
    )
    expect(wrapper.get('a[href^="/register"]').text()).toContain('注册学员账号')
  })
  it('checks real server capabilities after login and lands a system admin on the requested item bank', async () => {
    const request = respondWithAccess({
      ...accessData,
      global_capabilities: ['content', 'cat', 'system'],
    })
    const { wrapper, router } = await render('/staff/login?redirect=/item-bank?state=draft')
    await submit(wrapper)
    expect(router.currentRoute.value.fullPath).toBe('/item-bank?state=draft')
    expect(JSON.parse(String(request.mock.calls[0]![1]?.body))).toEqual({
      identifier: 'admin',
      password: 'safe-test-password',
    })
    expect(request.mock.calls.some(([url]) => String(url).endsWith('/workspace/access'))).toBe(true)
  })
  it('selects the teacher organization instead of treating its personal learner membership as a denial', async () => {
    respondWithAccess({ organizations: [personal, teacher], global_capabilities: [] })
    const { wrapper, router } = await render('/staff/login?redirect=/reviews')
    await submit(wrapper)
    expect(router.currentRoute.value.path).toBe('/reviews')
    expect(useAccessStore().organizationId).toBe('school')
  })
  it.each([
    { global_capabilities: ['content', 'system'], organizations: [personal] },
    { global_capabilities: ['content_author'], organizations: [personal, teacher] },
  ])('uses the same management home for both staff account types', async (data) => {
    respondWithAccess(data)
    const { wrapper, router } = await render('/staff/login')
    await submit(wrapper)
    expect(router.currentRoute.value.path).toBe('/teaching')
  })
  it('lets an authenticated learner inspect the staff entrance without promotion or a false credential error', async () => {
    signedIn()
    const { wrapper, router } = await render()
    expect(router.currentRoute.value.path).toBe('/staff/login')
    expect(wrapper.text()).toContain('当前账号没有教师管理端权限')
    expect(wrapper.text()).not.toContain('密码不正确')
    expect(wrapper.find('#login-password').exists()).toBe(false)
    expect(useAccessStore().globalCapabilities).toEqual([])
    expect(wrapper.get('[data-testid="return-student"]').attributes('href')).toBe('/workspace')
    expect(wrapper.get('[data-testid="return-student"]').text()).toBe('返回学员工作台')
  })
  it('keeps a newly authenticated learner at the permission message and can switch accounts', async () => {
    const { wrapper, router } = await render()
    await submit(wrapper)
    expect(router.currentRoute.value.path).toBe('/staff/login')
    expect(wrapper.text()).toContain('当前账号没有教师管理端权限')
    await wrapper.get('[data-testid="switch-login-account"]').trigger('click')
    await flushPromises()
    expect(useAuthStore().isAuthenticated).toBe(false)
    expect(wrapper.get<HTMLInputElement>('#login-password').element.value).toBe('')
    expect(wrapper.get<HTMLInputElement>('#login-identifier').element.value).toBe('')
  })
  it('fails closed on access failure and can retry checking permissions without logging in again', async () => {
    signedIn()
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ detail: '权限服务暂不可用' }, 503))
      .mockResolvedValueOnce(json({ ...accessData, global_capabilities: ['content'] }))
    vi.stubGlobal('fetch', request)
    const { wrapper, router } = await render()
    expect(wrapper.get('[role="alert"]').text()).toContain('权限服务暂不可用')
    expect(router.currentRoute.value.path).toBe('/staff/login')
    await wrapper.get('[data-testid="retry-staff-access"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/teaching')
    expect(request.mock.calls.every(([url]) => String(url).endsWith('/workspace/access'))).toBe(
      true,
    )
  })
  it('discards a late capability response after the login component is unmounted', async () => {
    signedIn()
    let finish!: (value: Response) => void
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(() => new Promise((resolve) => (finish = resolve))),
    )
    const { wrapper, router } = await render()
    const replace = vi.spyOn(router, 'replace')
    wrapper.unmount()
    finish(json({ ...accessData, global_capabilities: ['content'] }))
    await flushPromises()
    expect(replace).not.toHaveBeenCalled()
  })
})
