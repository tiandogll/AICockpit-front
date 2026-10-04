import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it } from 'vitest'
import ItemBankView from '../views/ItemBankView.vue'

describe('bank review entry', () => {
  it('opens the real review panel tab from the shareable deep link without reordering legacy tabs', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/item-bank', component: ItemBankView }],
    })
    await router.push('/item-bank?tab=reviews')
    await router.isReady()
    const wrapper = mount(ItemBankView, {
      global: {
        plugins: [createPinia(), router],
        stubs: { ContentVersionPanel: true, BankReviewPanel: true },
      },
    })
    await flushPromises()
    const tabs = wrapper.findAll('.content-tabs button')
    expect(tabs.map((tab) => tab.text())).toEqual([
      '题目版本',
      '评分量规',
      '测评方案（蓝图）',
      '批量导入',
      '待审核题目',
    ])
    expect(tabs[4]!.attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('bank-review-panel-stub').exists()).toBe(true)
    expect(wrapper.find('content-version-panel-stub').exists()).toBe(false)
    wrapper.unmount()
  })
})
