import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import CatLabView from '../views/CatLabView.vue'

describe('CatLabView', () => {
  it('rejects unsupported batch sizes without sending a request', async () => {
    sessionStorage.setItem(
      'zhijian-auth-session',
      JSON.stringify({ accessToken: 'test-token', refreshToken: 'refresh' }),
    )
    setActivePinia(createPinia())
    const request = vi.fn()
    vi.stubGlobal('fetch', request)
    const wrapper = mount(CatLabView)
    await wrapper.findAll('input')[0]!.setValue('f9076789-4c7c-4f25-876e-a7c2c151ae10')
    await wrapper.findAll('input')[1]!.setValue(10000)
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('[role=alert]').text()).toContain('10–2000')
    expect(request).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
  it('renders paired simulation metrics without conflating agreement types', async () => {
    sessionStorage.setItem(
      'zhijian-auth-session',
      JSON.stringify({ accessToken: 'test-token', refreshToken: 'refresh' }),
    )
    setActivePinia(createPinia())
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          examinee_count: 200,
          cat_average_items: 18.36,
          fixed_average_items: 30,
          item_reduction_rate: 0.388,
          exact_level_agreement: 0.5,
          adjacent_level_agreement: 0.962,
          cat_rmse: 0.808,
          fixed_rmse: 0.695,
          precision_stop_rate: 1,
          exposure_fallback_count: 0,
          cat_item_exposure: { a: 0.35 },
          cat_stop_reasons: { target_precision_reached: 200 },
          measurement_note: 'not a formal population norm',
        }),
      }),
    )
    const wrapper = mount(CatLabView)
    const inputs = wrapper.findAll('input')
    await inputs[0]!.setValue('f9076789-4c7c-4f25-876e-a7c2c151ae10')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('38.8%')
    expect(wrapper.text()).toContain('相邻等级一致')
    expect(wrapper.text()).toContain('96.2%')
    expect(wrapper.text()).toContain('完全等级一致')
    expect(wrapper.text()).toContain('50.0%')
    vi.unstubAllGlobals()
  })
})
