import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BankReviewPanel from '../components/BankReviewPanel.vue'
import * as api from '../services/contentReviewApi'
import { ApiError } from '../services/apiClient'
import type { PublicationReceipt, ReviewDetail } from '../services/contentReviewApi'

const state = vi.hoisted(() => ({
  auth: null as unknown as { user: { id: string }; isAuthenticated: boolean },
  access: null as unknown as {
    ready: boolean
    error: string
    organizationId: string
    role: string
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
vi.mock('../services/contentReviewApi', () => ({
  listContentReviews: vi.fn(),
  getContentReview: vi.fn(),
  submitContentReview: vi.fn(),
  getPublicationPreview: vi.fn(),
  publishContentReview: vi.fn(),
}))
const packet: ReviewDetail = {
  id: 'packet-1',
  item_version_id: 'item-1',
  code: 'A01-R1-test',
  original_code: 'A01-test',
  dimension: 'evaluation',
  item_type: 'dialogue',
  stem: '请依据原始资料核查结论。',
  revision: 1,
  digest: 'a'.repeat(64),
  status: 'pending',
  review_count: 0,
  approval_count: 0,
  created_at: '2026-09-20T00:00:00Z',
  can_review: true,
  publication_blocked: true,
  reviews: [],
  revision_content: {
    id: 'A01-R1-test',
    original_id: 'A01-test',
    dimension: 'evaluation',
    item_type: 'dialogue',
    tier: 'basic',
    family: 'source-check',
    change_note: '补充原始记录。',
    source_locator: '参考材料 R1 第2段。',
    stem: '请依据原始资料核查结论。',
    reference_answer: '内部参考答案：不同数据来源不能直接比较。',
    criteria: [
      {
        name: '可执行核验',
        levels: ['无核验', '空泛核验', '部分核验', '完整核验', '完整且可追溯'],
      },
    ],
    examples: [
      {
        label: '合成高分锚例',
        answer: '逐一对应原始记录。',
        scores: [4],
        explanation: '能够追溯原文。',
      },
    ],
    followups: ['缺少原始记录时怎么办？'],
    human_checks: ['核查是否要求过高先修知识。'],
    adaptation: null,
  },
  sources: [
    {
      id: 'R1',
      title: '来源文档',
      authors: '研究者',
      url: 'https://example.test/source',
      version: 'v1',
      use: 'method_reference',
      license: 'reference_only',
      license_url: null,
      license_evidence: '仅参考方法，不复制题目。',
      locator: '第2段',
      limitations: '不能移植原信效度。',
      delivery_rule: '先人审再决定后续试测。',
    },
  ],
}
const page = { items: [packet], total: 1, limit: 20, offset: 0 }
const formalReceipt: PublicationReceipt = {
  item_version_id: 'formal-item',
  rubric_version_id: null,
  published_at: '2026-09-29T00:00:00Z',
  targets: [{ previous_blueprint_id: 'plan-1', blueprint_id: 'plan-v2', name: '正式标准测' }],
}
function mockPublishable() {
  const reviewed: ReviewDetail = {
    ...packet,
    status: 'reviewed',
    publication_status: 'unpublished',
    published_at: null,
  }
  vi.mocked(api.listContentReviews).mockResolvedValue({ ...page, items: [reviewed] })
  vi.mocked(api.getContentReview).mockResolvedValue(reviewed)
  vi.mocked(api.getPublicationPreview).mockResolvedValue({
    packet_id: packet.id,
    digest: packet.digest,
    eligible: true,
    issues: [],
    preview_token: 'preview',
    publication: null,
    targets: [
      {
        blueprint_id: 'plan-1',
        name: '正式标准测',
        mode: 'standard',
        scenario: 'general',
        version: 1,
        pool_size: 24,
        organization_names: ['平台组织'],
        eligible: true,
        reason: null,
      },
    ],
  })
  vi.mocked(api.publishContentReview).mockResolvedValue(formalReceipt)
  return reviewed
}
async function publish(wrapper: VueWrapper) {
  await wrapper.get('[data-testid=publication-target-plan-1]').setValue(true)
  await wrapper.get('[data-testid=publication-prepare]').trigger('click')
  await wrapper.get('[data-testid=publication-confirm]').trigger('click')
}
const wrappers: VueWrapper[] = []
function render() {
  const wrapper = mount(BankReviewPanel, {
    global: { stubs: { ContentAssignmentPanel: true, AdminTrialPanel: true } },
  })
  wrappers.push(wrapper)
  return wrapper
}
async function open(wrapper: VueWrapper) {
  await flushPromises()
  await wrapper.get('[data-testid=bank-review-row]').trigger('click')
  await flushPromises()
}
async function fill(wrapper: VueWrapper, approve = true) {
  if (approve)
    for (const name of ['source', 'answer', 'rubric', 'fairness'])
      await wrapper.get(`[data-testid=review-check-${name}]`).setValue(true)
  else await wrapper.get('input[value=request_changes]').setValue(true)
  await wrapper
    .get('[data-testid=review-comment]')
    .setValue('已核对原始来源，建议补齐数据口径与原文定位。')
  await wrapper.get('form:has([data-testid=review-comment])').trigger('submit')
}
describe('private bank review workspace', () => {
  it('keeps queue controls outside the scroll area and exposes the complete stem', async () => {
    const longStem = '请核对订单原始记录与汇总结果，说明核验依据。'.repeat(15)
    vi.mocked(api.listContentReviews).mockResolvedValue({
      ...page,
      items: [{ ...structuredClone(packet), stem: longStem }],
    })
    const wrapper = render()
    await flushPromises()
    const list = wrapper.get('.queue-list')
    expect(list.attributes('tabindex')).toBe('0')
    expect(list.attributes('aria-label')).toBe('滚动浏览待审题目')
    expect(list.find('.queue-heading').exists()).toBe(false)
    expect(list.find('.review-pagination').exists()).toBe(false)
    expect(wrapper.get('.queue-heading').text()).toContain('共 1 道题')
    expect(list.get('strong').attributes('title')).toBe(longStem)
    await list.get('[data-testid=bank-review-row]').trigger('click')
    await flushPromises()
    expect(api.getContentReview).toHaveBeenCalledWith('packet-1')
    expect(list.get('[data-testid=bank-review-row]').attributes('aria-pressed')).toBe('true')
    expect(api.submitContentReview).not.toHaveBeenCalled()
  })

  beforeEach(() => {
    vi.resetAllMocks()
    state.auth = reactive({ user: { id: 'admin-1' }, isAuthenticated: true })
    state.access = reactive({
      ready: true,
      error: '',
      organizationId: 'org-1',
      role: 'admin',
      can: (cap: string) =>
        state.access.role === 'admin'
          ? cap === 'content'
          : state.access.role === 'teacher'
            ? cap === 'content_author'
            : false,
    })
    vi.mocked(api.listContentReviews).mockResolvedValue(structuredClone(page))
    vi.mocked(api.getContentReview).mockResolvedValue(structuredClone(packet))
    vi.mocked(api.getPublicationPreview).mockResolvedValue({
      packet_id: packet.id,
      digest: packet.digest,
      eligible: true,
      issues: [],
      preview_token: 'preview',
      targets: [],
      publication: null,
    })
    vi.mocked(api.submitContentReview).mockImplementation(async () => {
      const saved: ReviewDetail = {
        ...structuredClone(packet),
        can_review: false,
        status: 'reviewed',
        review_count: 1,
        approval_count: 1,
        required_approvals: 1,
        trial_eligible: true,
      }
      vi.mocked(api.getContentReview).mockResolvedValue(saved)
      return saved
    })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })
  afterEach(() => {
    wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
    vi.restoreAllMocks()
  })
  it('never loads private material for a learner', async () => {
    state.access.role = 'learner'
    const wrapper = render()
    await flushPromises()
    expect(api.listContentReviews).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('学员不可查看答案和量规')
    expect(wrapper.text()).not.toContain(packet.revision_content.reference_answer)
  })
  it('renders independent audit and publication badges from initial server projection, including legacy unknowns', async () => {
    vi.mocked(api.listContentReviews).mockResolvedValue({
      ...page,
      total: 4,
      items: [
        {
          ...packet,
          id: 'published',
          status: 'changes_requested',
          publication_status: 'published',
          published_at: formalReceipt.published_at,
        },
        {
          ...packet,
          id: 'ready',
          status: 'reviewed',
          publication_status: 'unpublished',
          published_at: null,
        },
        { ...packet, id: 'pending', publication_status: 'unpublished', published_at: null },
        { ...packet, id: 'legacy' },
      ],
    })
    const wrapper = render()
    await flushPromises()
    const rows = wrapper.findAll('[data-testid=bank-review-row]')
    expect(rows[0]!.text()).toContain('退回修改')
    expect(rows[0]!.get('[data-testid=review-row-publication-status]').text()).toBe('正式已发布')
    expect(rows[1]!.get('[data-testid=review-row-publication-status]').text()).toBe(
      '审核通过 · 待发布',
    )
    expect(rows[2]!.get('[data-testid=review-row-publication-status]').text()).toBe('未发布')
    expect(rows[3]!.get('[data-testid=review-row-publication-status]').text()).toBe(
      '发布状态未确认',
    )
    expect(api.getPublicationPreview).not.toHaveBeenCalled()
  })
  it('intersects publication and audit filters and resets the offset on apply', async () => {
    vi.mocked(api.listContentReviews).mockResolvedValue({ ...page, total: 41 })
    const wrapper = render()
    await flushPromises()
    await wrapper.findAll('.review-pagination button')[1]!.trigger('click')
    await flushPromises()
    await wrapper.get('.review-filters select').setValue('reviewed')
    await wrapper.get('[data-testid=review-publication-filter]').setValue('ready')
    await wrapper.get('.review-filters').trigger('submit')
    await flushPromises()
    expect(vi.mocked(api.listContentReviews).mock.calls.slice(-1)[0]).toEqual([
      { status: 'reviewed', publication_status: 'ready', dimension: '', item_type: '' },
      0,
    ])
  })
  it('updates the row immediately after publication, then removes it from ready results while keeping its receipt', async () => {
    mockPublishable()
    const wrapper = render()
    await flushPromises()
    await wrapper.get('[data-testid=review-publication-filter]').setValue('ready')
    await wrapper.get('.review-filters').trigger('submit')
    await open(wrapper)
    let finish!: (value: Awaited<ReturnType<typeof api.listContentReviews>>) => void
    vi.mocked(api.listContentReviews).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    await publish(wrapper)
    await flushPromises()
    expect(wrapper.get('[data-testid=review-row-publication-status]').text()).toBe('正式已发布')
    expect(wrapper.get('[data-testid=review-detail-publication-status]').text()).toBe('正式已发布')
    expect(vi.mocked(api.listContentReviews).mock.calls.slice(-1)[0]?.[0].publication_status).toBe(
      'ready',
    )
    finish({ items: [], total: 0, limit: 20, offset: 0 })
    await flushPromises()
    expect(wrapper.find('[data-testid=bank-review-row]').exists()).toBe(false)
    expect(wrapper.get('[data-testid=bank-review-detail]').text()).toContain('plan-v2')
    expect(wrapper.text()).toContain('正式已发布')
    expect(api.publishContentReview).toHaveBeenCalledTimes(1)
  })
  it('keeps server-published status across reopening, changed review status and failed publication preview', async () => {
    const row: ReviewDetail = {
      ...packet,
      status: 'superseded',
      publication_status: 'published',
      published_at: formalReceipt.published_at,
    }
    vi.mocked(api.listContentReviews).mockResolvedValue({ ...page, items: [row] })
    vi.mocked(api.getContentReview).mockResolvedValue(row)
    vi.mocked(api.getPublicationPreview).mockRejectedValue(new Error('预览暂不可用'))
    const wrapper = render()
    await open(wrapper)
    expect(wrapper.get('[data-testid=review-detail-publication-status]').text()).toBe('正式已发布')
    expect(wrapper.get('[data-testid=review-progress]').text()).toContain('已有正式发布记录')
    expect(wrapper.text()).not.toContain('尚未正式发布')
    await wrapper.get('[data-testid=bank-review-row]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid=review-row-publication-status]').text()).toBe('正式已发布')
    expect(api.listContentReviews).toHaveBeenCalledTimes(1)
  })
  it('does not refresh-loop when opening an existing publication receipt', async () => {
    mockPublishable()
    vi.mocked(api.getPublicationPreview).mockResolvedValue({
      packet_id: packet.id,
      digest: packet.digest,
      eligible: false,
      issues: [],
      preview_token: 'preview',
      targets: [],
      publication: formalReceipt,
    })
    const wrapper = render()
    await open(wrapper)
    expect(wrapper.get('[data-testid=review-row-publication-status]').text()).toBe('正式已发布')
    expect(api.listContentReviews).toHaveBeenCalledTimes(1)
    expect(api.publishContentReview).not.toHaveBeenCalled()
  })
  it('preserves published truth when the publication queue refresh fails or returns older data', async () => {
    const reviewed = mockPublishable()
    const wrapper = render()
    await open(wrapper)
    vi.mocked(api.listContentReviews).mockRejectedValueOnce(new Error('queue unavailable'))
    await publish(wrapper)
    await flushPromises()
    expect(wrapper.get('[data-testid=review-row-publication-status]').text()).toBe('正式已发布')
    expect(wrapper.get('[data-testid=review-detail-publication-status]').text()).toBe('正式已发布')
    expect(wrapper.text()).toContain('正式发布已完成，但队列刷新失败')
    vi.mocked(api.listContentReviews).mockResolvedValue({ ...page, items: [reviewed] })
    await wrapper.get('.review-filters').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[data-testid=review-row-publication-status]').text()).toBe('正式已发布')
    await open(wrapper)
    expect(wrapper.get('[data-testid=review-detail-publication-status]').text()).toBe('正式已发布')
    expect(wrapper.text()).not.toContain('尚未正式发布')
    expect(wrapper.find('[data-testid=publication-prepare]').exists()).toBe(false)
    expect(api.publishContentReview).toHaveBeenCalledTimes(1)
  })
  it('corrects an emptied last ready page after publication without losing the selected receipt', async () => {
    const reviewed = mockPublishable()
    vi.mocked(api.listContentReviews)
      .mockResolvedValueOnce({ ...page, items: [reviewed], total: 21 })
      .mockResolvedValueOnce({ ...page, items: [reviewed], total: 21 })
      .mockResolvedValueOnce({ ...page, items: [reviewed], total: 21, offset: 20 })
      .mockResolvedValueOnce({ items: [], total: 20, limit: 20, offset: 20 })
      .mockResolvedValueOnce({
        ...page,
        items: [{ ...reviewed, id: 'another-ready-packet' }],
        total: 20,
      })
    const wrapper = render()
    await flushPromises()
    await wrapper.get('[data-testid=review-publication-filter]').setValue('ready')
    await wrapper.get('.review-filters').trigger('submit')
    await flushPromises()
    await wrapper.findAll('.review-pagination button')[1]!.trigger('click')
    await open(wrapper)
    await publish(wrapper)
    await flushPromises()
    expect(vi.mocked(api.listContentReviews).mock.calls.map((call) => call[1])).toEqual([
      0, 0, 20, 20, 0,
    ])
    expect(vi.mocked(api.listContentReviews).mock.calls.slice(-1)[0]?.[0].publication_status).toBe(
      'ready',
    )
    expect(wrapper.get('.review-pagination').text()).toContain('1 / 1')
    expect(wrapper.get('[data-testid=bank-review-detail]').text()).toContain('plan-v2')
    expect(wrapper.get('[data-testid=review-detail-publication-status]').text()).toBe('正式已发布')
  })
  it('rejects a delayed post-publication queue result after scope revocation', async () => {
    const reviewed = mockPublishable()
    const wrapper = render()
    await open(wrapper)
    let finish!: (value: Awaited<ReturnType<typeof api.listContentReviews>>) => void
    vi.mocked(api.listContentReviews).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    await publish(wrapper)
    await flushPromises()
    state.access.role = 'learner'
    finish({
      ...page,
      items: [
        { ...reviewed, publication_status: 'published', published_at: formalReceipt.published_at },
      ],
    })
    await flushPromises()
    expect(wrapper.find('[data-testid=bank-review-row]').exists()).toBe(false)
    expect(wrapper.find('[data-testid=bank-review-detail]').exists()).toBe(false)
  })
  it('explains one saved approval satisfies the trial gate without formal publication', async () => {
    const single = {
      ...packet,
      status: 'reviewed' as const,
      review_count: 1,
      approval_count: 1,
      own_decision: 'approve' as const,
      can_review: false,
      required_approvals: 1,
      trial_eligible: true,
    }
    vi.mocked(api.listContentReviews).mockResolvedValue({ ...page, items: [single] })
    vi.mocked(api.getContentReview).mockResolvedValue(single)
    const wrapper = render()
    await open(wrapper)
    expect(wrapper.get('[data-testid=bank-review-row]').text()).toContain('通过 1 / 1')
    expect(wrapper.get('[data-testid=review-progress]').text()).toContain('你的通过意见已保存')
    expect(wrapper.get('[data-testid=review-progress]').text()).toContain('已满足一位审核人通过')
    expect(wrapper.get('[data-testid=review-progress]').text()).toContain('不是正式发布')
    expect(wrapper.text()).not.toContain('另一位审核人')
    expect(wrapper.find('admin-trial-panel-stub').attributes('eligible')).toBe('true')
  })
  it('labels double approvals as trial-ready, never formal publication', async () => {
    vi.mocked(api.getContentReview).mockResolvedValue({
      ...packet,
      status: 'reviewed',
      review_count: 2,
      approval_count: 2,
      trial_eligible: true,
    })
    const wrapper = render()
    await open(wrapper)
    expect(wrapper.get('[data-testid=review-progress]').text()).toContain('可由管理员指派题目试答')
    expect(wrapper.get('[data-testid=review-progress]').text()).toContain('不是正式发布')
  })
  it('separates an existing formal publication from review status while preserving the trial entry', async () => {
    vi.mocked(api.getContentReview).mockResolvedValue({
      ...packet,
      status: 'reviewed',
      trial_eligible: true,
    })
    vi.mocked(api.getPublicationPreview).mockResolvedValue({
      packet_id: packet.id,
      digest: packet.digest,
      eligible: false,
      issues: [],
      preview_token: 'preview',
      targets: [],
      publication: {
        item_version_id: 'formal-item',
        rubric_version_id: null,
        published_at: '2026-09-29T00:00:00Z',
        targets: [{ previous_blueprint_id: 'plan-1', blueprint_id: 'plan-v2', name: '正式标准测' }],
      },
    })
    const wrapper = render()
    await open(wrapper)
    expect(wrapper.text()).toContain('正式已发布')
    expect(wrapper.get('.dossier-heading .status-pill.reviewed').text()).toBe('审核通过')
    expect(wrapper.get('[data-testid=review-detail-publication-status]').text()).toBe('正式已发布')
    expect(wrapper.text()).not.toContain('审核通过 · 未发布')
    expect(wrapper.text()).not.toContain('题目仍未正式发布')
    expect(wrapper.find('admin-trial-panel-stub').attributes('eligible')).toBe('true')
    expect(api.submitContentReview).not.toHaveBeenCalled()
  })
  it('locks queue, filters, trial assignment and route navigation while publishing', async () => {
    vi.mocked(api.getContentReview).mockResolvedValue({
      ...packet,
      status: 'reviewed',
      trial_eligible: true,
    })
    vi.mocked(api.getPublicationPreview).mockResolvedValue({
      packet_id: packet.id,
      digest: packet.digest,
      eligible: true,
      issues: [],
      preview_token: 'preview',
      publication: null,
      targets: [
        {
          blueprint_id: 'plan-1',
          name: '正式标准测',
          mode: 'standard',
          scenario: 'general',
          version: 1,
          pool_size: 24,
          organization_names: ['平台组织'],
          eligible: true,
          reason: null,
        },
      ],
    })
    let finish!: (value: Awaited<ReturnType<typeof api.publishContentReview>>) => void
    vi.mocked(api.publishContentReview).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const wrapper = render()
    await open(wrapper)
    await wrapper.get('[data-testid=publication-target-plan-1]').setValue(true)
    await wrapper.get('[data-testid=publication-prepare]').trigger('click')
    await wrapper.get('[data-testid=publication-confirm]').trigger('click')
    expect(wrapper.get('[data-testid=bank-review-row]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('.review-filters select').attributes('disabled')).toBeDefined()
    expect(wrapper.find('admin-trial-panel-stub').attributes('disabled')).toBe('true')
    expect(wrapper.find('content-assignment-panel-stub').attributes('disabled')).toBe('true')
    expect(state.leave()).toBe(false)
    expect(wrapper.emitted('busy')?.slice(-1)[0]).toEqual([true])
    finish({
      item_version_id: 'formal-item',
      rubric_version_id: null,
      published_at: '2026-09-29T00:00:00Z',
      targets: [{ previous_blueprint_id: 'plan-1', blueprint_id: 'plan-v2', name: '正式标准测' }],
    })
    await flushPromises()
    expect(state.leave()).toBe(true)
    expect(wrapper.get('[data-testid=bank-review-row]').attributes('disabled')).toBeUndefined()
  })
  it('clears private review content if the publication API reports revoked access', async () => {
    vi.mocked(api.getContentReview).mockResolvedValue({ ...packet, status: 'reviewed' })
    vi.mocked(api.getPublicationPreview).mockRejectedValue(new ApiError('revoked', 403))
    const wrapper = render()
    await open(wrapper)
    expect(wrapper.text()).not.toContain('内部参考答案')
    expect(wrapper.find('[data-testid=bank-review-detail]').exists()).toBe(false)
    expect(wrapper.text()).toContain('题面、答案和未保存意见已清除')
  })
  it('shows full answer, rubric and licensed-source distinctions without a publish control', async () => {
    const wrapper = render()
    await open(wrapper)
    expect(wrapper.text()).toContain('内部参考答案')
    expect(wrapper.find('content-assignment-panel-stub').exists()).toBe(true)
    await wrapper.get('[data-testid=review-rubric-tab]').trigger('click')
    expect(wrapper.text()).toContain('0 分')
    expect(wrapper.text()).toContain('4 分')
    expect(wrapper.text()).toContain('不是专家金标准')
    await wrapper.get('[data-testid=review-sources-tab]').trigger('click')
    expect(wrapper.text()).toContain('不等同题目授权')
    const link = wrapper.get('a[href="https://example.test/source"]')
    expect(link.attributes('rel')).toContain('noopener')
    expect(wrapper.findAll('button').some((button) => /^发布/.test(button.text()))).toBe(false)
  })
  it('does not treat withheld independent-teacher reviews as zero reviews, and hides assignments', async () => {
    state.access.role = 'teacher'
    vi.mocked(api.getContentReview).mockResolvedValue({
      ...structuredClone(packet),
      review_count: 1,
      status: 'in_review',
      reviews: [],
    })
    const wrapper = render()
    await open(wrapper)
    expect(wrapper.text()).toContain('1 人已审')
    expect(wrapper.text()).toContain('教师提交本人意见后才可查看已有意见')
    expect(wrapper.find('content-assignment-panel-stub').exists()).toBe(false)
    expect(wrapper.find('[data-testid=review-publication-panel]').exists()).toBe(false)
    expect(api.getPublicationPreview).not.toHaveBeenCalled()
  })
  it('requires all checks for approval and a reason, then saves only after confirmation', async () => {
    const wrapper = render()
    await open(wrapper)
    await wrapper.get('form:has([data-testid=review-comment])').trigger('submit')
    expect(wrapper.text()).toContain('10–4000 字')
    await wrapper
      .get('[data-testid=review-comment]')
      .setValue('这是一条够长的审核意见，已核对参考答案。')
    await wrapper.get('form:has([data-testid=review-comment])').trigger('submit')
    expect(wrapper.text()).toContain('全部四项核对')
    await fill(wrapper)
    expect(api.submitContentReview).not.toHaveBeenCalled()
    await wrapper.get('[data-testid=confirm-review]').trigger('click')
    await flushPromises()
    expect(api.submitContentReview).toHaveBeenCalledWith(
      'packet-1',
      expect.objectContaining({
        expected_digest: packet.digest,
        decision: 'approve',
        checks: { source: true, answer: true, rubric: true, fairness: true },
      }),
      expect.any(String),
    )
    expect(wrapper.text()).toContain('审核意见已保存并留痕')
    expect(wrapper.find('[data-testid=review-comment]').exists()).toBe(false)
  })
  it('refreshes the filtered queue after saving so the previous next-page item is not skipped', async () => {
    const firstTwenty = Array.from({ length: 20 }, (_, index) => ({
      ...structuredClone(packet),
      id: `packet-${index + 1}`,
    }))
    const remaining = [
      ...firstTwenty.slice(1),
      { ...structuredClone(packet), id: 'packet-21', code: 'LAST-PACKET' },
    ]
    vi.mocked(api.listContentReviews)
      .mockResolvedValueOnce({ items: firstTwenty, total: 21, offset: 0, limit: 20 })
      .mockResolvedValueOnce({ items: remaining, total: 20, offset: 0, limit: 20 })
    const wrapper = render()
    await open(wrapper)
    await fill(wrapper)
    await wrapper.get('[data-testid=confirm-review]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('共 20 道题')
    expect(wrapper.text()).toContain('LAST-PACKET')
    expect(wrapper.get('[data-testid=bank-review-detail]').text()).toContain('A01-R1-test')
    expect(wrapper.text()).toContain('审核意见已保存并留痕')
  })
  it('refreshes current review status after an idempotency replay returns an older receipt', async () => {
    vi.mocked(api.getContentReview)
      .mockResolvedValueOnce(structuredClone(packet))
      .mockResolvedValueOnce({
        ...structuredClone(packet),
        can_review: false,
        status: 'reviewed',
        review_count: 2,
        approval_count: 2,
      })
    vi.mocked(api.submitContentReview).mockResolvedValue({
      ...structuredClone(packet),
      can_review: false,
      status: 'in_review',
      review_count: 1,
      approval_count: 1,
    })
    const wrapper = render()
    await open(wrapper)
    await fill(wrapper)
    await wrapper.get('[data-testid=confirm-review]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid=bank-review-detail]').text()).toContain('2 人已审 / 2 人通过')
    expect(wrapper.get('[data-testid=bank-review-detail]').text()).toContain('审核通过')
    expect(wrapper.get('[data-testid=bank-review-detail]').text()).not.toContain(
      '审核通过 · 未发布',
    )
  })
  it('does not misreport a persisted opinion as failed when the latest detail cannot refresh', async () => {
    vi.mocked(api.getContentReview)
      .mockResolvedValueOnce(structuredClone(packet))
      .mockRejectedValueOnce(new Error('read unavailable'))
    vi.mocked(api.submitContentReview).mockResolvedValue({
      ...structuredClone(packet),
      can_review: false,
      status: 'in_review',
      review_count: 1,
      approval_count: 1,
    })
    const wrapper = render()
    await open(wrapper)
    await fill(wrapper)
    await wrapper.get('[data-testid=confirm-review]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('审核意见已保存，但最新状态未能刷新')
    expect(wrapper.text()).toContain('审核意见已保存并留痕')
    expect(wrapper.find('[data-testid=review-comment]').exists()).toBe(false)
  })
  it('corrects an emptied last page without dropping the saved detail or receipt', async () => {
    vi.mocked(api.listContentReviews)
      .mockResolvedValueOnce({ ...page, total: 21 })
      .mockResolvedValueOnce({ ...page, total: 21, offset: 20 })
      .mockResolvedValueOnce({ items: [], total: 20, offset: 20, limit: 20 })
      .mockResolvedValueOnce({ ...page, total: 20 })
    const wrapper = render()
    await flushPromises()
    const nextPage = wrapper.findAll('.review-pagination button')[1]!
    await nextPage.trigger('click')
    await open(wrapper)
    await fill(wrapper)
    await wrapper.get('[data-testid=confirm-review]').trigger('click')
    await flushPromises()
    expect(vi.mocked(api.listContentReviews).mock.calls.map((call) => call[1])).toEqual([
      0, 20, 20, 0,
    ])
    expect(wrapper.get('.review-pagination').text()).toContain('1 / 1')
    expect(wrapper.text()).toContain('审核意见已保存并留痕')
    expect(wrapper.find('[data-testid=bank-review-detail]').exists()).toBe(true)
  })
  it('retains reason and idempotency key on a failed request, but changes key after editing', async () => {
    vi.mocked(api.submitContentReview).mockRejectedValue(new Error('临时服务失败'))
    const wrapper = render()
    await open(wrapper)
    await fill(wrapper, false)
    await wrapper.get('[data-testid=confirm-review]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('临时服务失败')
    expect(
      (wrapper.get('[data-testid=review-comment]').element as HTMLTextAreaElement).value,
    ).toContain('原始来源')
    await wrapper.get('[data-testid=confirm-review]').trigger('click')
    await flushPromises()
    const calls = vi.mocked(api.submitContentReview).mock.calls
    expect(calls[0]?.[2]).toBe(calls[1]?.[2])
    expect(calls[0]?.[1].checks.source).toBe(false)
    await wrapper
      .get('[data-testid=review-comment]')
      .setValue('新意见：请补充这处原始资料的许可依据和页码。')
    expect(wrapper.find('[data-testid=confirm-review]').exists()).toBe(false)
    await wrapper.get('form:has([data-testid=review-comment])').trigger('submit')
    await wrapper.get('[data-testid=confirm-review]').trigger('click')
    await flushPromises()
    expect(calls[2]?.[2]).not.toBe(calls[1]?.[2])
  })
  it('prevents double submit and prevents route exit while submitting', async () => {
    let finish!: (value: ReviewDetail) => void
    vi.mocked(api.submitContentReview).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const wrapper = render()
    await open(wrapper)
    await fill(wrapper)
    await wrapper.get('[data-testid=confirm-review]').trigger('click')
    await wrapper.get('[data-testid=confirm-review]').trigger('click')
    expect(api.submitContentReview).toHaveBeenCalledTimes(1)
    expect(state.leave()).toBe(false)
    finish({ ...structuredClone(packet), can_review: false })
    await flushPromises()
    expect(state.leave()).toBe(true)
  })
  it.each([403, 404])('clears private content and unsaved opinions on HTTP %s', async (status) => {
    vi.mocked(api.submitContentReview).mockRejectedValue(new ApiError('revoked', status))
    const wrapper = render()
    await open(wrapper)
    await fill(wrapper)
    await wrapper.get('[data-testid=confirm-review]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('题面、答案和未保存意见已清除')
    expect(wrapper.find('[data-testid=bank-review-detail]').exists()).toBe(false)
    expect(wrapper.find('[data-testid=review-comment]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('内部参考答案')
  })
  it('drops private material on identity/organization/permission change and rejects late detail results', async () => {
    let finish!: (value: ReviewDetail) => void
    vi.mocked(api.getContentReview).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const wrapper = render()
    await flushPromises()
    await wrapper.get('[data-testid=bank-review-row]').trigger('click')
    state.access.organizationId = 'org-2'
    state.access.role = 'learner'
    finish(structuredClone(packet))
    await flushPromises()
    expect(wrapper.find('[data-testid=bank-review-detail]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('内部参考答案')
  })
  it('warns before leaving unsaved opinions and retains input when cancelled', async () => {
    const wrapper = render()
    await open(wrapper)
    await wrapper.get('[data-testid=review-comment]').setValue('还没有保存的审核意见，请核对原文。')
    vi.mocked(window.confirm).mockReturnValue(false)
    expect(state.leave()).toBe(false)
    await wrapper.get('[data-testid=bank-review-row]').trigger('click')
    expect(api.getContentReview).toHaveBeenCalledTimes(1)
    expect(
      (wrapper.get('[data-testid=review-comment]').element as HTMLTextAreaElement).value,
    ).toContain('还没有保存')
  })
  it('rejects executable source links and renders content as plain text', async () => {
    const unsafe = structuredClone(packet)
    unsafe.sources[0]!.url = 'javascript:alert(1)'
    unsafe.sources[0]!.title = '<img src=x onerror=alert(1)>'
    vi.mocked(api.getContentReview).mockResolvedValue(unsafe)
    const wrapper = render()
    await open(wrapper)
    await wrapper.get('[data-testid=review-sources-tab]').trigger('click')
    expect(wrapper.find('a[href^="javascript:"]').exists()).toBe(false)
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.text()).toContain('<img src=x onerror=alert(1)>')
  })
})
