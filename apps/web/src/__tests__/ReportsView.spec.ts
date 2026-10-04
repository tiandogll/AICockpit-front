import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'
import { reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ReportsView from '../views/ReportsView.vue'

const context = vi.hoisted(() => ({
  access: null as unknown as {
    organizationId: string
    ready: boolean
    error: string
    load: () => Promise<void>
  },
}))
vi.mock('../stores/access', () => ({ useAccessStore: () => context.access }))
const item = {
  id: 'report-1',
  session_id: 'session-1',
  name: '高校标准测评',
  mode: 'standard',
  scenario: 'higher_education',
  status: 'pending_scoring',
  completed_at: null,
  revision: 1,
  dimensions: [{ code: 'evaluation', index: null, level: 'insufficient', evidence_count: 0 }],
}
function json(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200 })
}

describe('ReportsView', () => {
  beforeEach(() => {
    sessionStorage.clear()
    sessionStorage.setItem(
      'zhijian-auth-session',
      JSON.stringify({ accessToken: 'token', refreshToken: 'refresh' }),
    )
    setActivePinia(createPinia())
    context.access = reactive({
      organizationId: 'org-1',
      ready: true,
      error: '',
      load: vi.fn<() => Promise<void>>(async () => {}),
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('renders truthful pending and missing states and existing report detail URLs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => json({ items: [item], total: 1, limit: 12, offset: 0 })),
    )
    const wrapper = mount(ReportsView, { global: { stubs: { RouterLink: RouterLinkStub } } })
    await flushPromises()
    expect(wrapper.text()).toContain('评分中')
    expect(wrapper.text()).toContain('暂无数据')
    expect(wrapper.text()).not.toContain('0.0')
    expect(
      wrapper
        .findAllComponents(RouterLinkStub)
        .some((link) => link.props('to') === '/reports/session-1'),
    ).toBe(true)
  })

  it('sends filters to the API and resets pagination when a filter changes', async () => {
    const request = vi.fn<typeof fetch>(async () =>
      json({ items: [item], total: 25, limit: 12, offset: 0 }),
    )
    vi.stubGlobal('fetch', request)
    const wrapper = mount(ReportsView, { global: { stubs: { RouterLink: RouterLinkStub } } })
    await flushPromises()
    await wrapper.get('[data-testid="next-page"]').trigger('click')
    await flushPromises()
    expect(String(request.mock.calls[request.mock.calls.length - 1]?.[0])).toContain('offset=12')
    await wrapper.get('[data-testid="mode-filter"]').setValue('rapid')
    await flushPromises()
    expect(String(request.mock.calls[request.mock.calls.length - 1]?.[0])).toContain('mode=rapid')
    expect(String(request.mock.calls[request.mock.calls.length - 1]?.[0])).toContain('offset=0')
  })

  it('labels local experience separately without masking the scoring state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () =>
        json({
          items: [{ ...item, data_origin: 'synthetic' }],
          total: 1,
          limit: 12,
          offset: 0,
        }),
      ),
    )
    const wrapper = mount(ReportsView, { global: { stubs: { RouterLink: RouterLinkStub } } })
    await flushPromises()
    expect(wrapper.text()).toContain('本地体验 · 非正式比赛题库')
    expect(wrapper.text()).toContain('不计入正式统计')
    expect(wrapper.text()).toContain('评分中')
    expect(wrapper.text()).toContain('暂无数据')
  })
})
