import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import App from '../App.vue'
import { useAuthStore } from '../stores/auth'
import { useAccessStore } from '../stores/access'

describe('App', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })))
  })
  afterEach(() => vi.unstubAllGlobals())
  it('renders the brand and primary navigation', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: { template: '<div>首页内容</div>' } },
        { path: '/:pathMatch(.*)*', component: { template: '<div>其他功能</div>' } },
      ],
    })
    await router.push('/')
    await router.isReady()
    const wrapper = mount(App, { global: { plugins: [pinia, router] } })
    expect(wrapper.text()).toContain('AI Measure')
    expect(wrapper.text()).toContain('登录测评')
  })

  it('shows the current learner and provides an explicit logout action', async () => {
    sessionStorage.setItem(
      'zhijian-auth-session',
      JSON.stringify({ accessToken: 'access-token', refreshToken: 'refresh-token' }),
    )
    const pinia = createPinia()
    setActivePinia(pinia)
    const auth = useAuthStore()
    auth.user = {
      id: 'user-1',
      email: 'learner@example.test',
      display_name: '试测学员',
      is_active: true,
    }
    const access = useAccessStore()
    access.ready = true
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: { template: '<div>首页内容</div>' } },
        { path: '/login', component: { template: '<div>登录</div>' } },
        { path: '/workspace', component: { template: '<div>工作台</div>' } },
        { path: '/:pathMatch(.*)*', component: { template: '<div>其他功能</div>' } },
      ],
    })
    await router.push('/workspace')
    await router.isReady()
    const wrapper = mount(App, { global: { plugins: [pinia, router] } })

    expect(wrapper.text()).toContain('试测学员')
    expect(wrapper.find('[data-testid=logout]').exists()).toBe(false)
    await wrapper
      .get('.measure-sidebar .account-menu')
      .trigger('pointerenter', { pointerType: 'mouse' })
    expect(wrapper.get('[data-testid=logout]').attributes('aria-label')).toContain('退出')
    expect(wrapper.get('[data-testid=personal-profile]').text()).toBe('个人资料')
    wrapper.unmount()
  })
})
