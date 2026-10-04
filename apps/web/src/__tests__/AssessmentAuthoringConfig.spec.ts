import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ItemPresentationEditor from '../components/ItemPresentationEditor.vue'
import BlueprintTimingEditor from '../components/BlueprintTimingEditor.vue'
import { createBlueprintTimingVersion } from '../services/contentApi'
vi.mock('../services/contentApi', () => ({ createBlueprintTimingVersion: vi.fn() }))
beforeEach(() => vi.clearAllMocks())
describe('assessment authoring controls', () => {
  it('leaves untouched JSON unchanged and preserves unrelated keys on visual edits', async () => {
    const wrapper = mount(ItemPresentationEditor, {
      props: {
        modelValue: JSON.stringify({ options: ['A', 'B'], custom_provenance: 'keep' }),
        dialogue: false,
      },
    })
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    await wrapper.get('[data-testid=target-level]').setValue('L3')
    expect(JSON.parse(wrapper.emitted('update:modelValue')![0]![0] as string)).toEqual({
      options: ['A', 'B'],
      custom_provenance: 'keep',
      target_level: 'L3',
    })
  })
  it('does not replace malformed advanced JSON with empty configuration', () => {
    const wrapper = mount(ItemPresentationEditor, { props: { modelValue: '{bad', dialogue: true } })
    expect(wrapper.get('fieldset').attributes('disabled')).toBeDefined()
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
  it('retries timing clone with the same key and never mutates the source', async () => {
    vi.mocked(createBlueprintTimingVersion).mockRejectedValue(new Error('网络中断'))
    const source = {
      id: 'bp-1',
      logical_id: 'family',
      version: 1,
      publication_status: 'published' as const,
      created_at: '',
      updated_at: '',
      approved_at: null,
      approved_by: null,
      configuration: { assessment_time_limit_seconds: 1800 },
    }
    const wrapper = mount(BlueprintTimingEditor, { props: { source } })
    await wrapper.get('input[type=number]').setValue('1200')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    const calls = vi.mocked(createBlueprintTimingVersion).mock.calls
    expect(calls).toHaveLength(2)
    expect(calls[0]).toEqual(calls[1])
    expect(calls[0]![1]).toBe(1200)
    expect(source.configuration.assessment_time_limit_seconds).toBe(1800)
  })
})
