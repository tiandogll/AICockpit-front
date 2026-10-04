import { flushPromises, mount } from '@vue/test-utils'
import { reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AuthoringView from '../views/AuthoringView.vue'
import * as api from '../services/authoringApi'
import type { ContentRecord } from '../services/contentApi'
import { ApiError } from '../services/apiClient'

const state = vi.hoisted(() => ({
  auth: null as unknown as { user: { id: string } | null; isAuthenticated: boolean },
  access: null as unknown as {
    ready: boolean
    error: string
    organizationId: string
    allowed: boolean
    can: (cap: string) => boolean
  },
  leave: null as unknown as () => boolean,
}))
vi.mock('../stores/auth', () => ({ useAuthStore: () => state.auth }))
vi.mock('../stores/access', () => ({ useAccessStore: () => state.access }))
vi.mock('vue-router', () => ({
  onBeforeRouteLeave: (guard: () => boolean) => {
    state.leave = guard
  },
}))
vi.mock('../services/authoringApi', () => ({
  listAssignedItems: vi.fn<typeof api.listAssignedItems>(),
  getAssignedItem: vi.fn<typeof api.getAssignedItem>(),
  createAssignedVersion: vi.fn<typeof api.createAssignedVersion>(),
  listAssignedRubrics: vi.fn<typeof api.listAssignedRubrics>(),
  submitAssignedItem: vi.fn<typeof api.submitAssignedItem>(),
}))
const item: ContentRecord = {
  id: 'source-1',
  logical_id: 'logical-1',
  version: 2,
  publication_status: 'draft',
  stem: '指派的来源核验题',
  dimension_code: 'evaluation',
  item_type: 'objective',
  difficulty: 0,
  configuration: { options: ['甲', '乙'] },
  answer_key: { correct_option: '甲' },
  created_at: '',
  updated_at: '',
  approved_at: null,
  approved_by: null,
}
const page = { items: [item], total: 1, limit: 20, offset: 0 }
const wrappers: ReturnType<typeof mount>[] = []
function render() {
  const wrapper = mount(AuthoringView)
  wrappers.push(wrapper)
  return wrapper
}
describe('assigned authoring tasks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.auth = reactive({ user: { id: 'teacher' }, isAuthenticated: true })
    state.access = reactive({
      ready: true,
      error: '',
      organizationId: 'school',
      allowed: true,
      can: (cap: string) => state.access.allowed && cap === 'content_author',
    })
    vi.mocked(api.listAssignedItems).mockResolvedValue(page)
    vi.mocked(api.getAssignedItem).mockResolvedValue(item)
    vi.mocked(api.listAssignedRubrics).mockResolvedValue({
      items: [],
      total: 0,
      limit: 20,
      offset: 0,
    })
    vi.mocked(api.createAssignedVersion).mockResolvedValue({ ...item, id: 'new-draft', version: 3 })
    vi.mocked(api.submitAssignedItem).mockResolvedValue({
      ...item,
      publication_status: 'in_review',
    })
  })
  afterEach(() => {
    wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
    vi.restoreAllMocks()
  })
  it('offers the assigned-review workspace without changing the existing maintenance default', async () => {
    const wrapper = mount(AuthoringView, { global: { stubs: { BankReviewPanel: true } } })
    wrappers.push(wrapper)
    await flushPromises()
    expect(wrapper.find('[data-testid=author-detail]').exists()).toBe(true)
    const tabs = wrapper.findAll('.authoring-tabs button')
    expect(tabs.map((tab) => tab.text())).toEqual(['题目维护', '待审核题目'])
    await tabs[1]!.trigger('click')
    expect(wrapper.find('bank-review-panel-stub').exists()).toBe(true)
    expect(wrapper.find('[data-testid=author-detail]').exists()).toBe(false)
  })
  it('shows assigned versions and successor editing without arbitrary creation or publishing', async () => {
    const wrapper = render()
    await flushPromises()
    expect(wrapper.text()).toContain('我的出题任务')
    expect(wrapper.text()).toContain(item.stem)
    expect(wrapper.text()).not.toContain('审核并发布')
    expect(wrapper.find('[data-testid=new-item]').exists()).toBe(false)
    await wrapper.get('[data-testid=author-detail]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid=author-edit]').trigger('click')
    await wrapper.get('[data-testid=item-tags]').setValue('来源核验, 教师标注')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(api.createAssignedVersion).toHaveBeenCalledWith(
      'source-1',
      expect.objectContaining({
        configuration: expect.objectContaining({
          metadata: expect.objectContaining({ tags: ['来源核验', '教师标注'] }),
        }),
      }),
      expect.stringMatching(/^item-version-/),
    )
    expect(api.submitAssignedItem).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('已保存 v3 草稿')
  })
  it('requires a separate submit confirmation and keeps a failed attempt key for retry', async () => {
    vi.mocked(api.submitAssignedItem).mockRejectedValueOnce(new Error('网络中断，重试可核对结果'))
    const wrapper = render()
    await flushPromises()
    await wrapper.get('[data-testid=author-detail]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid=author-submit]').trigger('click')
    expect(api.submitAssignedItem).not.toHaveBeenCalled()
    await wrapper.get('[data-testid=confirm-author-submit]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('网络中断')
    await wrapper.get('[data-testid=confirm-author-submit]').trigger('click')
    await flushPromises()
    expect(vi.mocked(api.submitAssignedItem).mock.calls[0]?.[1]).toBe(
      vi.mocked(api.submitAssignedItem).mock.calls[1]?.[1],
    )
    expect(wrapper.text()).toContain('已提交审核')
  })
  it('guards unsaved edits on cancellation, route leave and page reload', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const wrapper = render()
    await flushPromises()
    await wrapper.get('[data-testid=author-detail]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid=author-edit]').trigger('click')
    await wrapper.get('[data-testid=item-stem]').setValue('保留教师未保存内容')
    expect(state.leave()).toBe(false)
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '取消编辑')!
      .trigger('click')
    expect(wrapper.find('[data-testid=item-stem]').exists()).toBe(true)
    expect(confirm).toHaveBeenCalled()
  })
  it.each([401, 403, 404])(
    'clears a revoked editor on save %s and rejects late rubrics even with other assignments',
    async (statusCode) => {
      let finishRubrics!: (value: Awaited<ReturnType<typeof api.listAssignedRubrics>>) => void
      vi.mocked(api.getAssignedItem).mockResolvedValue({
        ...item,
        item_type: 'practical',
        rubric_version_id: '11111111-1111-4111-8111-111111111111',
      })
      vi.mocked(api.listAssignedRubrics).mockReturnValueOnce(
        new Promise((resolve) => {
          finishRubrics = resolve
        }),
      )
      vi.mocked(api.createAssignedVersion).mockRejectedValueOnce(
        new ApiError('此题指派已失效', statusCode),
      )
      const wrapper = render()
      await flushPromises()
      await wrapper.get('[data-testid=author-detail]').trigger('click')
      await flushPromises()
      await wrapper.get('[data-testid=author-edit]').trigger('click')
      await wrapper.get('[data-testid=item-stem]').setValue('用户未保存的草稿内容')
      expect(api.listAssignedRubrics).toHaveBeenCalledTimes(1)
      await wrapper.get('form').trigger('submit')
      await flushPromises()
      expect(api.createAssignedVersion).toHaveBeenCalledTimes(1)
      expect(state.access.can('content_author')).toBe(true)
      expect(wrapper.find('[data-testid=item-stem]').exists()).toBe(false)
      expect(wrapper.text()).toContain('未保存草稿已清除')
      expect(wrapper.text()).not.toContain(item.stem)
      expect(wrapper.text()).not.toContain('用户未保存的草稿内容')
      finishRubrics({
        items: [{ ...item, title: '已撤销范围的迟到量规' }],
        total: 1,
        limit: 20,
        offset: 0,
      })
      await flushPromises()
      expect(wrapper.text()).not.toContain('已撤销范围的迟到量规')
      expect(wrapper.find('[data-testid=item-rubric]').exists()).toBe(false)
      expect(state.leave()).toBe(true)
    },
  )
  it.each([401, 403, 404])(
    'invalidates the edit epoch on rubric %s and discards an in-flight save result',
    async (statusCode) => {
      let rejectRubrics!: (reason: Error) => void
      let finishSave!: (value: Awaited<ReturnType<typeof api.createAssignedVersion>>) => void
      vi.mocked(api.getAssignedItem).mockResolvedValue({
        ...item,
        item_type: 'practical',
        rubric_version_id: '11111111-1111-4111-8111-111111111111',
      })
      vi.mocked(api.listAssignedRubrics).mockReturnValueOnce(
        new Promise((_, reject) => {
          rejectRubrics = reject
        }),
      )
      vi.mocked(api.createAssignedVersion).mockReturnValueOnce(
        new Promise((resolve) => {
          finishSave = resolve
        }),
      )
      const wrapper = render()
      await flushPromises()
      await wrapper.get('[data-testid=author-detail]').trigger('click')
      await flushPromises()
      await wrapper.get('[data-testid=author-edit]').trigger('click')
      await wrapper.get('form').trigger('submit')
      expect(api.createAssignedVersion).toHaveBeenCalledTimes(1)
      rejectRubrics(new ApiError('关联量规权限已失效', statusCode))
      await flushPromises()
      expect(wrapper.find('[data-testid=item-stem]').exists()).toBe(false)
      expect(wrapper.text()).toContain('未保存草稿已清除')
      finishSave({ ...item, id: 'late-version', version: 90 })
      await flushPromises()
      expect(wrapper.text()).not.toContain('已保存 v90 草稿')
      expect(api.getAssignedItem).toHaveBeenCalledTimes(1)
      expect(api.listAssignedItems).toHaveBeenCalledTimes(1)
      expect(wrapper.find('[data-testid=author-edit]').exists()).toBe(false)
    },
  )
  it.each(['actor', 'organization', 'ready', 'error', 'capability', 'logout'])(
    'clears sensitive data and ignores late details when %s changes',
    async (change) => {
      let finish!: (value: ContentRecord) => void
      vi.mocked(api.getAssignedItem).mockReturnValue(
        new Promise((resolve) => {
          finish = resolve
        }),
      )
      const wrapper = render()
      await flushPromises()
      await wrapper.get('[data-testid=author-detail]').trigger('click')
      vi.mocked(api.listAssignedItems).mockResolvedValue({ ...page, items: [], total: 0 })
      if (change === 'actor') state.auth.user = { id: 'someone-else' }
      if (change === 'organization') state.access.organizationId = 'other-school'
      if (change === 'ready') state.access.ready = false
      if (change === 'error') state.access.error = '权限读取失败'
      if (change === 'capability') state.access.allowed = false
      if (change === 'logout') state.auth.isAuthenticated = false
      finish({ ...item, stem: '不可泄露的晚到题干' })
      await flushPromises()
      expect(wrapper.text()).not.toContain('不可泄露的晚到题干')
      expect(wrapper.text()).not.toContain(item.stem)
      expect(wrapper.find('[data-testid=author-edit]').exists()).toBe(false)
    },
  )
  it('fails closed without a capability and distinguishes empty tasks from a loading error', async () => {
    state.access.allowed = false
    const wrapper = render()
    await flushPromises()
    expect(api.listAssignedItems).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('尚无题目维护权限')
    vi.mocked(api.listAssignedItems).mockRejectedValueOnce(new Error('服务器不可用'))
    state.access.allowed = true
    await flushPromises()
    expect(wrapper.text()).toContain('服务器不可用')
    expect(wrapper.text()).not.toContain('暂无指派题目')
  })
})
