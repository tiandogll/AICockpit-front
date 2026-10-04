import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ReviewPublicationPanel from '../components/ReviewPublicationPanel.vue'
import * as api from '../services/contentReviewApi'
import { ApiError } from '../services/apiClient'
import type {
  PublicationPreview,
  PublicationReceipt,
  ReviewStatus,
} from '../services/contentReviewApi'

const state = vi.hoisted(() => ({
  auth: { user: { id: 'admin' }, isAuthenticated: true },
  access: {
    ready: true,
    error: '',
    organizationId: 'org-1',
    role: 'admin',
    organizations: [{ id: 'org-1', name: '平台组织' }],
    globalCapabilities: ['content'],
    can: (_cap: string): boolean => false,
  },
}))
vi.mock('../stores/auth', () => ({ useAuthStore: () => state.auth }))
vi.mock('../stores/access', () => ({ useAccessStore: () => state.access }))
vi.mock('../services/contentReviewApi', () => ({
  getPublicationPreview: vi.fn(),
  publishContentReview: vi.fn(),
}))
const receipt: PublicationReceipt = {
  item_version_id: 'formal-item-1',
  rubric_version_id: 'rubric-1',
  published_at: '2026-09-29T00:00:00Z',
  targets: [{ previous_blueprint_id: 'plan-1', blueprint_id: 'plan-1-v2', name: '标准自测' }],
}
const preview: PublicationPreview = {
  packet_id: 'packet-1',
  digest: 'digest-1',
  eligible: true,
  issues: [],
  preview_token: 'preview-1',
  publication: null,
  targets: [
    {
      blueprint_id: 'plan-1',
      name: '标准自测',
      mode: 'standard',
      scenario: 'general',
      version: 1,
      pool_size: 24,
      organization_names: ['平台组织'],
      eligible: true,
      reason: null,
    },
    {
      blueprint_id: 'plan-2',
      name: '专项自测',
      mode: 'quick',
      scenario: 'general',
      version: 3,
      pool_size: 12,
      organization_names: ['平台组织'],
      eligible: true,
      reason: null,
    },
    {
      blueprint_id: 'fixed-plan',
      name: '固定试卷',
      mode: 'standard',
      scenario: 'general',
      version: 2,
      pool_size: 10,
      organization_names: ['平台组织'],
      eligible: false,
      reason: '固定试卷不接收动态题池发布',
    },
  ],
}
const wrappers: VueWrapper[] = []
function render(status: ReviewStatus = 'reviewed') {
  const wrapper = mount(ReviewPublicationPanel, {
    props: {
      packetId: 'packet-1',
      digest: 'digest-1',
      status,
      code: 'A01-R1',
      revision: 1,
      approvalCount: 1,
      requiredApprovals: 1,
    },
  })
  wrappers.push(wrapper)
  return wrapper
}
async function prepare(wrapper: VueWrapper) {
  await flushPromises()
  await wrapper.get('[data-testid=publication-target-plan-1]').setValue(true)
  await wrapper.get('[data-testid=publication-prepare]').trigger('click')
}
beforeEach(() => {
  vi.resetAllMocks()
  state.auth = reactive({ user: { id: 'admin' }, isAuthenticated: true })
  state.access = reactive({
    ready: true,
    error: '',
    organizationId: 'org-1',
    role: 'admin',
    organizations: [{ id: 'org-1', name: '平台组织' }],
    globalCapabilities: ['content'],
    can: (cap: string) => state.access.role === 'admin' && cap === 'content',
  })
  vi.mocked(api.getPublicationPreview).mockResolvedValue(structuredClone(preview))
  vi.mocked(api.publishContentReview).mockResolvedValue(structuredClone(receipt))
})
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  vi.restoreAllMocks()
})

describe('formal review publication', () => {
  it('requires explicit compatible plan selection and confirmation, then displays the receipt', async () => {
    const wrapper = render()
    await flushPromises()
    expect(wrapper.text()).toContain('审核通过 · 尚未正式发布')
    expect(wrapper.find('[data-testid=publication-target-fixed-plan]').exists()).toBe(false)
    await wrapper.get('[data-testid=publication-excluded-toggle]').trigger('click')
    expect(wrapper.text()).toContain('固定试卷不接收动态题池发布')
    expect(
      wrapper.get('[data-testid=publication-target-fixed-plan]').attributes('disabled'),
    ).toBeDefined()
    expect(wrapper.get('[data-testid=publication-prepare]').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('24 道')
    expect(wrapper.text()).toContain('所有符合计划范围的学员')
    expect(wrapper.text()).toContain('不保证每次都抽到')
    await prepare(wrapper)
    expect(api.publishContentReview).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid=publication-confirmation]').text()).toContain('标准自测')
    expect(wrapper.get('[data-testid=publication-confirmation]').text()).not.toContain('专项自测')
    await wrapper.get('[data-testid=publication-confirm]').trigger('click')
    await flushPromises()
    expect(api.publishContentReview).toHaveBeenCalledWith(
      'packet-1',
      {
        expected_digest: 'digest-1',
        preview_token: 'preview-1',
        blueprint_ids: ['plan-1'],
      },
      expect.any(String),
    )
    expect(wrapper.text()).toContain('正式已发布')
    expect(wrapper.text()).toContain('plan-1-v2')
    expect(wrapper.text()).not.toContain('尚未正式发布')
    expect(wrapper.find('[data-testid=publication-confirm]').exists()).toBe(false)
  })
  it('keeps compatible targets visible and folds 1600 excluded plans into bounded pages', async () => {
    const excluded = Array.from({ length: 1600 }, (_, index) => ({
      blueprint_id: `legacy-${index}`,
      name: `历史计划 ${index}`,
      mode: 'fixed',
      scenario: 'general',
      version: 1,
      pool_size: 0,
      organization_names: ['平台组织'],
      eligible: false,
      reason: '未配置可发布题池',
    }))
    vi.mocked(api.getPublicationPreview).mockResolvedValue({
      ...preview,
      targets: [...excluded, ...preview.targets.filter((target) => target.eligible)],
    })
    const wrapper = render()
    await flushPromises()
    expect(wrapper.findAll('input[type=checkbox]')).toHaveLength(2)
    expect(wrapper.find('[data-testid=publication-target-plan-1]').exists()).toBe(true)
    expect(wrapper.text()).toContain('查看不可选计划（1600）')
    expect(wrapper.text()).not.toContain('历史计划 0')
    await wrapper.get('[data-testid=publication-target-plan-1]').setValue(true)
    await wrapper.get('[data-testid=publication-excluded-toggle]').trigger('click')
    expect(
      wrapper.get('[data-testid=publication-excluded-toggle]').attributes('aria-expanded'),
    ).toBe('true')
    expect(wrapper.findAll('input[type=checkbox]')).toHaveLength(22)
    expect(
      wrapper.get('[data-testid=publication-target-legacy-0]').attributes('disabled'),
    ).toBeDefined()
    expect(wrapper.text()).toContain('未配置可发布题池')
    expect(wrapper.find('[data-testid=publication-target-legacy-20]').exists()).toBe(false)
    await wrapper.get('[data-testid=publication-excluded-next]').trigger('click')
    expect(wrapper.findAll('input[type=checkbox]')).toHaveLength(22)
    expect(wrapper.find('[data-testid=publication-target-legacy-0]').exists()).toBe(false)
    expect(wrapper.find('[data-testid=publication-target-legacy-20]').exists()).toBe(true)
    expect(wrapper.get('[data-testid=publication-prepare]').attributes('disabled')).toBeUndefined()
    await wrapper.get('[data-testid=publication-excluded-toggle]').trigger('click')
    expect(wrapper.findAll('input[type=checkbox]')).toHaveLength(2)
    await wrapper.get('[data-testid=publication-excluded-toggle]').trigger('click')
    expect(wrapper.find('[data-testid=publication-target-legacy-0]').exists()).toBe(true)
    expect(api.publishContentReview).not.toHaveBeenCalled()
  })
  it('reads an existing publication receipt without offering a second publication', async () => {
    vi.mocked(api.getPublicationPreview).mockResolvedValue({ ...preview, publication: receipt })
    const wrapper = render()
    await flushPromises()
    expect(wrapper.text()).toContain('正式已发布')
    expect(wrapper.find('[data-testid=publication-prepare]').exists()).toBe(false)
    expect(api.publishContentReview).not.toHaveBeenCalled()
    expect(wrapper.emitted('published')).toBeUndefined()
  })
  it.each(['teacher', 'learner'])('does not read publication targets for a %s', async (role) => {
    state.access.role = role
    const wrapper = render()
    await flushPromises()
    expect(api.getPublicationPreview).not.toHaveBeenCalled()
    expect(wrapper.find('section').exists()).toBe(false)
  })
  it.each<ReviewStatus>(['pending', 'in_review', 'changes_requested', 'superseded'])(
    'blocks publication for %s',
    async (status) => {
      const wrapper = render(status)
      await flushPromises()
      expect(api.getPublicationPreview).toHaveBeenCalledWith('packet-1')
      expect(wrapper.find('[data-testid=publication-confirm]').exists()).toBe(false)
      expect(wrapper.find('[data-testid=publication-prepare]').exists()).toBe(false)
      expect(wrapper.text()).toContain('不能正式发布')
    },
  )
  it.each<ReviewStatus>(['changes_requested', 'superseded'])(
    'keeps the historical formal publication visible after the review becomes %s',
    async (status) => {
      vi.mocked(api.getPublicationPreview).mockResolvedValue({
        ...preview,
        eligible: false,
        issues: ['当前审核稿不满足新增发布条件'],
        publication: receipt,
      })
      const wrapper = render(status)
      await flushPromises()
      expect(api.getPublicationPreview).toHaveBeenCalledWith('packet-1')
      expect(wrapper.text()).toContain('正式已发布')
      expect(wrapper.text()).toContain('plan-1-v2')
      expect(wrapper.text()).not.toContain('尚未正式发布')
      expect(wrapper.find('[data-testid=publication-prepare]').exists()).toBe(false)
      expect(api.publishContentReview).not.toHaveBeenCalled()
    },
  )
  it('refreshes historical publication on review status change without automatically publishing', async () => {
    const wrapper = render()
    await prepare(wrapper)
    vi.mocked(api.getPublicationPreview).mockResolvedValue({
      ...preview,
      eligible: false,
      publication: receipt,
    })
    await wrapper.setProps({ status: 'superseded' })
    await flushPromises()
    expect(api.getPublicationPreview).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('正式已发布')
    expect(wrapper.find('[data-testid=publication-confirm]').exists()).toBe(false)
    expect(api.publishContentReview).not.toHaveBeenCalled()
  })
  it('shows failed preview as unknown, never as unpublished or publishable', async () => {
    vi.mocked(api.getPublicationPreview).mockRejectedValue(new Error('预览读取失败'))
    const wrapper = render()
    await flushPromises()
    expect(wrapper.text()).toContain('预览读取失败')
    expect(wrapper.text()).not.toContain('尚未正式发布')
    expect(wrapper.find('[data-testid=publication-prepare]').exists()).toBe(false)
  })
  it('honors backend eligibility and reports issues', async () => {
    vi.mocked(api.getPublicationPreview).mockResolvedValue({
      ...preview,
      eligible: false,
      issues: ['已有退回意见，请重新审稿'],
    })
    const wrapper = render()
    await flushPromises()
    expect(wrapper.text()).toContain('已有退回意见')
    expect(wrapper.get('[data-testid=publication-prepare]').attributes('disabled')).toBeDefined()
  })
  it('freezes a failed unknown request and retries its exact payload and key', async () => {
    vi.mocked(api.publishContentReview).mockRejectedValueOnce(new Error('网络中断'))
    const wrapper = render()
    await prepare(wrapper)
    await wrapper.get('[data-testid=publication-confirm]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('重试同一次发布')
    expect(
      wrapper.get('[data-testid=publication-target-plan-2]').attributes('disabled'),
    ).toBeDefined()
    expect(wrapper.find('[data-testid=publication-cancel]').exists()).toBe(false)
    expect(wrapper.get('[data-testid=publication-refresh]').attributes('disabled')).toBeDefined()
    await wrapper.get('[data-testid=publication-confirm]').trigger('click')
    await flushPromises()
    expect(vi.mocked(api.publishContentReview).mock.calls[0]).toEqual(
      vi.mocked(api.publishContentReview).mock.calls[1],
    )
  })
  it.each([409, 422])(
    'invalidates a definitive HTTP %s failure and requires a fresh preview and confirmation',
    async (status) => {
      vi.mocked(api.publishContentReview).mockRejectedValueOnce(
        new ApiError('计划或题池需重新核对', status),
      )
      const wrapper = render()
      await prepare(wrapper)
      await wrapper.get('[data-testid=publication-confirm]').trigger('click')
      await flushPromises()
      expect(wrapper.text()).toContain('重新读取发布预览')
      expect(wrapper.find('[data-testid=publication-confirm]').exists()).toBe(false)
      expect(api.getPublicationPreview).toHaveBeenCalledTimes(1)
      expect(api.publishContentReview).toHaveBeenCalledTimes(1)
      await wrapper.get('[data-testid=publication-refresh]').trigger('click')
      await flushPromises()
      expect(wrapper.get('[data-testid=publication-prepare]').attributes('disabled')).toBeDefined()
    },
  )
  it('emits a busy lock and prevents double submit', async () => {
    let finish!: (value: PublicationReceipt) => void
    vi.mocked(api.publishContentReview).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const wrapper = render()
    await prepare(wrapper)
    await wrapper.get('[data-testid=publication-confirm]').trigger('click')
    await wrapper.get('[data-testid=publication-confirm]').trigger('click')
    expect(api.publishContentReview).toHaveBeenCalledTimes(1)
    expect(wrapper.emitted('busy')?.slice(-1)[0]).toEqual([true])
    finish(receipt)
    await flushPromises()
    expect(wrapper.emitted('busy')?.slice(-1)[0]).toEqual([false])
  })
  it.each([401, 403, 404])(
    'clears sensitive preview and informs parent on HTTP %s',
    async (status) => {
      vi.mocked(api.publishContentReview).mockRejectedValue(new ApiError('revoked', status))
      const wrapper = render()
      await prepare(wrapper)
      await wrapper.get('[data-testid=publication-confirm]').trigger('click')
      await flushPromises()
      expect(wrapper.text()).not.toContain('标准自测')
      expect(wrapper.emitted('access-revoked')).toHaveLength(1)
    },
  )
  it('discards stale preview results on scope change', async () => {
    let finish!: (value: PublicationPreview) => void
    vi.mocked(api.getPublicationPreview).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const wrapper = render()
    vi.mocked(api.getPublicationPreview).mockResolvedValue({
      ...preview,
      targets: [],
      eligible: false,
    })
    state.access.organizationId = 'org-2'
    finish(preview)
    await flushPromises()
    expect(wrapper.text()).not.toContain('标准自测')
  })
  it('loads the approved preview after an in-progress review save unlocks the parent', async () => {
    const wrapper = mount(ReviewPublicationPanel, {
      props: {
        packetId: 'packet-1',
        digest: 'digest-1',
        status: 'reviewed',
        code: 'A01-R1',
        revision: 1,
        approvalCount: 1,
        requiredApprovals: 1,
        disabled: true,
      },
    })
    wrappers.push(wrapper)
    await flushPromises()
    expect(api.getPublicationPreview).not.toHaveBeenCalled()
    await wrapper.setProps({ disabled: false })
    await flushPromises()
    expect(api.getPublicationPreview).toHaveBeenCalledTimes(1)
  })
  it('clears a pending intent and rejects a late publication receipt after demotion', async () => {
    let finish!: (value: PublicationReceipt) => void
    vi.mocked(api.publishContentReview).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const wrapper = render()
    await prepare(wrapper)
    await wrapper.get('[data-testid=publication-confirm]').trigger('click')
    state.access.role = 'teacher'
    finish(receipt)
    await flushPromises()
    expect(wrapper.find('section').exists()).toBe(false)
    expect(wrapper.emitted('publication')?.some((event) => event[0] === receipt)).not.toBe(true)
  })
})
