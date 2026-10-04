import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ComparableTrends from '../components/ComparableTrends.vue'
import { getWorkspaceTrends, type TrendGroup } from '../services/workspaceApi'

vi.mock('../services/workspaceApi', async (original) => ({
  ...(await original<typeof import('../services/workspaceApi')>()),
  getWorkspaceTrends: vi.fn<typeof getWorkspaceTrends>(),
}))
const point = (id: string, index: number, day: number) => ({
  report_id: id,
  session_id: `session-${id}`,
  completed_at: `2026-09-${day}T08:00:00Z`,
  index,
  level: 'L2',
  evidence_count: 2,
  revision: 1,
})
const group = (overrides: Partial<TrendGroup> = {}): TrendGroup => ({
  dimension_code: 'foundations',
  construct: 'objective',
  method_version: 'rasch-v1',
  scoring_policy_version: 'policy-v1',
  blueprint_version_id: 'blueprint-1',
  blueprint_version: 1,
  mode: 'standard',
  scenario: 'higher_education',
  points: [point('one', 40, 10), point('two', 55, 12)],
  ...overrides,
})
const page = (groups: TrendGroup[], total = 2, offset = 0) => ({
  groups,
  total,
  limit: 100,
  offset,
})
const mountTrends = () =>
  mount(ComparableTrends, {
    props: { organizationId: 'org-one', ready: true, mode: '', scenario: '' },
    global: { stubs: { RouterLink: RouterLinkStub } },
  })

describe('comparable growth records', () => {
  beforeEach(() => vi.clearAllMocks())
  it('labels summary changes as one comparable dimension and clears them when scope changes', async () => {
    vi.mocked(getWorkspaceTrends)
      .mockResolvedValueOnce(page([group()]))
      .mockResolvedValueOnce(page([], 0))
    const wrapper = mountTrends()
    await flushPromises()
    expect(wrapper.get('[aria-label="当前比较组摘要"]').text()).toContain('基础认知 · 同口径变化')
    expect(wrapper.get('[aria-label="当前比较组摘要"]').text()).toContain('+15.0')
    await wrapper.setProps({ organizationId: 'other-org' })
    await flushPromises()
    expect(wrapper.find('[aria-label="当前比较组摘要"]').exists()).toBe(false)
  })
  it('compares distinct chronological reports and rejects same or reversed selections', async () => {
    vi.mocked(getWorkspaceTrends).mockResolvedValue(page([group()]))
    const wrapper = mountTrends()
    await flushPromises()
    const first = wrapper.get('[data-testid=comparison-first]')
    const second = wrapper.get('[data-testid=comparison-second]')
    await first.setValue('one')
    await second.setValue('two')
    expect(wrapper.get('[data-testid=comparison-delta]').text()).toContain('15.0')
    await second.setValue('one')
    expect(wrapper.find('[data-testid=comparison-delta]').exists()).toBe(false)
    await first.setValue('two')
    expect(wrapper.find('[data-testid=comparison-delta]').exists()).toBe(false)
  })
  it('does not render report selectors when fewer than two valid records exist', async () => {
    vi.mocked(getWorkspaceTrends).mockResolvedValue(
      page([group({ points: [point('only', 40, 10)] })], 1),
    )
    const wrapper = mountTrends()
    await flushPromises()
    expect(wrapper.find('[data-testid=comparison-first]').exists()).toBe(false)
  })
  it('plots only a selected comparable group and links original reports with version context', async () => {
    vi.mocked(getWorkspaceTrends).mockResolvedValue(
      page([group(), group({ blueprint_version: 2, points: [point('three', 65, 13)] })]),
    )
    const wrapper = mountTrends()
    await flushPromises()
    expect(getWorkspaceTrends).toHaveBeenCalledWith({
      organization_id: 'org-one',
      mode: '',
      scenario: '',
      limit: 100,
      offset: 0,
    })
    expect(wrapper.findAll('[data-testid=trend-line]')).toHaveLength(1)
    expect(wrapper.text()).toContain('rasch-v1')
    expect(wrapper.text()).toContain('policy-v1')
    expect(wrapper.findAllComponents(RouterLinkStub).map((link) => link.props('to'))).toContain(
      '/reports/session-one',
    )
    await wrapper.get('[data-testid=trend-group]').setValue('1')
    expect(wrapper.find('[data-testid=trend-line]').exists()).toBe(false)
    expect(wrapper.text()).toContain('只有一次有效记录')
    expect(wrapper.text()).toContain('蓝图 v2')
  })
  it('does not turn invalid or missing evidence into zero or bridge it with a line', async () => {
    vi.mocked(getWorkspaceTrends).mockResolvedValue(
      page(
        [
          group({
            points: [
              point('one', 40, 10),
              { ...point('gap', 0, 11), evidence_count: 0 },
              point('two', 55, 12),
            ],
          }),
        ],
        3,
      ),
    )
    const wrapper = mountTrends()
    await flushPromises()
    expect(wrapper.findAll('[data-testid=trend-point]')).toHaveLength(2)
    expect(wrapper.find('[data-testid=trend-line]').exists()).toBe(false)
    expect(wrapper.text()).toContain('证据不足')
    expect(wrapper.text()).not.toContain('成长百分比')
  })
  it('clears old organization data immediately and ignores stale responses', async () => {
    let resolveOld!: (value: ReturnType<typeof page>) => void
    vi.mocked(getWorkspaceTrends)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve
          }),
      )
      .mockResolvedValueOnce(page([group({ points: [point('new', 62, 14)] })], 1))
    const wrapper = mountTrends()
    await wrapper.setProps({ organizationId: 'org-two' })
    await flushPromises()
    resolveOld(page([group()]))
    await flushPromises()
    expect(wrapper.findAllComponents(RouterLinkStub).map((link) => link.props('to'))).toEqual([
      '/reports/session-new',
    ])
  })
  it('shows actionable errors and reloads without fabricated data', async () => {
    vi.mocked(getWorkspaceTrends)
      .mockRejectedValueOnce(new Error('读取失败'))
      .mockResolvedValueOnce(page([], 0))
    const wrapper = mountTrends()
    await flushPromises()
    expect(wrapper.get('[role=alert]').text()).toContain('读取失败')
    expect(wrapper.find('svg').exists()).toBe(false)
    await wrapper.get('[data-testid=retry-trends]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('暂无可比记录')
  })
  it('makes the report window explicit and pages without joining distinct windows', async () => {
    vi.mocked(getWorkspaceTrends)
      .mockResolvedValueOnce(page([group()], 102))
      .mockResolvedValueOnce(page([group({ points: [point('older', 32, 10)] })], 102, 100))
    const wrapper = mountTrends()
    await flushPromises()
    expect(wrapper.text()).toContain('最近 1–100 / 102 份定稿报告')
    await wrapper.get('[data-testid=older-trends]').trigger('click')
    await flushPromises()
    expect(getWorkspaceTrends).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 100 }))
    expect(wrapper.find('[data-testid=trend-line]').exists()).toBe(false)
    expect(wrapper.text()).toContain('最近 101–102 / 102 份定稿报告')
  })
})
