import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import SixDimensionChart from '../components/SixDimensionChart.vue'

describe('six dimension chart', () => {
  it('does not draw missing dimensions as zero or a filled complete profile', () => {
    const wrapper = mount(SixDimensionChart, { props: { dimensions: [{ code: 'foundations', index: 0, level: 'L1', evidence_count: 1 }] } })
    expect(wrapper.text()).toContain('证据不足')
    expect(wrapper.find('[data-testid=radar-profile]').exists()).toBe(false)
    expect(wrapper.get('[data-dimension=foundations]').text()).toContain('0.0')
  })
  it('draws a profile only when all six values are supported', () => {
    const dimensions = ['foundations', 'prompting', 'tool_use', 'evaluation', 'collaboration', 'ethics'].map(code => ({ code, index: 50, level: 'L3', evidence_count: 2 }))
    const wrapper = mount(SixDimensionChart, { props: { dimensions } })
    expect(wrapper.find('[data-testid=radar-profile]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('综合总分')
  })
})
