import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import ItemBankView from '../views/ItemBankView.vue'
const mountImport = () => mount(ItemBankView, { global: { stubs: { ContentVersionPanel: true } } })

describe('ItemBankView', () => {
  beforeEach(() => {
    sessionStorage.clear()
    sessionStorage.setItem(
      'zhijian-auth-session',
      JSON.stringify({ accessToken: 'admin-token', refreshToken: 'refresh' }),
    )
    setActivePinia(createPinia())
  })
  it('previews a batch before enabling commit', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          digest: 'a'.repeat(64),
          filename: 'items.csv',
          row_count: 120,
          valid_count: 120,
          error_count: 0,
          errors: [],
          dimension_counts: { foundations: 20, prompting: 20 },
          item_type_counts: { objective: 60, dialogue: 36, practical: 24 },
          difficulty_bands: { easy: 72, medium: 24, advanced: 24 },
          can_commit: true,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountImport()
    await wrapper.findAll('.content-tabs button')[3]!.trigger('click')
    expect(wrapper.find('input[type="password"]').exists()).toBe(false)
    const fileInput = wrapper.find('input[type="file"]')
    Object.defineProperty(fileInput.element, 'files', {
      value: [new File(['content'], 'items.csv', { type: 'text/csv' })],
    })
    await fileInput.trigger('change')
    await wrapper.find('.inspect-button').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('预检通过，可以封存入库')
    expect(wrapper.text()).toContain('120')
    expect(wrapper.find('.seal-button').exists()).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })

  it('shows row errors and withholds commit action', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            digest: 'b'.repeat(64),
            filename: 'items.csv',
            row_count: 1,
            valid_count: 0,
            error_count: 1,
            errors: [{ row: 2, field: 'stem', code: 'required', message: 'stem is required' }],
            dimension_counts: {},
            item_type_counts: {},
            difficulty_bands: {},
            can_commit: false,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    )
    const wrapper = mountImport()
    await wrapper.findAll('.content-tabs button')[3]!.trigger('click')
    const fileInput = wrapper.find('input[type="file"]')
    Object.defineProperty(fileInput.element, 'files', {
      value: [new File(['content'], 'items.csv', { type: 'text/csv' })],
    })
    await fileInput.trigger('change')
    await wrapper.find('.inspect-button').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('发现 1 个问题')
    expect(wrapper.text()).toContain('R2')
    expect(wrapper.find('.seal-button').exists()).toBe(false)
    vi.unstubAllGlobals()
  })
})
