import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TeachingView from '../views/TeachingView.vue'
import { useAccessStore } from '../stores/access'
import { useAuthStore } from '../stores/auth'

const wrappers: ReturnType<typeof mount>[] = []
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()))

async function render(capabilities: string[], globalCapabilities: string[] = []) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const auth = useAuthStore()
  auth.user = {
    id: 'synthetic-teacher',
    username: 'teacher',
    display_name: '合成教师',
    email: null,
    is_active: true,
  }
  auth.accessToken = 'synthetic-access'
  auth.refreshToken = 'synthetic-refresh'
  const access = useAccessStore()
  access.organizations = [
    { id: 'synthetic-org', name: '合成教学组织', role: 'evaluator', capabilities },
  ]
  access.organizationId = 'synthetic-org'
  access.globalCapabilities = globalCapabilities
  access.ready = true
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }],
  })
  await router.push('/teaching')
  const wrapper = mount(TeachingView, { global: { plugins: [pinia, router] } })
  wrappers.push(wrapper)
  return { wrapper, access, router, auth }
}

function modulePaths(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll('[data-testid="teaching-module"]').map((link) => link.attributes('href'))
}

describe('shared teaching portal home', () => {
  it('shows only the assigned teacher modules and links to the existing workspaces', async () => {
    const { wrapper, router } = await render(['reviews', 'analytics'], ['content_author'])
    expect(modulePaths(wrapper).sort()).toEqual(['/analytics', '/authoring', '/reviews'])
    expect(wrapper.text()).toContain('合成教学组织')
    expect(wrapper.text()).toContain('你可以维护已指派题目并提交审核，发布由管理员完成')
    expect(wrapper.find('a[href="/item-bank"]').exists()).toBe(false)
    expect(wrapper.find('a[href="/members"]').exists()).toBe(false)
    expect(wrapper.find('a[href="/system"]').exists()).toBe(false)
    await wrapper.get('a[href="/authoring"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/authoring')
  })

  it('uses the same home for an administrator without inventing a third portal', async () => {
    const { wrapper } = await render([], ['system', 'content', 'reviews', 'analytics', 'members'])
    expect(wrapper.get('h1').text()).toBe('教师管理工作台')
    expect(wrapper.get('.scope-badge').text()).toBe('系统管理员')
    expect(modulePaths(wrapper)).toEqual(
      expect.arrayContaining(['/item-bank', '/reviews', '/members', '/system']),
    )
    expect(modulePaths(wrapper)).not.toContain('/teaching')
    expect(modulePaths(wrapper)).not.toContain('/workspace')
    expect(wrapper.get('a[href="/workspace"]').text()).toContain('进入学员端')
  })

  it('does not treat participation in a trial as management permission', async () => {
    const { wrapper } = await render(['pilot_participate'])
    expect(modulePaths(wrapper)).toEqual([])
    expect(wrapper.text()).toContain('当前暂无可用的管理模块')
  })

  it('removes all module cards when permissions become unavailable or are revoked', async () => {
    const { wrapper, access } = await render([], ['content_author'])
    expect(modulePaths(wrapper)).toEqual(['/authoring'])
    access.ready = false
    await wrapper.vm.$nextTick()
    expect(modulePaths(wrapper)).toEqual([])
    expect(wrapper.text()).toContain('正在核对管理权限')
    access.globalCapabilities = []
    access.ready = true
    await wrapper.vm.$nextTick()
    expect(modulePaths(wrapper)).toEqual([])
    expect(wrapper.text()).toContain('当前暂无可用的管理模块')
  })

  it('offers a real permission reload on failure instead of rendering stale links', async () => {
    const { wrapper, access } = await render([], ['content_author'])
    const load = vi.spyOn(access, 'load').mockResolvedValue()
    access.error = '服务暂不可用，请稍后重试。'
    await wrapper.vm.$nextTick()
    expect(modulePaths(wrapper)).toEqual([])
    expect(wrapper.get('[role="alert"]').text()).toContain('服务暂不可用')
    await wrapper.get('button').trigger('click')
    expect(load).toHaveBeenCalledWith(true)
  })

  it('hides management content after logout even if an access snapshot remains', async () => {
    const { wrapper, auth } = await render([], ['content_author'])
    auth.accessToken = ''
    auth.refreshToken = ''
    await wrapper.vm.$nextTick()
    expect(modulePaths(wrapper)).toEqual([])
    expect(wrapper.find('.teaching-scope').exists()).toBe(false)
  })
})
