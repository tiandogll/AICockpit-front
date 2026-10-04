import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import ItemBankView from '../views/ItemBankView.vue'
import { createItem, listContent } from '../services/contentApi'

vi.mock('../services/contentApi', () => ({
  listContent: vi.fn<typeof listContent>(),
  getContent: vi.fn<typeof import('../services/contentApi').getContent>(),
  transitionContent: vi.fn<typeof import('../services/contentApi').transitionContent>(),
  createItem: vi.fn<typeof createItem>(),
}))

async function openDraft() {
  const wrapper = mount(ItemBankView)
  await flushPromises()
  await wrapper.get('[data-testid=new-item]').trigger('click')
  await wrapper.get('[data-testid=item-stem]').setValue('保留这份未保存题目')
  await wrapper.get('[data-testid=item-options]').setValue('核对原文\n直接采用')
  await wrapper.get('[data-testid=item-answer]').setValue('核对原文')
  await wrapper.get('[data-testid=item-tags]').setValue('来源核验')
  return wrapper
}

describe('item editing across content tabs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
    setActivePinia(createPinia())
    vi.mocked(listContent).mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 })
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  })
  afterEach(() => { Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView') })

  it('preserves an unsaved draft when consulting rubrics or the import tab', async () => {
    const wrapper = await openDraft()
    const tabs = wrapper.findAll('.content-tabs button')
    await tabs[1]!.trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid=item-stem]').exists()).toBe(false)
    await tabs[3]!.trigger('click')
    await tabs[0]!.trigger('click')
    await flushPromises()
    expect((wrapper.get('[data-testid=item-stem]').element as HTMLTextAreaElement).value).toBe(
      '保留这份未保存题目',
    )
    expect((wrapper.get('[data-testid=item-options]').element as HTMLTextAreaElement).value).toBe(
      '核对原文\n直接采用',
    )
    expect((wrapper.get('[data-testid=item-answer]').element as HTMLSelectElement).value).toBe(
      '核对原文',
    )
    expect((wrapper.get('[data-testid=item-tags]').element as HTMLInputElement).value).toBe(
      '来源核验',
    )
    expect(createItem).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('blocks tab changes during save and keeps the form and failure feedback afterward', async () => {
    let rejectSave!: (reason: Error) => void
    vi.mocked(createItem).mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectSave = reject
        }),
    )
    const wrapper = await openDraft()
    await wrapper.get('form').trigger('submit')
    const tabs = wrapper.findAll('.content-tabs button')
    expect(tabs.every((tab) => (tab.element as HTMLButtonElement).disabled)).toBe(true)
    await tabs[1]!.trigger('click')
    expect(wrapper.find('[data-testid=item-stem]').exists()).toBe(true)
    rejectSave(new Error('保存暂时失败'))
    await flushPromises()
    expect(tabs.every((tab) => !(tab.element as HTMLButtonElement).disabled)).toBe(true)
    expect(wrapper.get('[role=alert]').text()).toContain('保存暂时失败')
    await tabs[1]!.trigger('click')
    await tabs[0]!.trigger('click')
    await flushPromises()
    expect((wrapper.get('[data-testid=item-stem]').element as HTMLTextAreaElement).value).toBe(
      '保留这份未保存题目',
    )
    expect(wrapper.get('[role=alert]').text()).toContain('保存暂时失败')
    wrapper.unmount()
  })
})
