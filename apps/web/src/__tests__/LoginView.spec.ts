import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import LoginView from '../views/LoginView.vue'
import { safeRedirect } from '../router'

describe('LoginView', () => {
  beforeEach(() => {
    sessionStorage.clear()
    setActivePinia(createPinia())
  })

  it('accepts only local redirect targets', () => {
    expect(safeRedirect('/assessment/session-1?resume=1')).toBe('/assessment/session-1?resume=1')
    expect(safeRedirect('//evil.example/steal')).toBe('/workspace')
    expect(safeRedirect('https://evil.example/steal')).toBe('/workspace')
    expect(safeRedirect('/login')).toBe('/workspace')
    expect(safeRedirect('/login#form')).toBe('/workspace')
    expect(safeRedirect('/login/')).toBe('/workspace')
    expect(safeRedirect('/register?redirect=/login')).toBe('/workspace')
    expect(safeRedirect('/register/#form')).toBe('/workspace')
    expect(safeRedirect('/%72egister')).toBe('/workspace')
  })

  it('logs in and returns the learner to the requested assessment', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/login', name: 'login', component: LoginView },
        { path: '/register', name: 'register', component: { template: '<div />' } },
        { path: '/assessment/:sessionId', component: { template: '<div>测评运行器</div>' } },
      ],
    })
    await router.push('/login?redirect=/assessment/session-1')
    await router.isReady()
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: 'access',
              refresh_token: 'refresh',
              token_type: 'bearer',
            }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              id: 'user-1',
              email: 'learner@example.test',
              display_name: '测评学员',
              is_active: true,
            }),
            { status: 200 },
          ),
        ),
    )
    const wrapper = mount(LoginView, { global: { plugins: [router] } })

    await wrapper.get('input[autocomplete=username]').setValue('learner.demo')
    await wrapper.get('input[type=password]').setValue('secure-password')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(router.currentRoute.value.fullPath).toBe('/assessment/session-1')
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string)).toMatchObject({
      identifier: 'learner.demo',
    })
    expect(wrapper.text()).not.toContain('邮箱或密码不正确')
    vi.unstubAllGlobals()
  })

  it('shows registration success and prefills only the username', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/login', name: 'login', component: LoginView },
        { path: '/register', name: 'register', component: { template: '<div />' } },
      ],
    })
    await router.push('/login?registered=1&account=learner.demo&redirect=/reports')
    const wrapper = mount(LoginView, { global: { plugins: [router] } })
    expect(wrapper.get('[role=status]').text()).toContain('注册成功')
    expect((wrapper.get('input[autocomplete=username]').element as HTMLInputElement).value).toBe(
      'learner.demo',
    )
    expect((wrapper.get('input[type=password]').element as HTMLInputElement).value).toBe('')
    expect(wrapper.get('input[autocomplete=username]').attributes('type')).toBe('text')
    expect(wrapper.get('a[href^="/register"]').attributes('href')).toContain('redirect=/reports')
  })

  it.each(['/login', '/staff/login'])(
    'shows a password-change success notice at %s without prefilling secrets',
    async (path) => {
      const router = createRouter({
        history: createMemoryHistory(),
        routes: [
          { path: '/login', name: 'login', component: LoginView },
          { path: '/staff/login', name: 'staff-login', component: LoginView },
          { path: '/register', name: 'register', component: { template: '<div />' } },
        ],
      })
      await router.push(`${path}?password_changed=1`)
      const wrapper = mount(LoginView, { global: { plugins: [router] } })
      expect(wrapper.get('[role=status]').text()).toContain('原有登录会话已失效')
      expect((wrapper.get('#login-password').element as HTMLInputElement).value).toBe('')
      wrapper.unmount()
    },
  )

  it('does not send duplicate login requests while identity verification is pending', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/login', name: 'login', component: LoginView },
        { path: '/register', name: 'register', component: { template: '<div />' } },
      ],
    })
    await router.push('/login')
    let finish!: (value: Response) => void
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockReturnValue(
        new Promise((resolve) => {
          finish = resolve
        }),
      ),
    )
    const wrapper = mount(LoginView, { global: { plugins: [router] } })
    await wrapper.get('#login-identifier').setValue('learner.demo')
    await wrapper.get('#login-password').setValue('x'.repeat(12))
    await wrapper.get('form').trigger('submit')
    await wrapper.get('form').trigger('submit')
    expect(fetch).toHaveBeenCalledOnce()
    finish(new Response(null, { status: 401 }))
    await flushPromises()
    expect(wrapper.get('[role=alert]').text()).toContain('用户名、邮箱或密码不正确')
    expect(wrapper.get('button[type=submit]').attributes('disabled')).toBeUndefined()
    vi.unstubAllGlobals()
  })

  it('preserves legacy login identifiers up to 320 characters without truncation', async () => {
    const identifier = `${'a'.repeat(307)}@example.test`
    expect(identifier).toHaveLength(320)
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/login', name: 'login', component: LoginView },
        { path: '/register', name: 'register', component: { template: '<div />' } },
      ],
    })
    await router.push({ path: '/login', query: { account: identifier } })
    const wrapper = mount(LoginView, { global: { plugins: [router] } })
    const field = wrapper.get('#login-identifier')
    expect((field.element as HTMLInputElement).value).toBe(identifier)
    expect(field.attributes('maxlength')).toBe('320')
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 })),
    )
    await wrapper.get('#login-password').setValue('x'.repeat(12))
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string).identifier).toBe(
      identifier,
    )
    vi.unstubAllGlobals()
  })

  it('accepts a password with 200 non-BMP code points without a UTF-16 input limit', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/login', name: 'login', component: LoginView },
        { path: '/register', name: 'register', component: { template: '<div />' } },
      ],
    })
    await router.push('/login')
    const wrapper = mount(LoginView, { global: { plugins: [router] } })
    const unicodePassword = String.fromCodePoint(0x1f331).repeat(200)
    expect(wrapper.get('#login-password').attributes('maxlength')).toBeUndefined()
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 })),
    )
    await wrapper.get('#login-identifier').setValue('learner.demo')
    await wrapper.get('#login-password').setValue(unicodePassword)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string).password).toBe(
      unicodePassword,
    )
    vi.unstubAllGlobals()
  })

  it('accepts the configured seven-character local learner password without weakening registration', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/login', name: 'login', component: LoginView },
        { path: '/register', name: 'register', component: { template: '<div />' } },
      ],
    })
    await router.push('/login')
    const wrapper = mount(LoginView, { global: { plugins: [router] } })
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 })),
    )
    await wrapper.get('#login-identifier').setValue('user')
    await wrapper.get('#login-password').setValue('demo123')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string)).toMatchObject({
      identifier: 'user',
      password: 'demo123',
    })
    expect(wrapper.get('#login-password').attributes('minlength')).toBeUndefined()
    expect(wrapper.text()).toContain('登录，继续你的能力成长之旅')
    expect(wrapper.find('.portal-boundary').exists()).toBe(false)
    expect(wrapper.find('.credential-mark').exists()).toBe(false)
    vi.unstubAllGlobals()
  })
})
