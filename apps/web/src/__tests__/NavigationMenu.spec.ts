import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import NavigationMenu from '../components/NavigationMenu.vue'
import { useAccessStore } from '../stores/access'
import { useAuthStore } from '../stores/auth'

const wrappers: ReturnType<typeof mount>[] = []
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()))

async function render(role: string, capabilities: string[], path = '/workspace') {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().user = {
    id: 'synthetic-user',
    username: 'synthetic-account',
    email: null,
    display_name: '合成账号',
    is_active: true,
  }
  const access = useAccessStore()
  access.organizations = [{ id: 'synthetic-org', name: '合成组织', role, capabilities: [] }]
  access.organizationId = 'synthetic-org'
  access.globalCapabilities = capabilities
  access.ready = true
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }],
  })
  await router.push(path)
  const wrapper = mount(NavigationMenu, {
    global: { plugins: [pinia, router], stubs: { BrandMark: true } },
  })
  wrappers.push(wrapper)
  return { wrapper, access, router }
}

describe('navigation account identity', () => {
  it('separates teaching and personal menus while retaining an explicit portal switch', async () => {
    const { wrapper, router } = await render(
      'evaluator',
      ['content_author', 'reviews'],
      '/teaching',
    )
    expect(wrapper.find('nav a[href="/teaching"]').exists()).toBe(true)
    expect(wrapper.find('nav a[href="/authoring"]').exists()).toBe(true)
    expect(wrapper.find('nav a[href="/item-bank"]').exists()).toBe(false)
    expect(wrapper.find('nav a[href="/assessment"]').exists()).toBe(false)
    await wrapper.get('.account-menu').trigger('pointerenter', { pointerType: 'mouse' })
    expect(wrapper.get('[data-testid="portal-switch"]').attributes('href')).toBe('/workspace')
    await router.push('/workspace')
    expect(wrapper.find('nav a[href="/authoring"]').exists()).toBe(false)
    expect(wrapper.find('nav a[href="/assessment"]').exists()).toBe(true)
    await wrapper.get('.account-menu').trigger('pointerenter', { pointerType: 'mouse' })
    expect(wrapper.get('[data-testid="portal-switch"]').attributes('href')).toBe('/staff/login')
  })
  it('never offers a learner a teacher switch based on a role label alone', async () => {
    const { wrapper } = await render('system_admin', [])
    await wrapper.get('.account-menu').trigger('pointerenter', { pointerType: 'mouse' })
    expect(wrapper.find('[data-testid="portal-switch"]').exists()).toBe(false)
  })
  it('opens on mouse hover, lists profile below logout, and closes on leaving', async () => {
    const { wrapper } = await render('learner', [])
    expect(wrapper.find('.account-popover').exists()).toBe(false)
    await wrapper.get('.account-menu').trigger('pointerenter', { pointerType: 'mouse' })
    expect(wrapper.findAll('.account-popover button').map((button) => button.text())).toEqual([
      '退出登录',
      '个人资料',
    ])
    await wrapper.get('.account-menu').trigger('pointerleave', { pointerType: 'mouse' })
    expect(wrapper.find('.account-popover').exists()).toBe(false)
  })
  it('supports keyboard activation, Escape and outside pointer dismissal', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    const { wrapper } = await render('learner', [])
    await wrapper.get('.account-trigger').trigger('click')
    expect(wrapper.get('.account-trigger').attributes('aria-expanded')).toBe('true')
    await wrapper.get('.account-menu').trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('.account-popover').exists()).toBe(false)
    await wrapper.get('.account-trigger').trigger('click')
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.account-popover').exists()).toBe(false)
    vi.unstubAllGlobals()
  })
  it.each([
    { role: 'learner', capabilities: ['content_author'], label: '教师 · 指派维护' },
    { role: 'evaluator', capabilities: ['content_author'], label: '评估员 · 指派维护' },
    { role: 'org_admin', capabilities: ['content_author'], label: '组织管理员 · 指派维护' },
    { role: 'learner', capabilities: ['content_author', 'system'], label: '系统管理员' },
    { role: 'learner', capabilities: [], label: '学员' },
    { role: 'evaluator', capabilities: [], label: '评估员' },
  ])('shows $label for $role with actual capabilities', async ({ role, capabilities, label }) => {
    const { wrapper } = await render(role, capabilities)
    expect(wrapper.get('.account small').text()).toBe(label)
  })
  it('removes the assigned-maintenance identity when that capability is withdrawn', async () => {
    const { wrapper, access } = await render('learner', ['content_author'])
    expect(wrapper.get('.account small').text()).toBe('教师 · 指派维护')
    access.globalCapabilities = []
    await wrapper.vm.$nextTick()
    expect(wrapper.get('.account small').text()).toBe('学员')
    expect(wrapper.find('a[href="/authoring"]').exists()).toBe(false)
  })
})
