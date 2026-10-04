import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { reactive } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SystemView from '../views/SystemView.vue'
import { useAuthStore } from '../stores/auth'
import * as api from '../services/adminWorkspaceApi'

const context = vi.hoisted(() => ({
  access: null as unknown as {
    organizationId: string
    organization: { name: string }
    ready: boolean
    error: string
    system: boolean
    governance: boolean
    can: (name: string) => boolean
    load: () => Promise<void>
  },
}))
vi.mock('../stores/access', () => ({ useAccessStore: () => context.access }))
vi.mock('../services/adminWorkspaceApi', () => ({
  readProviderHealth: vi.fn<typeof api.readProviderHealth>(),
  readOrganizationSecurity: vi.fn<typeof api.readOrganizationSecurity>(),
  readOrganizationAudit: vi.fn<typeof api.readOrganizationAudit>(),
  previewRetention: vi.fn<typeof api.previewRetention>(),
  executeRetention: vi.fn<typeof api.executeRetention>(),
}))
const provider = {
  requested_provider: 'deepseek',
  active_provider: 'mock',
  configured: false,
  ready: false,
  model: 'mock-v1',
  circuit_state: 'open',
  failure_count: 2,
  retry_after_seconds: 12,
  fallback_enabled: true,
  daily_token_quota: 1000,
  tokens_used_today: 300,
  timeout_seconds: 15,
  max_retries: 2,
}
const preview = {
  organization_id: 'org-1',
  cutoff_at: '2026-06-01T00:00:00Z',
  retention_days: 90,
  result_counts: { dialogue_turns: 3 },
}

describe('SystemView', () => {
  beforeEach(() => {
    sessionStorage.clear()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    useAuthStore().user = {
      id: 'actor-1',
      display_name: '合成管理员',
      email: 'admin@example.test',
      is_active: true,
    }
    context.access = reactive({
      organizationId: 'org-1',
      organization: { name: '合成组织' },
      ready: true,
      error: '',
      system: true,
      governance: true,
      can(name) {
        return name === 'system' ? this.system : name === 'governance' ? this.governance : false
      },
      load: vi.fn<() => Promise<void>>(async () => {}),
    })
    vi.mocked(api.readProviderHealth).mockResolvedValue(provider)
    vi.mocked(api.readOrganizationSecurity).mockResolvedValue({
      organization_id: 'org-1',
      model_tokens_used_today: 12,
      model_daily_token_quota: 100,
      recent_audit_events: 1,
      retention_days: 90,
      minimum_group_size: 5,
    })
    vi.mocked(api.readOrganizationAudit).mockResolvedValue([])
    vi.mocked(api.previewRetention).mockResolvedValue(preview)
    vi.mocked(api.executeRetention).mockResolvedValue({
      id: 'run-1',
      organization_id: 'org-1',
      cutoff_at: preview.cutoff_at,
      mode: 'execute',
      status: 'completed',
      result_counts: preview.result_counts,
      completed_at: '2026-09-14T00:00:00Z',
      failure_code: null,
      replayed: false,
    })
  })
  it('shows actual degraded status and never guesses healthy or exposes model write controls', async () => {
    const wrapper = mount(SystemView)
    await flushPromises()
    expect(wrapper.text()).toContain('当前使用降级提供方')
    expect(wrapper.text()).toContain('mock')
    expect(wrapper.text()).toContain('尚未就绪')
    expect(wrapper.find('input[type="password"]').exists()).toBe(false)
    expect(api.previewRetention).not.toHaveBeenCalled()
    expect(api.executeRetention).not.toHaveBeenCalled()
  })
  it('loads global system status without inventing organization actions', async () => {
    context.access.organizationId = ''
    const wrapper = mount(SystemView)
    await flushPromises()
    expect(api.readProviderHealth).toHaveBeenCalledOnce()
    expect(api.readOrganizationSecurity).not.toHaveBeenCalled()
    expect(api.readOrganizationAudit).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="privacy-preview"]').exists()).toBe(false)
  })
  it('requires preview and explicit organization confirmation before executing', async () => {
    const wrapper = mount(SystemView)
    await flushPromises()
    await wrapper.get('[data-testid="privacy-preview"]').trigger('click')
    await flushPromises()
    expect(api.executeRetention).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid="privacy-execute"]').attributes('disabled')).toBeDefined()
    await wrapper.get('[data-testid="privacy-confirm-name"]').setValue('合成组织')
    await wrapper.get('[data-testid="privacy-confirm-ack"]').setValue(true)
    await wrapper.get('[data-testid="privacy-execute"]').trigger('click')
    await flushPromises()
    expect(api.executeRetention).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('清理已完成')
  })
  it('retries uncertain execution using the original key', async () => {
    vi.mocked(api.executeRetention).mockRejectedValueOnce(new Error('连接中断'))
    const wrapper = mount(SystemView)
    await flushPromises()
    await wrapper.get('[data-testid="privacy-preview"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="privacy-confirm-name"]').setValue('合成组织')
    await wrapper.get('[data-testid="privacy-confirm-ack"]').setValue(true)
    await wrapper.get('[data-testid="privacy-execute"]').trigger('click')
    await flushPromises()
    const firstKey = vi.mocked(api.executeRetention).mock.calls[0]?.[1]
    await wrapper.get('[data-testid="privacy-execute"]').trigger('click')
    await flushPromises()
    expect(api.executeRetention).toHaveBeenLastCalledWith('org-1', firstKey)
  })
  it('invalidates preview and confirmation immediately after organization change', async () => {
    const wrapper = mount(SystemView)
    await flushPromises()
    await wrapper.get('[data-testid="privacy-preview"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="privacy-confirm-name"]').setValue('合成组织')
    context.access.organizationId = 'org-2'
    await flushPromises()
    expect(wrapper.find('[data-testid="privacy-confirm-name"]').exists()).toBe(false)
    expect(api.executeRetention).not.toHaveBeenCalled()
  })
  it('restores only the pending request key after remount and still requires confirmation', async () => {
    vi.mocked(api.executeRetention).mockRejectedValueOnce(new Error('连接中断'))
    const first = mount(SystemView)
    await flushPromises()
    await first.get('[data-testid="privacy-preview"]').trigger('click')
    await flushPromises()
    await first.get('[data-testid="privacy-confirm-name"]').setValue('合成组织')
    await first.get('[data-testid="privacy-confirm-ack"]').setValue(true)
    await first.get('[data-testid="privacy-execute"]').trigger('click')
    await flushPromises()
    const originalKey = vi.mocked(api.executeRetention).mock.calls[0]?.[1]
    first.unmount()
    const restored = mount(SystemView)
    await flushPromises()
    expect(restored.text()).toContain('存在尚未确认完成的清理请求')
    expect(restored.find('[data-testid="privacy-execute"]').exists()).toBe(false)
    await restored.get('[data-testid="privacy-preview"]').trigger('click')
    await flushPromises()
    await restored.get('[data-testid="privacy-confirm-name"]').setValue('合成组织')
    await restored.get('[data-testid="privacy-confirm-ack"]').setValue(true)
    await restored.get('[data-testid="privacy-execute"]').trigger('click')
    await flushPromises()
    expect(api.executeRetention).toHaveBeenLastCalledWith('org-1', originalKey)
    expect(sessionStorage.getItem('ai-measure:privacy-request:actor-1:org-1')).toBeNull()
  })
})
