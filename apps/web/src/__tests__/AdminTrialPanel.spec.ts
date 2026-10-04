import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AdminTrialPanel from '../components/AdminTrialPanel.vue'
import * as api from '../services/contentTrialApi'
import { ApiError } from '../services/apiClient'
import type { TrialResult } from '../services/contentTrialApi'
const state = vi.hoisted(() => ({
  auth: null as unknown as { user: { id: string }; isAuthenticated: boolean },
  access: null as unknown as {
    ready: boolean
    error: string
    organizationId: string
    organizations: { id: string; name: string; role: string; capabilities: string[] }[]
    globalCapabilities: string[]
    can: (cap: string) => boolean
  },
}))
vi.mock('../stores/auth', () => ({ useAuthStore: () => state.auth }))
vi.mock('../stores/access', () => ({ useAccessStore: () => state.access }))
vi.mock('../services/contentTrialApi', () => ({
  assignContentTrial: vi.fn(),
  listTrialResults: vi.fn(),
}))
const result: TrialResult = {
  id: 'trial-1',
  packet_id: 'packet-1',
  organization_id: 'org-1',
  code: 'A01-R1-test',
  dimension: 'evaluation',
  item_type: 'objective',
  status: 'submitted',
  revision: 2,
  created_at: '2026-09-20T00:00:00Z',
  expires_at: '2026-12-19T00:00:00Z',
  consented_at: '2026-09-20T00:00:00Z',
  submitted_at: '2026-09-20T01:00:00Z',
  withdrawn_at: null,
  purpose: 'content_quality_trial',
  notice: '仅用于题质试答',
  learner_username: 'learner',
  response: { selected_index: 0 },
  feedback: '选项清楚',
}
const wrappers: VueWrapper[] = []
function render(eligible = true) {
  const wrapper = mount(AdminTrialPanel, {
    props: { packetId: 'packet-1', digest: 'digest-1', eligible },
  })
  wrappers.push(wrapper)
  return wrapper
}
beforeEach(() => {
  vi.resetAllMocks()
  state.auth = reactive({ user: { id: 'admin' }, isAuthenticated: true })
  state.access = reactive({
    ready: true,
    error: '',
    organizationId: 'org-1',
    organizations: [{ id: 'org-1', name: '试答组织', role: 'admin', capabilities: ['content'] }],
    globalCapabilities: ['content'],
    can: (cap) => cap === 'content',
  })
  vi.mocked(api.listTrialResults).mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 })
  vi.stubGlobal('crypto', { randomUUID: () => 'stable-admin-key' })
})
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
describe('administrator trial assignment', () => {
  it('erases submitted originals from page state and DOM when the retention deadline passes', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date('2026-09-20T00:00:00Z'))
    const expires_at = new Date(Date.now() + 1000).toISOString()
    vi.mocked(api.listTrialResults).mockResolvedValue({
      items: [{ ...result, expires_at }],
      total: 1,
      limit: 20,
      offset: 0,
    })
    const wrapper = render()
    await flushPromises()
    expect(wrapper.text()).toContain('选项清楚')
    await vi.advanceTimersByTimeAsync(1000)
    await flushPromises()
    expect(wrapper.text()).toContain('已到期')
    expect(wrapper.find('details').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('选项清楚')
    const vm = wrapper.vm as unknown as { page: { items: TrialResult[] } }
    expect(vm.page.items[0]).toMatchObject({ status: 'expired', response: null, feedback: null })
  })
  it('redacts late expired results and rechecks visibility without a rerender', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date('2026-09-20T00:00:00Z'))
    const expires_at = new Date(Date.now() + 1000).toISOString()
    vi.mocked(api.listTrialResults).mockResolvedValue({
      items: [{ ...result, expires_at }],
      total: 1,
      limit: 20,
      offset: 0,
    })
    const wrapper = render()
    await flushPromises()
    vi.setSystemTime(Date.now() + 2000)
    document.dispatchEvent(new Event('visibilitychange'))
    await flushPromises()
    expect(wrapper.find('details').exists()).toBe(false)
    vi.mocked(api.listTrialResults).mockResolvedValue({
      items: [{ ...result, expires_at }],
      total: 1,
      limit: 20,
      offset: 0,
    })
    await wrapper.get('.text-button').trigger('click')
    await flushPromises()
    const vm = wrapper.vm as unknown as { page: { items: TrialResult[] } }
    expect(vm.page.items[0]).toMatchObject({ status: 'expired', response: null, feedback: null })
  })
  it('does not offer assignment without a valid approval but still reads existing records', async () => {
    const wrapper = render(false)
    await flushPromises()
    expect(wrapper.text()).toContain('当前版本尚不满足一位审核人通过')
    expect(wrapper.find('[data-testid=trial-assignment-prepare]').exists()).toBe(false)
    expect(api.listTrialResults).toHaveBeenCalledWith('packet-1', 0)
  })
  it('confirms the designated learner and retries the same immutable intent after a failed request', async () => {
    vi.mocked(api.assignContentTrial)
      .mockRejectedValueOnce(new Error('网络中断'))
      .mockResolvedValueOnce({ ...result, status: 'assigned' })
    const wrapper = render()
    await flushPromises()
    await wrapper.get('[data-testid=trial-learner-username]').setValue('learner')
    await wrapper.get('[data-testid=trial-assignment-prepare]').trigger('click')
    expect(api.assignContentTrial).not.toHaveBeenCalled()
    await wrapper.get('[data-testid=trial-assignment-confirm]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('网络中断')
    expect(wrapper.text()).not.toContain('已指派题质试答')
    await wrapper.get('[data-testid=trial-assignment-confirm]').trigger('click')
    await flushPromises()
    expect(api.assignContentTrial).toHaveBeenCalledWith(
      'packet-1',
      { expected_digest: 'digest-1', organization_id: 'org-1', learner_username: 'learner' },
      expect.any(String),
    )
    expect(vi.mocked(api.assignContentTrial).mock.calls[0]).toEqual(
      vi.mocked(api.assignContentTrial).mock.calls[1],
    )
    expect(wrapper.text()).toContain('已指派题质试答')
  })
  it('shows result loading errors, not an empty-success message', async () => {
    vi.mocked(api.listTrialResults).mockRejectedValue(new ApiError('无权读取记录', 403))
    const wrapper = render()
    await flushPromises()
    expect(wrapper.text()).toContain('无权读取记录')
    expect(wrapper.text()).not.toContain('尚无试答指派')
  })
  it('renders submitted originals as text, and never shows an in-progress original', async () => {
    vi.mocked(api.listTrialResults).mockResolvedValue({
      items: [
        { ...result, feedback: '<script>bad()</script>' },
        { ...result, id: 'trial-2', status: 'in_progress', feedback: '不应显示草稿' },
      ],
      total: 2,
      limit: 20,
      offset: 0,
    })
    const wrapper = render()
    await flushPromises()
    expect(wrapper.text()).toContain('<script>bad()</script>')
    expect(wrapper.find('script').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('不应显示草稿')
  })
  it('discards delayed original text after an organization change', async () => {
    let resolve!: (value: Awaited<ReturnType<typeof api.listTrialResults>>) => void
    vi.mocked(api.listTrialResults).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done
      }),
    )
    const wrapper = render()
    await flushPromises()
    state.access.organizationId = 'org-2'
    resolve({ items: [result], total: 1, limit: 20, offset: 0 })
    await flushPromises()
    expect(wrapper.text()).not.toContain('选项清楚')
  })
})
