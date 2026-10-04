import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MeasureShell from '../layouts/MeasureShell.vue'
import { useAccessStore } from '../stores/access'
import { useAuthStore } from '../stores/auth'

const wrappers: ReturnType<typeof mount>[] = []
beforeEach(() => {
  sessionStorage.clear()
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(async () => new Response('{}')),
  )
})
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  vi.unstubAllGlobals()
})
async function render(path: string, authenticated: boolean) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const auth = useAuthStore()
  if (authenticated) {
    auth.accessToken = 'synthetic-token'
    auth.refreshToken = 'synthetic-refresh'
    auth.user = {
      id: 'learner',
      username: 'synthetic-account',
      email: null,
      display_name: '合成学员',
      is_active: true,
    }
  }
  useAccessStore().ready = true
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/login',
        name: 'login',
        component: { template: '<p>学员登录表单<input data-testid="route-draft" /></p>' },
      },
      {
        path: '/staff/login',
        name: 'staff-login',
        component: { template: '<p>教师管理员登录表单<input data-testid="route-draft" /></p>' },
      },
      {
        path: '/register',
        name: 'register',
        component: { template: '<p>注册表单<input data-testid="route-draft" /></p>' },
      },
      {
        path: '/workspace',
        name: 'workspace',
        component: { template: '<p>工作台内容<input data-testid="route-draft" /></p>' },
      },
      { path: '/:pathMatch(.*)*', component: { template: '<div />' } },
    ],
  })
  await router.push(path)
  const wrapper = mount(MeasureShell, {
    global: { plugins: [pinia, router], stubs: { NavigationMenu: true, BrandMark: true } },
  })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}
describe('authentication page shell', () => {
  it('removes organization selection in single-platform mode', async () => {
    const wrapper = await render('/workspace', true)
    const access = useAccessStore()
    access.singlePlatform = true
    access.organizations = ['platform', 'legacy'].map((id) => ({ id, name: id, role: 'learner', capabilities: [] }))
    access.organizationId = 'platform'
    await flushPromises()
    expect(wrapper.find('select[aria-label="当前组织"]').exists()).toBe(false)
  })
  it('limits registration branding to registration and preserves the normal login shell', async () => {
    const registration = await render('/register', false)
    expect(registration.get('.measure-app').classes()).toContain('registration-design')
    expect(registration.get('.public-toolbar .primary-button').text()).toBe('已有账号？登录')
    expect(registration.get('.public-toolbar .primary-button').attributes('href')).toBe('/login')
    const login = await render('/login', false)
    expect(login.get('.measure-app').classes()).not.toContain('registration-design')
    expect(login.get('.public-toolbar .primary-button').text()).toBe('登录测评')
  })
  it('preserves the assessment destination when using the registration header login link', async () => {
    const wrapper = await render('/register?redirect=/assessment?mode=standard', false)
    const login = wrapper.get('.public-toolbar .primary-button')
    expect(login.text()).toBe('已有账号？登录')
    await login.trigger('click')
    await flushPromises()
    expect(wrapper.vm.$route.path).toBe('/login')
    expect(wrapper.vm.$route.query).toEqual({ redirect: '/assessment?mode=standard' })
  })
  it.each([
    '//evil.example/steal',
    'https://evil.example/steal',
    '/\\evil.example/steal',
    '/%2F%2Fevil.example/steal',
    '/login',
    '/register',
    '/staff/login',
  ])('filters unsafe registration header redirects: %s', async (redirect) => {
    const wrapper = await render(`/register?redirect=${encodeURIComponent(redirect)}`, false)
    await wrapper.get('.public-toolbar .primary-button').trigger('click')
    await flushPromises()
    expect(wrapper.vm.$route.path).toBe('/login')
    expect(wrapper.vm.$route.query).toEqual({ redirect: '/workspace' })
  })
  it('rejects ambiguous registration redirects instead of choosing an arbitrary destination', async () => {
    const wrapper = await render('/register?redirect=/assessment&redirect=//evil.example', false)
    await wrapper.get('.public-toolbar .primary-button').trigger('click')
    await flushPromises()
    expect(wrapper.vm.$route.query).toEqual({ redirect: '/workspace' })
  })
  it('keeps the authenticated registration header link pointed at the workspace', async () => {
    const wrapper = await render('/register?redirect=/assessment?mode=standard', true)
    expect(wrapper.get('.public-toolbar .primary-button').text()).toBe('进入工作台')
    expect(wrapper.get('.public-toolbar .primary-button').attributes('href')).toBe('/workspace')
  })
  it('preserves the existing staff login header destination', async () => {
    const wrapper = await render('/staff/login?redirect=/item-bank', false)
    expect(wrapper.get('.public-toolbar .primary-button').text()).toBe('登录测评')
    expect(wrapper.get('.public-toolbar .primary-button').attributes('href')).toBe('/login')
  })
  it.each(['/login', '/staff/login', '/register'])(
    'keeps %s mounted while login resolves organization scope',
    async (path) => {
      const wrapper = await render(path, true)
      const input = wrapper.get('[data-testid="route-draft"]').element as HTMLInputElement
      input.value = 'preserve-pending-form'
      const access = useAccessStore()
      access.organizationId = 'organization-after-login'
      await flushPromises()
      expect(wrapper.get('[data-testid="route-draft"]').element).toBe(input)
      expect(input.value).toBe('preserve-pending-form')
    },
  )

  it('still remounts authenticated organization-scoped pages when switching organizations', async () => {
    const wrapper = await render('/workspace', true)
    const access = useAccessStore()
    access.organizations = ['one', 'two'].map((id) => ({
      id,
      name: id,
      role: 'learner',
      capabilities: [],
      can_participate_assessment: true,
    }))
    access.organizationId = 'one'
    await flushPromises()
    const input = wrapper.get('[data-testid="route-draft"]').element
    access.organizationId = 'two'
    await flushPromises()
    expect(wrapper.get('[data-testid="route-draft"]').element).not.toBe(input)
  })
  it.each([
    { path: '/staff/login', authenticated: true },
    { path: '/staff/login', authenticated: false },
    { path: '/login', authenticated: true },
    { path: '/login', authenticated: false },
    { path: '/register', authenticated: true },
  ])(
    'uses the public login shell at $path when authenticated=$authenticated',
    async ({ path, authenticated }) => {
      const wrapper = await render(path, authenticated)
      expect(wrapper.get('.measure-app').classes()).not.toContain('app-layout')
      expect(wrapper.find('.measure-sidebar').exists()).toBe(false)
      expect(wrapper.find('.measure-toolbar').exists()).toBe(false)
      expect(wrapper.find('.public-toolbar').exists()).toBe(true)
      expect(wrapper.get('.measure-app').classes()).toContain('public-design')
      expect(wrapper.find('.public-toolbar a[href="/staff/login"]').exists()).toBe(false)
      expect(wrapper.find('.public-footer').exists()).toBe(true)
      expect(wrapper.get('#page-content').text()).toContain('表单')
    },
  )
  it('retains the authenticated workspace layout on actual workspace routes', async () => {
    const wrapper = await render('/workspace', true)
    expect(wrapper.get('.measure-app').classes()).toContain('app-layout')
    expect(wrapper.find('.measure-sidebar').exists()).toBe(true)
    expect(wrapper.find('.public-toolbar').exists()).toBe(false)
  })
  it('selects a real membership on personal pages without removing administrative scopes', async () => {
    const wrapper = await render('/workspace', true)
    const access = useAccessStore()
    access.organizations = [
      {
        id: 'managed',
        name: '可管理但非成员',
        role: 'system_admin',
        capabilities: ['members'],
        can_participate_assessment: false,
      },
      {
        id: 'personal',
        name: '本人的学习空间',
        role: 'system_admin',
        capabilities: ['members'],
        can_participate_assessment: true,
      },
    ]
    access.organizationId = 'managed'
    access.ready = true
    await flushPromises()
    expect(access.organizationId).toBe('personal')
    expect(access.organizations).toHaveLength(2)
    expect(wrapper.find('select[aria-label="当前组织"]').exists()).toBe(false)
    expect(access.can('members')).toBe(true)
  })
})
