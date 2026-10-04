import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { reactive } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MembersView from '../views/MembersView.vue'
import { useAuthStore } from '../stores/auth'
import * as api from '../services/adminWorkspaceApi'

const context = vi.hoisted(() => ({
  access: null as unknown as {
    organizationId: string
    organization: { name: string }
    ready: boolean
    loading: boolean
    error: string
    allowed: boolean
    can: () => boolean
    load: () => Promise<void>
  },
}))
vi.mock('../stores/access', () => ({ useAccessStore: () => context.access }))
vi.mock('../services/adminWorkspaceApi', () => ({
  listOrganizationMembers: vi.fn<typeof api.listOrganizationMembers>(),
  listAdminCohorts: vi.fn<typeof api.listAdminCohorts>(),
  addOrganizationMember: vi.fn<typeof api.addOrganizationMember>(),
  changeOrganizationRole: vi.fn<typeof api.changeOrganizationRole>(),
  createAdminCohort: vi.fn<typeof api.createAdminCohort>(),
  assignCohortMember: vi.fn<typeof api.assignCohortMember>(),
}))
const member = {
  membership_id: 'membership-1',
  user_id: 'user-1',
  display_name: '合成学员',
  email: 'learner@example.test',
  role: 'learner' as const,
  is_active: true,
}

describe('MembersView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    context.access = reactive({
      organizationId: 'org-1',
      organization: { name: '合成组织' },
      ready: true,
      loading: false,
      error: '',
      allowed: true,
      can() {
        return this.allowed
      },
      load: vi.fn<() => Promise<void>>(async () => {}),
    })
    vi.mocked(api.listOrganizationMembers).mockResolvedValue([member])
    vi.mocked(api.listAdminCohorts).mockResolvedValue([])
  })
  it('uses persisted members and exposes only existing organization roles', async () => {
    const wrapper = mount(MembersView)
    await flushPromises()
    expect(wrapper.text()).toContain('合成学员')
    expect(wrapper.text()).toContain('暂无班级或部门')
    expect(wrapper.find('input[type="password"]').exists()).toBe(false)
    expect(wrapper.findAll('option[value="system_admin"]').length).toBe(0)
    expect(api.listOrganizationMembers).toHaveBeenCalledWith('org-1')
  })
  it('fails closed without member permission and makes no member requests', async () => {
    context.access.allowed = false
    const wrapper = mount(MembersView)
    await flushPromises()
    expect(wrapper.text()).toContain('没有成员管理权限')
    expect(api.listOrganizationMembers).not.toHaveBeenCalled()
  })
  it('shows a username and truthful placeholder for members without email', async () => {
    vi.mocked(api.listOrganizationMembers).mockResolvedValue([
      { ...member, email: null, username: 'learner.demo' },
    ])
    const wrapper = mount(MembersView)
    await flushPromises()
    expect(wrapper.text()).toContain('learner.demo')
    expect(wrapper.text()).toContain('未填写邮箱')
    expect(wrapper.text()).not.toContain('null')
  })
  it('clears old organization members and ignores delayed responses', async () => {
    let resolve!: (value: (typeof member)[]) => void
    vi.mocked(api.listOrganizationMembers)
      .mockReturnValueOnce(
        new Promise((value) => {
          resolve = value
        }),
      )
      .mockResolvedValueOnce([])
    const wrapper = mount(MembersView)
    await flushPromises()
    context.access.organizationId = 'org-2'
    await flushPromises()
    resolve([member])
    await flushPromises()
    expect(wrapper.text()).not.toContain('合成学员')
    expect(wrapper.text()).toContain('暂无组织成员')
  })
  it('saves the selected role only on explicit save', async () => {
    vi.mocked(api.changeOrganizationRole).mockResolvedValue({ ...member, role: 'evaluator' })
    const wrapper = mount(MembersView)
    await flushPromises()
    await wrapper.get('[data-testid="role-user-1"]').setValue('evaluator')
    expect(api.changeOrganizationRole).not.toHaveBeenCalled()
    await wrapper.get('[data-testid="save-role-user-1"]').trigger('click')
    await flushPromises()
    expect(api.changeOrganizationRole).toHaveBeenCalledWith('org-1', 'user-1', 'evaluator')
  })
  it('keeps an unsuccessful self-role change error visible', async () => {
    useAuthStore().user = {
      id: member.user_id,
      display_name: member.display_name,
      email: member.email,
      is_active: true,
    }
    vi.mocked(api.changeOrganizationRole).mockRejectedValueOnce(
      new Error('最后一位组织管理员不能降级'),
    )
    const wrapper = mount(MembersView)
    await flushPromises()
    await wrapper.get('[data-testid="role-user-1"]').setValue('evaluator')
    await wrapper.get('[data-testid="save-role-user-1"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('最后一位组织管理员不能降级')
    expect(context.access.load).not.toHaveBeenCalledWith(true)
  })
})
