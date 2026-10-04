import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PasswordChangeForm from '../components/PasswordChangeForm.vue'
import { useAuthStore } from '../stores/auth'
import { useAccessStore } from '../stores/access'
import { registerAssessmentLeave } from '../domain/assessmentLeave'

const wrappers: ReturnType<typeof mount>[] = []
const unregister: Array<() => void> = []
beforeEach(() => {
  sessionStorage.clear()
  setActivePinia(createPinia())
})
afterEach(() => {
  wrappers.splice(0).forEach((w) => w.unmount())
  unregister.splice(0).forEach((fn) => fn())
  vi.restoreAllMocks()
})

async function render(path = '/workspace') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/workspace', component: { template: '<div />' } },
      { path: '/teaching', component: { template: '<div />' } },
      { path: '/authoring', component: { template: '<div />' } },
      { path: '/item-bank', component: { template: '<div />' } },
      { path: '/content-trials/:trialId?', component: { template: '<div />' } },
      { path: '/login', name: 'login', component: { template: '<div />' } },
      { path: '/staff/login', name: 'staff-login', component: { template: '<div />' } },
    ],
  })
  await router.push(path)
  const auth = useAuthStore()
  auth.user = {
    id: 'fixture',
    username: 'demo',
    email: null,
    display_name: '学员',
    is_active: true,
    password_change_available: true,
  }
  auth.accessToken = 'access'
  auth.refreshToken = 'refresh'
  const access = useAccessStore()
  access.ready = true
  const wrapper = mount(PasswordChangeForm, { global: { plugins: [router] } })
  wrappers.push(wrapper)
  return { wrapper, auth, router }
}

async function fill(
  wrapper: ReturnType<typeof mount>,
  current = 'old1234',
  next = 'new-password',
  confirm = next,
) {
  await wrapper.get('[name=current_password]').setValue(current)
  await wrapper.get('[name=new_password]').setValue(next)
  await wrapper.get('[name=confirm_password]').setValue(confirm)
}

describe('account security password form', () => {
  it.each([
    '/authoring',
    '/item-bank',
    '/content-trials',
    '/content-trials/fixture',
    '/Authoring',
    '/ITEM-BANK',
    '/Content-Trials/fixture',
  ])(
    'requires leaving the editor through its own guard before changing credentials at %s',
    async (path) => {
      const { wrapper, auth } = await render(path)
      const change = vi.spyOn(auth, 'changePassword').mockResolvedValue()
      expect(wrapper.get('[role=status]').text()).toContain('请先保存或退出当前编辑并返回工作台')
      expect(wrapper.find('form').exists()).toBe(false)
      expect(wrapper.find('button[type=submit]').exists()).toBe(false)
      expect(change).not.toHaveBeenCalled()
      expect(auth.user?.id).toBe('fixture')
      expect(auth.isAuthenticated).toBe(true)
    },
  )
  it.each([undefined, false])(
    'offers no password inputs or submit action on an old API (%s)',
    async (available) => {
      const { wrapper, auth } = await render()
      auth.user!.password_change_available = available
      await flushPromises()
      expect(wrapper.get('[role=status]').text()).toContain('当前服务尚未开放修改密码')
      expect(wrapper.find('input').exists()).toBe(false)
      expect(wrapper.find('button[type=submit]').exists()).toBe(false)
    },
  )
  it.each([
    ['', 'new-password', 'new-password', '当前密码'],
    ['old1234', 'short', 'short', '8–256'],
    ['old1234', 'new-password', 'different', '不一致'],
    ['old-password', 'old-password', 'old-password', '不能与当前密码相同'],
    ['x'.repeat(257), 'new-password', 'new-password', '当前密码'],
    ['old1234', 'x'.repeat(257), 'x'.repeat(257), '8–256'],
  ])('validates before calling the leave guard or API', async (current, next, confirm, message) => {
    const { wrapper, auth } = await render()
    const leave = vi.fn().mockResolvedValue(true)
    unregister.push(registerAssessmentLeave(leave))
    const change = vi.spyOn(auth, 'changePassword').mockResolvedValue()
    await fill(wrapper, current, next, confirm)
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('[role=alert]').text()).toContain(message)
    expect(change).not.toHaveBeenCalled()
    expect(leave).not.toHaveBeenCalled()
  })

  it.each([
    ['/workspace', '/login'],
    ['/teaching', '/staff/login'],
    ['/Teaching', '/staff/login'],
  ])(
    'changes from %s and redirects to the right login with a success notice',
    async (path, login) => {
      const { wrapper, auth, router } = await render(path)
      const password = ` ${String.fromCodePoint(0x1f331).repeat(8)} `
      const change = vi.spyOn(auth, 'changePassword').mockImplementation(async () => {
        auth.accessToken = ''
        auth.refreshToken = ''
        auth.user = null
      })
      await fill(wrapper, 'old1234', password)
      await wrapper.get('form').trigger('submit')
      await flushPromises()
      expect(change).toHaveBeenCalledExactlyOnceWith({
        current_password: 'old1234',
        new_password: password,
        confirm_password: password,
      })
      expect(router.currentRoute.value.path).toBe(login)
      expect(router.currentRoute.value.query.password_changed).toBe('1')
      expect(wrapper.find('[name=new_password]').exists()).toBe(false)
      expect(JSON.stringify(sessionStorage)).not.toContain(password)
    },
  )

  it('preserves formal assessment leave protection and prevents repeat requests', async () => {
    const { wrapper, auth } = await render()
    let answer!: (allowed: boolean) => void
    const leave = vi.fn().mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          answer = resolve
        }),
    )
    unregister.push(registerAssessmentLeave(leave))
    const change = vi.spyOn(auth, 'changePassword').mockResolvedValue()
    await fill(wrapper)
    await wrapper.get('form').trigger('submit')
    await wrapper.get('form').trigger('submit')
    expect(leave).toHaveBeenCalledOnce()
    expect(wrapper.get('button[type=submit]').attributes('disabled')).toBeDefined()
    answer(false)
    await flushPromises()
    expect(change).not.toHaveBeenCalled()
    expect(wrapper.get('[role=alert]').text()).toContain('未能确认测评已安全暂存')
    expect(wrapper.get('button[type=submit]').attributes('disabled')).toBeUndefined()
  })

  it('keeps actionable errors visible without claiming success', async () => {
    const { wrapper, auth, router } = await render()
    vi.spyOn(auth, 'changePassword').mockRejectedValue(new Error('当前密码不正确，请重新输入。'))
    await fill(wrapper)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role=alert]').text()).toContain('当前密码不正确')
    expect(router.currentRoute.value.path).toBe('/workspace')
    expect(wrapper.get('button[type=submit]').attributes('disabled')).toBeUndefined()
  })

  it('uses safe autocomplete and accessible visibility controls', async () => {
    const { wrapper } = await render()
    expect(wrapper.get('[name=current_password]').attributes('autocomplete')).toBe(
      'current-password',
    )
    expect(wrapper.get('[name=new_password]').attributes('autocomplete')).toBe('new-password')
    expect(wrapper.get('[name=confirm_password]').attributes('autocomplete')).toBe('new-password')
    expect(wrapper.get('[name=new_password]').attributes('maxlength')).toBeUndefined()
    await wrapper.get('button[aria-label="显示当前密码"]').trigger('click')
    expect(wrapper.get('[name=current_password]').attributes('type')).toBe('text')
    expect(wrapper.get('button[aria-label="隐藏当前密码"]').attributes('aria-pressed')).toBe('true')
  })

  it('clears secret values and ignores pending failure when another account becomes active', async () => {
    const { wrapper, auth, router } = await render()
    let reject!: (error: Error) => void
    vi.spyOn(auth, 'changePassword').mockImplementation(
      () =>
        new Promise<void>((_resolve, fail) => {
          reject = fail
        }),
    )
    await fill(wrapper)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    auth.user = { ...auth.user!, id: 'other' }
    await flushPromises()
    expect((wrapper.get('[name=new_password]').element as HTMLInputElement).value).toBe('')
    reject(new Error('old account error'))
    await flushPromises()
    expect(wrapper.text()).not.toContain('old account error')
    expect(router.currentRoute.value.path).toBe('/workspace')
  })
})
