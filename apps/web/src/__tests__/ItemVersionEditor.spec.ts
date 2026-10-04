import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ItemVersionEditor from '../components/ItemVersionEditor.vue'
import { createItem, listContent, type ContentRecord } from '../services/contentApi'
import type { AuthoringAdapter } from '../services/authoringApi'

vi.mock('../services/contentApi', () => ({
  createItem: vi.fn<typeof createItem>(),
  listContent: vi.fn<typeof listContent>(),
}))
const source: ContentRecord = {
  id: 'version-one',
  logical_id: 'logical-one',
  version: 3,
  publication_status: 'published',
  created_at: '2026-09-01',
  updated_at: '2026-09-01',
  approved_at: null,
  approved_by: null,
  stem: '如何核验原始数据？',
  dimension_code: 'evaluation',
  item_type: 'objective',
  difficulty: 0.4,
  configuration: {
    options: ['核对原始数据', '直接采纳'],
    custom_unknown: { preserve: true },
    metadata: {
      tags: ['来源核验'],
      scenarios: ['higher_education'],
      content_tier: 'basic',
      provenance: '原始出处',
    },
  },
  answer_key: { correct_option: '核对原始数据', explanation: '保留解释' },
  rubric_version_id: null,
}
const result = {
  id: 'version-two',
  logical_id: 'logical-one',
  version: 4,
  publication_status: 'draft' as const,
}
describe('item version editor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(listContent).mockResolvedValue({ items: [], total: 0, offset: 0, limit: 20 })
    vi.mocked(createItem).mockResolvedValue(result)
  })
  it('creates a successor draft and preserves unknown configuration and answer metadata', async () => {
    const wrapper = mount(ItemVersionEditor, { props: { source } })
    await wrapper.get('[data-testid=item-stem]').setValue('请说明如何核验原始数据？')
    await wrapper.get('[data-testid=item-tags]').setValue('来源核验, 交叉验证')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(createItem).toHaveBeenCalledWith(
      expect.objectContaining({
        logical_id: 'logical-one',
        stem: '请说明如何核验原始数据？',
        configuration: {
          ...source.configuration,
          metadata: {
            ...(source.configuration!.metadata as object),
            tags: ['来源核验', '交叉验证'],
          },
        },
        answer_key: source.answer_key,
      }),
    )
    expect(wrapper.emitted('saved')?.[0]).toEqual([result])
    expect(source.stem).toBe('如何核验原始数据？')
    expect(source.configuration!.metadata).toMatchObject({ tags: ['来源核验'] })
    expect(wrapper.text()).toContain('不会自动审核或发布')
  })
  it('requires valid metadata and unique objective options before any request', async () => {
    const wrapper = mount(ItemVersionEditor, { props: { source } })
    await wrapper.get('[data-testid=item-options]').setValue('重复\n重复')
    await wrapper.get('form').trigger('submit')
    expect(createItem).not.toHaveBeenCalled()
    expect(wrapper.get('[role=alert]').text()).toContain('选项')
  })
  it('honors explicit JSON field removal without restoring the source configuration', async () => {
    const imageSource = {
      ...source,
      configuration: {
        ...source.configuration,
        media: { images: [{ src: '/assessment-media/source.svg', alt: '旧图片' }] },
      },
    }
    const wrapper = mount(ItemVersionEditor, { props: { source: imageSource } })
    await wrapper.get('[data-testid=item-config]').setValue(
      JSON.stringify({
        custom_unknown: { preserve: true },
        metadata: { replacement_provenance: '新出处' },
      }),
    )
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    const configuration = vi.mocked(createItem).mock.calls[0]![0].configuration
    expect(configuration).not.toHaveProperty('media')
    expect(configuration.metadata).not.toHaveProperty('provenance')
    expect(configuration).toMatchObject({
      custom_unknown: { preserve: true },
      options: ['核对原始数据', '直接采纳'],
      metadata: {
        replacement_provenance: '新出处',
        tags: ['来源核验'],
        scenarios: ['higher_education'],
        content_tier: 'basic',
      },
    })
    expect(imageSource.configuration.media.images).toHaveLength(1)
  })
  it('keeps user edits after a server failure and never emits a successful save', async () => {
    vi.mocked(createItem).mockRejectedValueOnce(new Error('版本冲突，请重新读取'))
    const wrapper = mount(ItemVersionEditor, { props: { source } })
    await wrapper.get('[data-testid=item-stem]').setValue('保留我的修改')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role=alert]').text()).toContain('版本冲突')
    expect((wrapper.get('[data-testid=item-stem]').element as HTMLTextAreaElement).value).toBe(
      '保留我的修改',
    )
    expect(wrapper.emitted('saved')).toBeUndefined()
  })
  it('uses the explicit teacher adapter without any admin API and keeps the same failed-save key', async () => {
    const save = vi
      .fn<AuthoringAdapter['save']>()
      .mockRejectedValueOnce(new Error('请重试'))
      .mockResolvedValue(result)
    const rubrics = vi
      .fn<AuthoringAdapter['rubrics']>()
      .mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 })
    const wrapper = mount(ItemVersionEditor, { props: { source, authoring: { save, rubrics } } })
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[0]?.[1]).toBe(save.mock.calls[1]?.[1])
    expect(save.mock.calls[0]?.[1]).toMatch(/^item-version-/)
    expect(createItem).not.toHaveBeenCalled()
    expect(listContent).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('指派题目 · 版本化编辑')
    wrapper.unmount()
  })
  it('loads only assigned rubric choices and refuses authoring without a source', async () => {
    const save = vi.fn<AuthoringAdapter['save']>().mockResolvedValue(result)
    const rubrics = vi
      .fn<AuthoringAdapter['rubrics']>()
      .mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 })
    const wrapper = mount(ItemVersionEditor, { props: { source, authoring: { save, rubrics } } })
    await wrapper.get('[data-testid=item-type]').setValue('practical')
    await flushPromises()
    expect(rubrics).toHaveBeenCalledWith(0)
    expect(listContent).not.toHaveBeenCalled()
    await wrapper.setProps({ source: null })
    await wrapper.get('[data-testid=item-stem]').setValue('不允许任意新增')
    await wrapper.get('[data-testid=item-options]').setValue('甲\n乙')
    await wrapper.get('[data-testid=item-answer]').setValue('甲')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(save).not.toHaveBeenCalled()
    expect(createItem).not.toHaveBeenCalled()
    expect(wrapper.get('[role=alert]').text()).toContain('指派')
    wrapper.unmount()
  })
  it('does not emit a save result after its source is replaced', async () => {
    let finish!: (value: typeof result) => void
    const save = vi.fn<AuthoringAdapter['save']>(
      () =>
        new Promise<typeof result>((resolve) => {
          finish = resolve
        }),
    )
    const wrapper = mount(ItemVersionEditor, {
      props: { source, authoring: { save, rubrics: vi.fn<AuthoringAdapter['rubrics']>() } },
    })
    await wrapper.get('form').trigger('submit')
    await wrapper.setProps({ source: { ...source, id: 'other-version' } })
    finish(result)
    await flushPromises()
    expect(wrapper.emitted('saved')).toBeUndefined()
    wrapper.unmount()
  })
  it('creates an open practical item with exact published rubric binding and validated configuration', async () => {
    const rubricId = '11111111-1111-4111-8111-111111111111'
    vi.mocked(listContent).mockResolvedValue({
      items: [{ ...source, id: rubricId, title: '核验量规', version: 2 }],
      total: 1,
      offset: 0,
      limit: 20,
    })
    const wrapper = mount(ItemVersionEditor)
    await wrapper.get('[data-testid=item-stem]').setValue('完成一份有引用的分析')
    await wrapper.get('[data-testid=item-type]').setValue('practical')
    await flushPromises()
    await wrapper.get('[data-testid=item-rubric]').setValue(rubricId)
    await wrapper.get('[data-testid=practical-type]').setValue('image')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(createItem).toHaveBeenCalledWith(
      expect.objectContaining({
        item_type: 'practical',
        rubric_version_id: rubricId,
        answer_key: null,
        configuration: expect.objectContaining({
          practical_task_type: 'image',
          practical_max_ai_interactions: 5,
        }),
      }),
    )
    expect(vi.mocked(createItem).mock.calls[0]![0]).not.toHaveProperty('logical_id')
  })
  it('rejects invalid JSON and does not discard unknown fields silently', async () => {
    const wrapper = mount(ItemVersionEditor, { props: { source } })
    await wrapper.get('[data-testid=item-config]').setValue('{bad json')
    await wrapper.get('form').trigger('submit')
    expect(createItem).not.toHaveBeenCalled()
    expect(wrapper.get('[role=alert]').text()).toContain('JSON')
  })
})
