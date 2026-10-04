import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import DemoEnvironmentNotice from '../DemoEnvironmentNotice.vue'

describe('DemoEnvironmentNotice', () => {
  it('does not change the normal environment', () => {
    expect(mount(DemoEnvironmentNotice, { props: { enabled: false } }).find('aside').exists()).toBe(false)
  })

  it('clearly labels synthetic data and unavailable AI calls in the isolated demo', () => {
    const notice = mount(DemoEnvironmentNotice, { props: { enabled: true } }).get('[role="note"]')
    expect(notice.text()).toContain('合成案例，非正式成绩')
    expect(notice.text()).toContain('AI 调用已关闭')
  })
})
