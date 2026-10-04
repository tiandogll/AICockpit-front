import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ResumeProgress from '../components/ResumeProgress.vue'
import { getWorkspaceOverview, type WorkspaceOverview } from '../services/workspaceApi'

vi.mock('../services/workspaceApi', () => ({ getWorkspaceOverview: vi.fn() }))
const overview = (id: string, answered: number) =>
  ({ active_sessions: [{ id, answered, max_items: 18, last_saved_at: null }] }) as WorkspaceOverview
describe('resume progress', () => {
  beforeEach(() => vi.clearAllMocks())
  it('uses server counts and never invents a save time or CAT completion rate', async () => {
    vi.mocked(getWorkspaceOverview).mockResolvedValue(overview('s1', 11))
    const wrapper = mount(ResumeProgress, {
      props: { organizationId: 'o1', sessionId: 's1', mode: 'standard' },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('暂无保存时间')
    expect(wrapper.text()).toContain('已答 11 题 / 最多 18 题')
    expect(wrapper.get('progress').attributes('aria-label')).toContain('并非确定完成率')
    wrapper.unmount()
  })
  it('retries a failed read without a write operation', async () => {
    vi.mocked(getWorkspaceOverview)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(overview('s1', 3))
    const wrapper = mount(ResumeProgress, {
      props: { organizationId: 'o1', sessionId: 's1', mode: 'fixed' },
    })
    await flushPromises()
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(getWorkspaceOverview).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('已答 3 题 / 共 18 题')
    wrapper.unmount()
  })
  it('ignores a late response from the previous organization', async () => {
    let resolveOld!: (value: WorkspaceOverview) => void
    vi.mocked(getWorkspaceOverview)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveOld = resolve
        }),
      )
      .mockResolvedValueOnce(overview('s2', 2))
    const wrapper = mount(ResumeProgress, {
      props: { organizationId: 'o1', sessionId: 's1', mode: 'standard' },
    })
    await wrapper.setProps({ organizationId: 'o2', sessionId: 's2' })
    await flushPromises()
    resolveOld(overview('s1', 17))
    await flushPromises()
    expect(wrapper.text()).toContain('已答 2 题')
    expect(wrapper.text()).not.toContain('17')
    wrapper.unmount()
  })
})
