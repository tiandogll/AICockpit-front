import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useAccessStore } from '../stores/access'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ContentVersionPanel from '../components/ContentVersionPanel.vue'
import { getContent, listContent, createItem, transitionContent } from '../services/contentApi'
vi.mock('../components/ContentAssignmentPanel.vue', () => ({
  default: {
    props: ['itemId'],
    template: '<section data-testid="assignment-panel">{{ itemId }}</section>',
  },
}))
vi.mock('../services/contentApi', () => ({
  listContent: vi.fn<typeof listContent>(),
  getContent: vi.fn<typeof getContent>(),
  transitionContent: vi.fn<typeof transitionContent>(),
  createItem: vi.fn<typeof createItem>(),
}))
const item = {
  id: 'item-1',
  logical_id: 'logical-1',
  version: 3,
  publication_status: 'draft' as const,
  created_at: '2026-09-01',
  updated_at: '2026-09-01',
  approved_at: null,
  approved_by: null,
  stem: '来源核验题',
  dimension_code: 'evaluation',
  item_type: 'objective',
  difficulty: 0.2,
  configuration: { options: ['甲', '乙'] },
  answer_key: { correct_option: '甲' },
}
describe('content version library', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(listContent).mockResolvedValue({ items: [item], total: 1, limit: 20, offset: 0 })
    vi.mocked(getContent).mockResolvedValue(item)
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true,
      value: vi.fn(function (this: HTMLDialogElement) { this.open = true }) })
    Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true,
      value: vi.fn(function (this: HTMLDialogElement) { this.open = false }) })
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'close')
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
  })
  it('opens an accessible dialog immediately, with loading then the requested detail', async () => {
    let resolve!: (value: typeof item) => void
    vi.mocked(getContent).mockImplementation(() => new Promise((done) => { resolve = done }))
    const wrapper = mount(ContentVersionPanel, { props: { kind: 'items' } })
    await flushPromises()
    await wrapper.get('button[aria-haspopup="dialog"]').trigger('click')
    await flushPromises()
    const dialog = wrapper.get('dialog.content-detail')
    expect((dialog.element as HTMLDialogElement).open).toBe(true)
    expect(dialog.get('[role=status]').text()).toContain('正在读取题目详情')
    expect(dialog.attributes('aria-labelledby')).toBe(dialog.get('h2').attributes('id'))
    resolve(item)
    await flushPromises()
    expect(dialog.find('[role=status]').exists()).toBe(false)
    expect(dialog.text()).toContain('来源核验题')
  })
  it('displays detail failures and retries inside the visible dialog', async () => {
    vi.mocked(getContent).mockRejectedValueOnce(new Error('暂时无法读取此题'))
    const wrapper = mount(ContentVersionPanel, { props: { kind: 'items' } })
    await flushPromises()
    await wrapper.get('button[aria-haspopup="dialog"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('dialog [role=alert]').text()).toContain('暂时无法读取此题')
    await wrapper.get('dialog [role=alert] button').trigger('click')
    await flushPromises()
    expect(getContent).toHaveBeenLastCalledWith('items', item.id)
    expect(wrapper.get('dialog.content-detail').text()).toContain(item.stem)
    expect(wrapper.find('dialog [role=alert]').exists()).toBe(false)
  })
  it('discards late detail after closing, and does not reopen or leak stale answers', async () => {
    let resolve!: (value: typeof item) => void
    vi.mocked(getContent).mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    const wrapper = mount(ContentVersionPanel, { props: { kind: 'items' } })
    await flushPromises()
    await wrapper.get('button[aria-haspopup="dialog"]').trigger('click')
    await flushPromises()
    const dialog = wrapper.get('dialog.content-detail')
    await dialog.trigger('cancel')
    resolve(item)
    await flushPromises()
    expect((dialog.element as HTMLDialogElement).open).toBe(false)
    expect(dialog.text()).not.toContain('正确答案')
    expect(dialog.find('[role=status]').exists()).toBe(false)
  })
  it('invalidates a pending detail when changing content kinds', async () => {
    let resolve!: (value: typeof item) => void
    vi.mocked(getContent).mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    const wrapper = mount(ContentVersionPanel, { props: { kind: 'items' } })
    await flushPromises()
    await wrapper.get('button[aria-haspopup="dialog"]').trigger('click')
    await flushPromises()
    await wrapper.setProps({ kind: 'rubrics' })
    resolve(item)
    await flushPromises()
    const dialog = wrapper.get('dialog.content-detail')
    expect((dialog.element as HTMLDialogElement).open).toBe(false)
    expect(dialog.text()).not.toContain('正确答案')
    expect(wrapper.find('.content-empty[role=status]').exists()).toBe(false)
  })
  it('keeps administrator editing without exposing a teacher assignment workflow on one platform', async () => {
    useAccessStore().singlePlatform = true
    const wrapper = mount(ContentVersionPanel, { props: { kind: 'items' } })
    await flushPromises()
    await wrapper.get('button.text-button').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('提交审核')
    expect(wrapper.findAll('button').some((button) => button.text() === '新建题目')).toBe(true)
    expect(wrapper.find('[data-testid=assignment-panel]').exists()).toBe(false)
  })
  it('renders genuine versions, canonical dimensions and privileged detail', async () => {
    const wrapper = mount(ContentVersionPanel, { props: { kind: 'items' } })
    await flushPromises()
    expect(wrapper.text()).toContain('v3')
    expect(wrapper.text()).toContain('结果评估')
    await wrapper.get('button.text-button').trigger('click')
    await flushPromises()
    expect(getContent).toHaveBeenCalledWith('items', 'item-1')
    expect(wrapper.text()).toContain('正确答案（仅系统管理员）')
    expect(wrapper.text()).toContain('提交审核')
    expect(wrapper.get('[data-testid=assignment-panel]').text()).toBe('item-1')
    expect(wrapper.findAll('button').some((button) => button.text() === '审核并发布')).toBe(false)
  })
  it('reports a failed list request without a fabricated empty-success state', async () => {
    vi.mocked(listContent).mockRejectedValue(new Error('无权访问'))
    const wrapper = mount(ContentVersionPanel, { props: { kind: 'rubrics' } })
    await flushPromises()
    expect(wrapper.get('[role=alert]').text()).toContain('无权访问')
  })
  it('opens a successor editor and saves only a draft before showing its detail', async () => {
    vi.mocked(createItem).mockResolvedValue({
      id: 'new-draft',
      logical_id: item.logical_id,
      version: 4,
      publication_status: 'draft',
    })
    const wrapper = mount(ContentVersionPanel, { props: { kind: 'items' } })
    await flushPromises()
    await wrapper.get('button.text-button').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid=edit-item]').trigger('click')
    expect(wrapper.text()).toContain('基于 v3 创建新版本')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(createItem).toHaveBeenCalledWith(expect.objectContaining({ logical_id: 'logical-1' }))
    expect(transitionContent).not.toHaveBeenCalled()
    expect(getContent).toHaveBeenLastCalledWith('items', 'new-draft')
    expect(wrapper.text()).toContain('已保存 v4 草稿')
  })
  it('offers new-item creation only for items, not other content kinds', async () => {
    const wrapper = mount(ContentVersionPanel, { props: { kind: 'items' } })
    await flushPromises()
    await wrapper.get('[data-testid=new-item]').trigger('click')
    expect(wrapper.text()).toContain('新建题目草稿')
    await wrapper.setProps({ kind: 'rubrics' })
    await flushPromises()
    expect(wrapper.find('[data-testid=new-item]').exists()).toBe(false)
    expect(wrapper.find('[data-testid=item-stem]').exists()).toBe(false)
  })
})
