import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PersonalProfileDialog from '../components/PersonalProfileDialog.vue'
import { useAuthStore } from '../stores/auth'
import { useAccessStore } from '../stores/access'
import { createMemoryHistory, createRouter } from 'vue-router'

const wrappers: ReturnType<typeof mount>[] = []
const closeDialog = vi.fn(function (this: HTMLDialogElement) {
  this.open = false
  this.dispatchEvent(new Event('close'))
})
beforeEach(() => {
  setActivePinia(createPinia())
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true
    },
  })
  closeDialog.mockClear()
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: closeDialog,
  })
})
afterEach(() => {
  wrappers.splice(0).forEach((w) => w.unmount())
  vi.restoreAllMocks()
})
async function render() {
  const auth = useAuthStore()
  auth.user = {
    id: 'u1',
    username: 'user',
    email: null,
    display_name: '体验学员',
    is_active: true,
    password_change_available: true,
  }
  const access = useAccessStore()
  access.organizations = [{ id: 'o1', name: '本地体验', role: 'learner', capabilities: [] }]
  access.organizationId = 'o1'
  access.ready = true
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/workspace', component: { template: '<div />' } },
      { path: '/login', component: { template: '<div />' } },
    ],
  })
  await router.push('/workspace')
  const wrapper = mount(PersonalProfileDialog, {
    props: { roleLabel: '学员' },
    global: { stubs: { Teleport: true }, plugins: [router] },
  })
  wrappers.push(wrapper)
  await flushPromises()
  wrapper.vm.show()
  expect((wrapper.get('dialog').element as HTMLDialogElement).open, 'open immediately').toBe(true)
  await flushPromises()
  return { wrapper, auth }
}
describe('personal profile', () => {
  it('opens account security without changing the shared dialog and clears passwords when dismissed', async () => {
    const { wrapper } = await render()
    const securityTab = wrapper.get('.profile-sections button:last-child')
    await securityTab.trigger('click')
    await flushPromises()
    expect(wrapper.get('.profile-sections button:last-child').attributes('aria-pressed')).toBe(
      'true',
    )
    expect(wrapper.get('dialog').classes()).toContain('profile-dialog')
    await wrapper.get('[name=current_password]').setValue('old1234')
    await wrapper.get('[name=new_password]').setValue('new-password')
    await wrapper.get('.close-profile').trigger('click')
    expect(wrapper.text()).toContain('密码尚未提交')
    // Native dialog open-state/focus is verified by the browser acceptance test.
    expect(closeDialog).not.toHaveBeenCalled()
    await wrapper.get('.security-discard .profile-actions button:last-child').trigger('click')
    await flushPromises()
    expect(wrapper.find('[name=current_password]').exists()).toBe(false)
    wrapper.vm.show()
    await flushPromises()
    await wrapper.get('.profile-sections button:last-child').trigger('click')
    expect((wrapper.get('[name=new_password]').element as HTMLInputElement).value).toBe('')
  })
  it('preserves unsaved profile edits when security is selected', async () => {
    const { wrapper } = await render()
    await wrapper.get('[name=display_name]').setValue('还没保存')
    await wrapper.get('.profile-sections button:last-child').trigger('click')
    expect(wrapper.find('[name=new_password]').exists()).toBe(false)
    expect((wrapper.get('[name=display_name]').element as HTMLInputElement).value).toBe('还没保存')
    expect(wrapper.get('[role=alert]').text()).toContain('资料尚未保存')
  })
  it('requires confirmation before switching away from unfinished password inputs', async () => {
    const { wrapper } = await render()
    await wrapper.get('.profile-sections button:last-child').trigger('click')
    await wrapper.get('[name=current_password]').setValue('old1234')
    await wrapper.get('.profile-sections button:first-child').trigger('click')
    expect(wrapper.find('[name=current_password]').exists()).toBe(true)
    await wrapper.get('.security-discard .profile-actions button:last-child').trigger('click')
    expect(wrapper.find('[name=current_password]').exists()).toBe(false)
    expect(wrapper.find('[name=display_name]').exists()).toBe(true)
  })
  it('shows read-only account details and saves all editable profile fields', async () => {
    const { wrapper, auth } = await render()
    expect(wrapper.text()).toContain('本地体验')
    expect(wrapper.text()).toContain('未填写（不影响登录）')
    expect(wrapper.find('input[name="username"]').exists()).toBe(false)
    const save = vi.spyOn(auth, 'updateProfile').mockResolvedValue()
    await wrapper.get('[name="display_name"]').setValue(' 林晓 ')
    await wrapper.get('[name="affiliation"]').setValue('示例大学')
    await wrapper.get('[name="specialty"]').setValue('产品设计')
    await wrapper.get('[name="learning_goal"]').setValue('学习核验')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(save).toHaveBeenCalledWith({
      display_name: '林晓',
      affiliation: '示例大学',
      specialty: '产品设计',
      learning_goal: '学习核验',
    })
    expect(wrapper.text()).toContain('资料已保存')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
  })
  it.each(['  ', 'x'.repeat(81)])(
    'rejects invalid name before requesting the API',
    async (name) => {
      const { wrapper, auth } = await render()
      const save = vi.spyOn(auth, 'updateProfile')
      await wrapper.get('[name="display_name"]').setValue(name)
      await wrapper.get('form').trigger('submit')
      expect(save).not.toHaveBeenCalled()
      expect(wrapper.get('[role="alert"]').text()).toContain('1–80')
    },
  )
  it('retains input on failed saves and asks before discarding changes', async () => {
    const { wrapper, auth } = await render()
    vi.spyOn(auth, 'updateProfile').mockRejectedValue(new Error('网络不可用，请重试'))
    await wrapper.get('[name="display_name"]').setValue('未保存姓名')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('网络不可用')
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('未保存姓名')
    await wrapper.get('.close-profile').trigger('click')
    expect(wrapper.text()).toContain('放弃修改')
    // Native open/focus behavior is covered in the real-browser acceptance script.
    expect(closeDialog).not.toHaveBeenCalled()
  })
  it('does not show success from a save that finishes after the account changes', async () => {
    const { wrapper, auth } = await render()
    let finish!: () => void
    vi.spyOn(auth, 'updateProfile').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    await wrapper.get('[name="display_name"]').setValue('待保存')
    await wrapper.get('form').trigger('submit')
    auth.user = null
    await flushPromises()
    finish()
    await flushPromises()
    expect((wrapper.get('dialog').element as HTMLDialogElement).open).toBe(false)
    expect(wrapper.text()).not.toContain('资料已保存')
  })
})
