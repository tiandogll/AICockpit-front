import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'
import { reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import HistoryView from '../views/HistoryView.vue'

const context = vi.hoisted(() => ({
  access: null as unknown as {
    organizationId: string
    ready: boolean
    error: string
    load: () => Promise<void>
  },
}))
vi.mock('../stores/access', () => ({ useAccessStore: () => context.access }))
const row = {
  id: 'session-1',
  session_id: 'session-1',
  name: '我的标准测评',
  mode: 'standard',
  scenario: 'general',
  status: 'active',
  created_at: '2026-09-01T08:00:00Z',
  completed_at: null,
  answered: 7,
  max_items: null,
  report_id: null,
  report_status: null,
}
function json(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200 })
}

describe('HistoryView', () => {
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

  it('links active sessions to continuation and does not fabricate a missing report or maximum', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input) =>
        String(input).includes('/trends')
          ? json({ groups: [], total: 0, limit: 100, offset: 0 })
          : json({ items: [row], total: 1, limit: 12, offset: 0 }),
      ),
    )
    const wrapper = mount(HistoryView, { global: { stubs: { RouterLink: RouterLinkStub } } })
    await flushPromises()
    expect(wrapper.text()).toContain('已保存 7 题')
    expect(wrapper.text()).toContain('最大题量未记录')
    expect(
      wrapper
        .findAllComponents(RouterLinkStub)
        .some((link) => link.props('to') === '/assessment/session-1'),
    ).toBe(true)
    expect(
      wrapper
        .findAllComponents(RouterLinkStub)
        .some((link) => link.props('to') === '/reports/session-1'),
    ).toBe(false)
  })

  it('uses session status filters and clears stale organization records', async () => {
    const request = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.includes('/trends')) return json({ groups: [], total: 0, limit: 100, offset: 0 })
      return json({
        items: url.includes('status=completed') ? [] : [row],
        total: url.includes('status=completed') ? 0 : 1,
        limit: 12,
        offset: 0,
      })
    })
    vi.stubGlobal('fetch', request)
    const wrapper = mount(HistoryView, { global: { stubs: { RouterLink: RouterLinkStub } } })
    await flushPromises()
    await wrapper.get('[data-testid="status-filter"]').setValue('completed')
    await flushPromises()
    expect(String(request.mock.calls[request.mock.calls.length - 1]?.[0])).toContain(
      'status=completed',
    )
    expect(wrapper.text()).not.toContain('我的标准测评')
    expect(wrapper.text()).toContain('暂无符合条件的测评')
  })

  it('passes real organization and scenario filters to comparable growth records', async () => {
    const request = vi.fn<typeof fetch>(async (input) =>
      String(input).includes('/trends')
        ? json({ groups: [], total: 0, limit: 100, offset: 0 })
        : json({ items: [], total: 0, limit: 12, offset: 0 }),
    )
    vi.stubGlobal('fetch', request)
    const wrapper = mount(HistoryView, { global: { stubs: { RouterLink: RouterLinkStub } } })
    await flushPromises()
    expect(wrapper.text()).toContain('个人成长趋势')
    await wrapper.findAll('select')[1]!.setValue('enterprise')
    await flushPromises()
    expect(
      request.mock.calls.some(
        ([url]) => String(url).includes('/trends') && String(url).includes('scenario=enterprise'),
      ),
    ).toBe(true)
    context.access.organizationId = 'org-2'
    await flushPromises()
    expect(
      request.mock.calls.some(
        ([url]) => String(url).includes('/trends') && String(url).includes('organization_id=org-2'),
      ),
    ).toBe(true)
  })

  it('keeps local-experience labels separate from timeout and read-only history', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input) =>
        String(input).includes('/trends')
          ? json({ groups: [], total: 0, limit: 100, offset: 0 })
          : json({
              items: [
                { ...row, status: 'abandoned', ended_reason: 'timeout', data_origin: 'synthetic' },
              ],
              total: 1,
              limit: 12,
              offset: 0,
            }),
      ),
    )
    const wrapper = mount(HistoryView, { global: { stubs: { RouterLink: RouterLinkStub } } })
    await flushPromises()
    expect(wrapper.text()).toContain('本地体验 · 非正式比赛题库')
    expect(wrapper.text()).toContain('不计入正式统计')
    expect(wrapper.text()).toContain('已超时 · 未完成')
    expect(wrapper.text()).toContain('只读回看')
  })
})
