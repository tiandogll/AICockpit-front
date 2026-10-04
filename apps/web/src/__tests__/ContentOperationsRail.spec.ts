import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ContentOperationsRail from '../components/ContentOperationsRail.vue'
import { readProviderHealth, type ProviderHealth } from '../services/adminWorkspaceApi'

vi.mock('../stores/auth', () => ({ useAuthStore: () => ({ isAuthenticated: true, user: { id: 'admin' } }) }))
vi.mock('../stores/access', () => ({ useAccessStore: () => ({ ready: true, organizationId: 'org',
  can: (name: string) => name === 'system' }) }))
vi.mock('../services/adminWorkspaceApi', () => ({ readProviderHealth: vi.fn() }))
vi.mock('../services/reviewApi', () => ({ listReviews: vi.fn() }))
const health: ProviderHealth = {
  requested_provider: 'deepseek', active_provider: 'deepseek', configured: true, ready: true,
  model: 'deepseek-flash', circuit_state: 'closed', failure_count: 0, retry_after_seconds: null,
  fallback_enabled: false, daily_token_quota: 1000, tokens_used_today: 0, timeout_seconds: 15, max_retries: 0,
}
async function render(override: Partial<ProviderHealth> = {}) {
  vi.mocked(readProviderHealth).mockResolvedValue({ ...health, ...override })
  const wrapper = mount(ContentOperationsRail, { global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } } })
  await flushPromises()
  return wrapper
}
describe('content model status explanation', () => {
  beforeEach(() => { vi.clearAllMocks() })
  it('explains deliberate zero quota and missing credentials instead of an opaque unavailable badge', async () => {
    const wrapper = await render({ configured: false, ready: false, daily_token_quota: 0 })
    expect(wrapper.text()).toContain('调用已停用')
    expect(wrapper.get('[role=status]').text()).toContain('尚未配置')
    expect(wrapper.get('[role=status]').text()).toContain('每日额度设为 0')
  })
  it('does not call a configured-but-exhausted service ready to use', async () => {
    const wrapper = await render({ tokens_used_today: 1000 })
    expect(wrapper.text()).toContain('额度已用完')
    expect(wrapper.text()).not.toContain('配置就绪')
  })
  it('separates configuration readiness from actual successful model generation', async () => {
    const wrapper = await render()
    expect(wrapper.text()).toContain('配置就绪')
    expect(wrapper.text()).toContain('不代表本次模型调用已成功')
    expect(wrapper.find('[role=status]').exists()).toBe(false)
  })
})
