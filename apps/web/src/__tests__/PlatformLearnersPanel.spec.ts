import { flushPromises, mount } from '@vue/test-utils'
import { reactive } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PlatformLearnersPanel from '../components/PlatformLearnersPanel.vue'
import * as api from '../services/platformLearnersApi'

const context = vi.hoisted(() => ({
  access: null as unknown as {
    ready: boolean
    singlePlatform: boolean
    can: () => boolean
    error: string
    load: () => Promise<void>
  },
}))
vi.mock('../stores/access', () => ({ useAccessStore: () => context.access }))
vi.mock('../services/platformLearnersApi', () => ({
  listLearners: vi.fn(),
  updateLearner: vi.fn(),
}))
const learner = {
  id: 'learner-1',
  username: 'user',
  display_name: '学员',
  email: null,
  affiliation: null,
  specialty: null,
  learning_goal: null,
  is_active: true,
  created_at: '2026-09-22T01:00:00Z',
  updated_at: '2026-09-22T01:00:00Z',
  assessment_count: 2,
}
describe('PlatformLearnersPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    context.access = reactive({
      ready: true,
      singlePlatform: true,
      error: '',
      can: () => true,
      load: vi.fn(async () => {}),
    })
    vi.mocked(api.listLearners).mockResolvedValue({
      items: [learner],
      total: 1,
      limit: 20,
      offset: 0,
    })
    vi.mocked(api.updateLearner).mockResolvedValue(learner)
  })
  it('shows real learner information without role or organization picker', async () => {
    const wrapper = mount(PlatformLearnersPanel)
    await flushPromises()
    expect(wrapper.text()).toContain('user')
    expect(wrapper.text()).toContain('未填写邮箱')
    expect(wrapper.find('input[type=password]').exists()).toBe(false)
    expect(wrapper.find('select[name=role]').exists()).toBe(false)
  })
  it('saves only on explicit submit with original revision', async () => {
    const wrapper = mount(PlatformLearnersPanel)
    await flushPromises()
    await wrapper.get('[data-testid=edit-learner-1]').trigger('click')
    await wrapper.get('#learner-display-name').setValue('新的名称')
    expect(api.updateLearner).not.toHaveBeenCalled()
    await wrapper.get('[data-testid=learner-edit-form]').trigger('submit')
    await flushPromises()
    expect(api.updateLearner).toHaveBeenCalledWith(
      'learner-1',
      expect.objectContaining({
        display_name: '新的名称',
        expected_updated_at: learner.updated_at,
      }),
      expect.any(String),
    )
    expect(wrapper.text()).toContain('学员信息已保存')
  })
  it('fails closed and clears visible records after permission removal', async () => {
    const wrapper = mount(PlatformLearnersPanel)
    await flushPromises()
    context.access.can = () => false
    await flushPromises()
    expect(wrapper.text()).not.toContain('user')
    expect(wrapper.text()).toContain('仅管理员')
  })
  it('keeps server conflicts visible and does not pretend saved', async () => {
    vi.mocked(api.updateLearner).mockRejectedValue(
      new Error('学员信息已被更新，请刷新后重新编辑。'),
    )
    const wrapper = mount(PlatformLearnersPanel)
    await flushPromises()
    await wrapper.get('[data-testid=edit-learner-1]').trigger('click')
    await wrapper.get('[data-testid=learner-edit-form]').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('请刷新后重新编辑')
    expect(wrapper.text()).not.toContain('学员信息已保存')
  })
})
