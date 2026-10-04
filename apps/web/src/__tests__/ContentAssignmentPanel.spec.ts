import { flushPromises, mount } from '@vue/test-utils'
import { reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ContentAssignmentPanel from '../components/ContentAssignmentPanel.vue'
import * as api from '../services/authoringApi'
const state = vi.hoisted(() => ({
  auth: null as unknown as { user: { id: string }; isAuthenticated: boolean },
  access: null as unknown as {
    ready: boolean
    error: string
    organizationId: string
    allowed: boolean
    can: (cap: string) => boolean
  },
}))
vi.mock('../stores/auth', () => ({ useAuthStore: () => state.auth }))
vi.mock('../stores/access', () => ({ useAccessStore: () => state.access }))
vi.mock('../services/authoringApi', () => ({
  listItemAssignments: vi.fn<typeof api.listItemAssignments>(),
  setItemAssignment: vi.fn<typeof api.setItemAssignment>(),
}))
const teacher = {
  id: 'assignment-1',
  user_id: '11111111-1111-4111-8111-111111111111',
  display_name: '授课教师',
  item_logical_id: 'logical-1',
  active: true,
  assigned_by: 'admin',
  created_at: '',
  updated_at: '',
}
const wrappers: ReturnType<typeof mount>[] = []
function render() {
  const wrapper = mount(ContentAssignmentPanel, { props: { itemId: 'item-1' } })
  wrappers.push(wrapper)
  return wrapper
}
describe('administrator item assignment panel', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    state.auth = reactive({ user: { id: 'admin' }, isAuthenticated: true })
    state.access = reactive({
      ready: true,
      error: '',
      organizationId: 'org-1',
      allowed: true,
      can: (cap: string) => cap === 'content' && state.access.allowed,
    })
    vi.mocked(api.listItemAssignments).mockResolvedValue([teacher])
    vi.mocked(api.setItemAssignment).mockResolvedValue(teacher)
  })
  afterEach(() => {
    wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  })
  it('requires an existing user UUID and confirmation, keeps retry keys, and exposes no invitation or global role control', async () => {
    vi.mocked(api.setItemAssignment).mockRejectedValueOnce(new Error('重试本次指派'))
    const wrapper = render()
    await flushPromises()
    await wrapper.get('[data-testid=assignment-user]').setValue('teacher@example.test')
    await wrapper.get('form').trigger('submit')
    expect(api.setItemAssignment).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('完整用户 ID')
    await wrapper.get('[data-testid=assignment-user]').setValue(teacher.user_id)
    await wrapper.get('form').trigger('submit')
    expect(api.setItemAssignment).not.toHaveBeenCalled()
    await wrapper.get('[data-testid=confirm-assignment]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('重试本次指派')
    await wrapper.get('[data-testid=confirm-assignment]').trigger('click')
    await flushPromises()
    const calls = vi.mocked(api.setItemAssignment).mock.calls
    expect(calls[0]?.slice(0, 3)).toEqual(['item-1', teacher.user_id, true])
    expect(calls[0]?.[3]).toBe(calls[1]?.[3])
    expect(wrapper.text()).toContain('不会授予全库管理或发布权限')
  })
  it('confirms revocation before applying active=false', async () => {
    const wrapper = render()
    await flushPromises()
    await wrapper.get('[data-testid=revoke-assignment]').trigger('click')
    expect(api.setItemAssignment).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('确认撤销')
    await wrapper.get('[data-testid=confirm-assignment]').trigger('click')
    await flushPromises()
    expect(api.setItemAssignment).toHaveBeenCalledWith(
      'item-1',
      teacher.user_id,
      false,
      expect.any(String),
    )
  })
  it.each([
    { requestedActive: false, currentActive: true, stateText: '维护权限仍有效' },
    { requestedActive: true, currentActive: false, stateText: '维护权限当前无效' },
  ])(
    'reports current active=$currentActive after a superseded retry instead of claiming active=$requestedActive',
    async ({ requestedActive, currentActive, stateText }) => {
      const currentAssignment = { ...teacher, active: currentActive }
      vi.mocked(api.listItemAssignments).mockResolvedValue([currentAssignment])
      vi.mocked(api.setItemAssignment)
        .mockRejectedValueOnce(new Error('首次响应丢失，请重试'))
        .mockResolvedValueOnce(currentAssignment)
        .mockResolvedValueOnce({ ...teacher, active: requestedActive })
      const wrapper = render()
      const action = requestedActive ? 'restore-assignment' : 'revoke-assignment'
      await flushPromises()
      await wrapper.get(`[data-testid=${action}]`).trigger('click')
      await wrapper.get('[data-testid=confirm-assignment]').trigger('click')
      await flushPromises()
      await wrapper.get('[data-testid=confirm-assignment]').trigger('click')
      await flushPromises()

      const notice = wrapper.get('.assignment-notice').text()
      expect(notice).toContain('已被后续操作改变')
      expect(notice).toContain(stateText)
      expect(notice).toContain('请重新确认操作')
      expect(notice).not.toContain(
        requestedActive ? '已指派此题的维护任务' : '已撤销此题的维护任务',
      )
      expect(api.listItemAssignments).toHaveBeenCalledTimes(2)
      expect(wrapper.find('[data-testid=confirm-assignment]').exists()).toBe(false)
      const calls = vi.mocked(api.setItemAssignment).mock.calls
      expect(calls).toHaveLength(2)
      expect(calls[0]?.[3]).toBe(calls[1]?.[3])

      await wrapper.get(`[data-testid=${action}]`).trigger('click')
      expect(calls).toHaveLength(2)
      await wrapper.get('[data-testid=confirm-assignment]').trigger('click')
      await flushPromises()
      expect(calls).toHaveLength(3)
      expect(calls[2]?.slice(0, 3)).toEqual(['item-1', teacher.user_id, requestedActive])
      expect(calls[2]?.[3]).not.toBe(calls[1]?.[3])
    },
  )
  it('clears the existing-user field and ignores a late list after item/context change', async () => {
    let finish!: (value: (typeof teacher)[]) => void
    vi.mocked(api.listItemAssignments).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const wrapper = render()
    await wrapper.get('[data-testid=assignment-user]').setValue(teacher.user_id)
    state.access.ready = false
    finish([teacher])
    await flushPromises()
    expect(wrapper.text()).not.toContain(teacher.display_name)
    expect(wrapper.find('[data-testid=assignment-user]').exists()).toBe(false)
  })
})
