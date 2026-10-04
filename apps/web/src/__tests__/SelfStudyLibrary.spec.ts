import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SelfStudyLibrary from '../components/SelfStudyLibrary.vue'
import { hasTrainingTarget, LEARNING_GUIDANCE } from '../domain/learningGuidance'

const wrappers: ReturnType<typeof mount>[] = []
const showModal = vi.fn(function (this: HTMLDialogElement) {
  this.open = true
})
const close = vi.fn(function (this: HTMLDialogElement) {
  this.open = false
})
function render(initialCode?: string) {
  const wrapper = mount(SelfStudyLibrary, { props: { initialCode } })
  wrappers.push(wrapper)
  return wrapper
}
beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: showModal,
  })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: close })
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Reading study methods must not send requests')
    }),
  )
})
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'close')
  vi.unstubAllGlobals()
})

describe('read-only self-study methods', () => {
  it.each(LEARNING_GUIDANCE)(
    'opens real authored content for $code without API calls',
    async (item) => {
      const wrapper = render()
      expect(showModal).not.toHaveBeenCalled()
      await wrapper.get(`button[aria-label="阅读方法：${item.name}"]`).trigger('click')
      const dialog = wrapper.get('dialog')
      expect((dialog.element as HTMLDialogElement).open).toBe(true)
      expect(dialog.text()).toContain(item.example)
      expect(dialog.findAll('li')).toHaveLength(3)
      expect(dialog.text()).toContain(item.check)
      expect(dialog.text()).toContain('不进行作答评分或任务保存')
      await dialog.get('[aria-label="关闭学习方法"]').trigger('click')
      expect((dialog.element as HTMLDialogElement).open).toBe(false)
      expect(fetch).not.toHaveBeenCalled()
    },
  )

  it('opens an explicit valid deep link after mounting and changes methods without reopening', async () => {
    const wrapper = render('ethics')
    await flushPromises()
    expect(showModal).toHaveBeenCalledTimes(1)
    expect(wrapper.get('dialog').text()).toContain('先检查数据与使用边界')
    await wrapper.setProps({ initialCode: 'evaluation' })
    expect(wrapper.get('dialog').text()).toContain('建立来源核验清单')
    expect(showModal).toHaveBeenCalledTimes(1)
    await wrapper.get('.study-done').trigger('click')
    expect((wrapper.get('dialog').element as HTMLDialogElement).open).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('ignores unknown directions and states the non-scored provenance', () => {
    const wrapper = render('unknown')
    expect(showModal).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('尚未经专家审定')
    expect(wrapper.text()).toContain('阅读不会生成个人训练计划')
    expect(wrapper.findAll('.study-grid article')).toHaveLength(6)
  })
})

describe('shortfall training threshold', () => {
  it.each([50, 71.9, -1, Number.NaN, Number.POSITIVE_INFINITY, null])(
    'does not invent a training target at %s',
    (index) => {
      expect(hasTrainingTarget([{ index, evidence_count: 2 }])).toBe(false)
    },
  )
  it('requires both a valid low index and at least two evidence items', () => {
    expect(hasTrainingTarget([{ index: 49.99, evidence_count: 2 }])).toBe(true)
    expect(hasTrainingTarget([{ index: 0, evidence_count: 2 }])).toBe(true)
    expect(hasTrainingTarget([{ index: 20, evidence_count: 1 }])).toBe(false)
    expect(hasTrainingTarget([])).toBe(false)
  })
})
