import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RegisterView from '../views/RegisterView.vue'
import { useAuthStore } from '../stores/auth'

const samplePassword = 'x'.repeat(12)
async function render(query = '') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/register', name: 'register', component: RegisterView },
      { path: '/login', name: 'login', component: { template: '<div>登录</div>' } },
    ],
  })
  await router.push(`/register${query}`)
  const wrapper = mount(RegisterView, { global: { plugins: [router] } })
  return { wrapper, router }
}
async function fill(wrapper: Awaited<ReturnType<typeof render>>['wrapper']) {
  await wrapper.get('#register-username').setValue('Learner.Demo')
  await wrapper.get('#register-display-name').setValue('测评学员')
  await wrapper.get('#register-password').setValue(samplePassword)
  await wrapper.get('#register-confirm').setValue(samplePassword)
}

describe('RegisterView', () => {
  beforeEach(() => {
    sessionStorage.clear()
    setActivePinia(createPinia())
    vi.stubGlobal('fetch', vi.fn<typeof fetch>())
  })
  afterEach(() => vi.unstubAllGlobals())

  it('creates a learner without requiring email and returns to login without authenticating', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'user-1',
          username: 'learner.demo',
          email: null,
          display_name: '测评学员',
          is_active: true,
        }),
        { status: 201 },
      ),
    )
    const { wrapper, router } = await render('?redirect=/reports')
    await fill(wrapper)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string)).toEqual({
      username: 'learner.demo',
      password: samplePassword,
      display_name: '测评学员',
    })
    expect(router.currentRoute.value.path).toBe('/login')
    expect(router.currentRoute.value.query).toEqual({
      registered: '1',
      account: 'learner.demo',
      redirect: '/reports',
    })
    expect(useAuthStore().isAuthenticated).toBe(false)
    expect(sessionStorage.getItem('zhijian-auth-session')).toBeNull()
  })

  it('validates username and confirmation before contacting the server', async () => {
    const { wrapper } = await render()
    await fill(wrapper)
    await wrapper.get('#register-username').setValue('1bad')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('[role=alert]').text()).toContain('用户名')
    await wrapper.get('#register-username').setValue('learner.demo')
    await wrapper.get('#register-confirm').setValue('y'.repeat(12))
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('[role=alert]').text()).toContain('两次密码')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('toggles the two password fields independently without submitting or changing values', async () => {
    const { wrapper } = await render()
    await fill(wrapper)
    await wrapper.get('button[aria-label="显示密码"]').trigger('click')
    expect(wrapper.get('#register-password').attributes('type')).toBe('text')
    expect(wrapper.get('#register-confirm').attributes('type')).toBe('password')
    expect(wrapper.get('button[aria-label="隐藏密码"]').attributes('aria-pressed')).toBe('true')
    await wrapper.get('button[aria-label="显示确认密码"]').trigger('click')
    await wrapper.get('button[aria-label="隐藏密码"]').trigger('click')
    expect(wrapper.get('#register-password').attributes('type')).toBe('password')
    expect(wrapper.get('#register-confirm').attributes('type')).toBe('text')
    expect((wrapper.get('#register-password').element as HTMLInputElement).value).toBe(
      samplePassword,
    )
    expect((wrapper.get('#register-confirm').element as HTMLInputElement).value).toBe(
      samplePassword,
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  it('associates validation feedback with the actual invalid field', async () => {
    const { wrapper } = await render()
    await fill(wrapper)
    await wrapper.get('#register-display-name').setValue(' ')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('#register-display-name').attributes('aria-invalid')).toBe('true')
    expect(wrapper.get('#register-display-name').attributes('aria-describedby')).toContain(
      'registration-error',
    )
    expect(wrapper.get('#register-username').attributes('aria-invalid')).toBe('false')
    await wrapper.get('#register-display-name').setValue('学习者')
    await wrapper.get('#register-password').setValue('short')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('#register-display-name').attributes('aria-invalid')).toBe('false')
    expect(wrapper.get('#register-password').attributes('aria-invalid')).toBe('true')
    expect(wrapper.get('[role=alert]').text()).toContain('8–256')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('explains network failure in Chinese and preserves input for a deliberate retry', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const { wrapper, router } = await render()
    await fill(wrapper)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role=alert]').text()).toContain('暂时无法连接注册服务')
    expect(wrapper.get('[role=alert]').text()).not.toContain('Failed to fetch')
    expect(wrapper.get('button[type=submit]').attributes('disabled')).toBeUndefined()
    expect((wrapper.get('#register-password').element as HTMLInputElement).value).toBe(
      samplePassword,
    )
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ username: 'learner.demo' }), { status: 201 }),
    )
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(router.currentRoute.value.path).toBe('/login')
  })

  it('never creates the account twice if navigation fails after a successful registration', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ username: 'learner.demo' }), { status: 201 }),
    )
    const { wrapper, router } = await render('?redirect=/reports')
    await fill(wrapper)
    vi.spyOn(router, 'replace').mockRejectedValueOnce(new Error('Navigation unavailable'))
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role=alert]').text()).toContain('账号已创建')
    expect(wrapper.get('button[type=submit]').attributes('disabled')).toBeDefined()
    expect((wrapper.get('#register-password').element as HTMLInputElement).value).toBe('')
    expect((wrapper.get('#register-confirm').element as HTMLInputElement).value).toBe('')
    expect(wrapper.get('.registration-login a').attributes('href')).toContain(
      'account=learner.demo',
    )
    await wrapper.get('form').trigger('submit')
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('preserves password spaces and validates optional email and maximum lengths', async () => {
    const { wrapper } = await render()
    await fill(wrapper)
    await wrapper.get('#register-email').setValue('invalid')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('[role=alert]').text()).toContain('邮箱')
    expect(fetch).not.toHaveBeenCalled()
    await wrapper.get('#register-email').setValue('optional@example.test')
    await wrapper.get('#register-password').setValue('x'.repeat(257))
    await wrapper.get('#register-confirm').setValue('x'.repeat(257))
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('[role=alert]').text()).toContain('8–256')
    expect(fetch).not.toHaveBeenCalled()
    const spacedPassword = ` ${samplePassword} `
    await wrapper.get('#register-password').setValue(spacedPassword)
    await wrapper.get('#register-confirm').setValue(spacedPassword)
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ username: 'learner.demo' }), { status: 201 }),
    )
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string)).toMatchObject({
      password: spacedPassword,
      email: 'optional@example.test',
    })
  })

  it('prevents duplicate in-flight submission and keeps a conflict actionable', async () => {
    let finish!: (value: Response) => void
    vi.mocked(fetch).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const { wrapper, router } = await render('?redirect=//external.example')
    await fill(wrapper)
    await wrapper.get('form').trigger('submit')
    await wrapper.get('form').trigger('submit')
    expect(fetch).toHaveBeenCalledOnce()
    expect(wrapper.get('button[type=submit]').attributes('disabled')).toBeDefined()
    finish(
      new Response(JSON.stringify({ detail: 'Username or email already exists' }), { status: 409 }),
    )
    await flushPromises()
    expect(wrapper.get('[role=alert]').text()).toContain('已被使用')
    expect(router.currentRoute.value.path).toBe('/register')
    expect(wrapper.get('a[href^="/login"]').attributes('href')).toContain('redirect=/workspace')
    expect(useAuthStore().isAuthenticated).toBe(false)
  })

  it.each([
    [429, '过于频繁'],
    [503, '暂不可用'],
  ])('shows a recoverable message for status %i', async (status, message) => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: Number(status) }))
    const { wrapper, router } = await render()
    await fill(wrapper)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role=alert]').text()).toContain(message)
    expect(wrapper.get('button[type=submit]').attributes('disabled')).toBeUndefined()
    expect(router.currentRoute.value.path).toBe('/register')
  })

  it('accepts Unicode names and passwords by code point without browser UTF-16 truncation', async () => {
    const { wrapper } = await render()
    await fill(wrapper)
    const displayName = '测'.repeat(79) + String.fromCodePoint(0x1f331)
    const unicodePassword = String.fromCodePoint(0x1f331).repeat(200)
    expect(wrapper.get('#register-display-name').attributes('maxlength')).toBeUndefined()
    expect(wrapper.get('#register-password').attributes('maxlength')).toBeUndefined()
    expect(wrapper.get('#register-confirm').attributes('maxlength')).toBeUndefined()
    await wrapper.get('#register-display-name').setValue(displayName)
    await wrapper.get('#register-password').setValue(unicodePassword)
    await wrapper.get('#register-confirm').setValue(unicodePassword)
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ username: 'learner.demo' }), { status: 201 }),
    )
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string)).toMatchObject({
      display_name: displayName,
      password: unicodePassword,
    })
  })
})
