import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import BlueprintPlanWizard from '../components/BlueprintPlanWizard.vue'
import { DIMENSIONS } from '../domain/capabilities'
import { planOptions, previewPlan, publishPlan } from '../services/blueprintAuthoringApi'

vi.mock('vue-router', () => ({ onBeforeRouteLeave: vi.fn() }))
vi.mock('../services/blueprintAuthoringApi', () => ({
  planOptions: vi.fn(),
  previewPlan: vi.fn(),
  publishPlan: vi.fn(),
}))
const items = DIMENSIONS.map((d, i) => ({
  id: `item-${i}`,
  stem: `${d.name}题目`,
  dimension_code: d.code,
  item_type: 'objective',
  version: 1,
  bank_version: 'test-bank',
}))
const org = {
  id: 'org-1',
  name: 'AI Measure',
  slug: 'ai-measure-platform',
  member_count: 3,
  experience_only: false,
  accepts_experience: true,
}
function button(wrapper: ReturnType<typeof mount>, text: string) {
  return wrapper.findAll('button').find((b) => b.text() === text)!
}
async function ready() {
  const wrapper = mount(BlueprintPlanWizard)
  await wrapper.get('input[placeholder^="例如"]').setValue('新测评方案')
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  await wrapper.findAll('.plan-rules input')[1]!.setValue(6)
  await button(wrapper, '选中本页').trigger('click')
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  await wrapper.get('.picker-row input').setValue(true)
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  return wrapper
}
describe('blueprint plan authoring', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(planOptions).mockImplementation(async (kind) =>
      kind === 'items' ? { items, total: 6 } : { items: [org], total: 1 },
    )
    vi.mocked(previewPlan).mockResolvedValue({
      valid: true,
      issues: [],
      candidate_count: 6,
      dimensions: Object.fromEntries(DIMENSIONS.map((d) => [d.code, 1])),
      item_types: { objective: 6 },
    })
    vi.mocked(publishPlan).mockResolvedValue({
      id: 'plan',
      logical_id: 'plan-logical',
      version: 1,
      publication_status: 'published',
    })
  })
  it('requires server validation and confirmation, then publishes the exact chosen pool', async () => {
    const wrapper = await ready()
    expect(button(wrapper, '确认创建并发布').attributes('disabled')).toBeDefined()
    await button(wrapper, '检查题池与发布条件').trigger('click')
    await flushPromises()
    await wrapper.get('.check-line input').setValue(true)
    await button(wrapper, '确认创建并发布').trigger('click')
    await flushPromises()
    expect(publishPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        item_ids: items.map((item) => item.id),
        organization_ids: ['org-1'],
        name: '新测评方案',
      }),
      expect.any(String),
    )
    expect(wrapper.emitted('saved')?.[0]?.[0]).toMatchObject({ id: 'plan' })
    wrapper.unmount()
  })
  it('invalidates preview when rules change and blocks empty selections', async () => {
    const wrapper = await ready()
    await button(wrapper, '检查题池与发布条件').trigger('click')
    await flushPromises()
    await button(wrapper, '返回上一步').trigger('click')
    await flushPromises()
    await button(wrapper, '返回上一步').trigger('click')
    await flushPromises()
    await wrapper.get('.plan-rules input').setValue(7)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.find('.plan-validation').exists()).toBe(false)
    expect(button(wrapper, '确认创建并发布').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })
  it('retries ambiguous publication with the same idempotency key and no duplicate clicks', async () => {
    const wrapper = await ready()
    await button(wrapper, '检查题池与发布条件').trigger('click')
    await flushPromises()
    await wrapper.get('.check-line input').setValue(true)
    vi.mocked(publishPlan).mockRejectedValueOnce(new Error('网络中断，请重试'))
    await button(wrapper, '确认创建并发布').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('网络中断')
    await button(wrapper, '确认创建并发布').trigger('click')
    await flushPromises()
    expect(vi.mocked(publishPlan).mock.calls[0]?.[1]).toBe(
      vi.mocked(publishPlan).mock.calls[1]?.[1],
    )
    wrapper.unmount()
  })
  it('blocks server-rejected coverage and allows options to retry after a failure', async () => {
    const wrapper = await ready()
    vi.mocked(previewPlan).mockResolvedValueOnce({
      valid: false,
      issues: ['六维覆盖不足'],
      candidate_count: 6,
      dimensions: {},
      item_types: {},
    })
    await button(wrapper, '检查题池与发布条件').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('六维覆盖不足')
    expect(button(wrapper, '确认创建并发布').attributes('disabled')).toBeDefined()
    vi.mocked(planOptions).mockRejectedValueOnce(new Error('读取失败'))
    await button(wrapper, '返回上一步').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('读取失败')
    expect(wrapper.text()).not.toContain('共 0 条')
    expect(wrapper.text()).toContain('数量未确认')
    await button(wrapper, '重新读取').trigger('click')
    await flushPromises()
    expect(wrapper.find('.picker-row').exists()).toBe(true)
    wrapper.unmount()
  })
  it('combines multi-select filters, preserves choices across pages and resets filters only', async () => {
    vi.mocked(planOptions).mockResolvedValue({ items, total: 36 })
    const wrapper = mount(BlueprintPlanWizard)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('已选 0 道 · 最多可选 1000 道')
    expect(wrapper.text()).toContain('当前筛选共 36 道')
    await wrapper.get('.picker-row input').setValue(true)
    await button(wrapper, '下一页').trigger('click')
    await flushPromises()
    await wrapper.get('.filter-options input[value="objective"]').setValue(true)
    await wrapper.get('.filter-options input[value="dialogue"]').setValue(true)
    await wrapper.get('.filter-options input[value="foundations"]').setValue(true)
    await wrapper.get('.filter-options input[value="evaluation"]').setValue(true)
    await flushPromises()
    expect(planOptions).toHaveBeenLastCalledWith(
      'items',
      expect.objectContaining({
        item_types: ['objective', 'dialogue'],
        dimensions: ['foundations', 'evaluation'],
        offset: '0',
      }),
    )
    expect(wrapper.text()).toContain('已选 1 道')
    expect(wrapper.get('.picker-row input').element).toHaveProperty('checked', true)
    await button(wrapper, '重置筛选').trigger('click')
    await flushPromises()
    expect(planOptions).toHaveBeenLastCalledWith(
      'items',
      expect.objectContaining({
        item_types: [],
        dimensions: [],
        q: '',
        offset: '0',
      }),
    )
    expect(wrapper.text()).toContain('已选 1 道')
    await button(wrapper, '选中本页').trigger('click')
    expect(wrapper.text()).toContain('已选 6 道')
    await button(wrapper, '取消本页选择').trigger('click')
    expect(wrapper.text()).toContain('已选 0 道')
    wrapper.unmount()
  })
  it('ignores stale filter responses and does not show a failed request as zero results', async () => {
    let resolveOld!: (value: { items: typeof items; total: number }) => void
    vi.mocked(planOptions).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve
        }),
    )
    const wrapper = mount(BlueprintPlanWizard)
    await wrapper.get('form').trigger('submit')
    await wrapper.get('.filter-options input[value="practical"]').setValue(true)
    await flushPromises()
    resolveOld({ items: [], total: 0 })
    await flushPromises()
    expect(wrapper.findAll('.picker-row')).toHaveLength(6)
    vi.mocked(planOptions).mockRejectedValueOnce(new Error('网络中断'))
    await wrapper.get('.filter-options input[value="dialogue"]').setValue(true)
    await flushPromises()
    expect(wrapper.text()).toContain('读取失败，暂无法确认题目数量')
    expect(wrapper.text()).not.toContain('共 0 条')
    expect(wrapper.find('.plan-empty').exists()).toBe(false)
    wrapper.unmount()
  })
})
