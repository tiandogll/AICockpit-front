import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import WorkspaceAbilityChart from '../components/WorkspaceAbilityChart.vue'
import { DIMENSIONS } from '../domain/capabilities'

describe('workspace ability chart', () => {
  it('preserves missing evidence instead of turning it into zero or an aggregate score', () => {
    const wrapper = mount(WorkspaceAbilityChart, {
      props: { dimensions: [{ code: 'foundations', index: 0, level: 'L1', evidence_count: 1 }] },
    })
    expect(wrapper.get('[data-dimension="foundations"]').text()).toContain('0')
    expect(wrapper.get('[data-dimension="prompting"]').text()).toContain('证据不足')
    expect(wrapper.get('[data-testid="radar-coverage"]').text()).toBe('1/6')
    expect(wrapper.find('[data-testid="radar-profile"]').exists()).toBe(false)
    expect(wrapper.findAll('.dimension-values > div')).toHaveLength(6)
    expect(wrapper.text()).not.toMatch(/综合|可信度|70.3/)
  })

  it('draws a profile only when all six indices have valid evidence', () => {
    const wrapper = mount(WorkspaceAbilityChart, {
      props: {
        dimensions: DIMENSIONS.map(({ code }) => ({
          code,
          index: 68,
          level: 'L3',
          evidence_count: 2,
        })),
      },
    })
    expect(wrapper.find('[data-testid="radar-profile"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="radar-coverage"]').text()).toBe('6/6')
    expect(wrapper.text()).toContain('六维证据齐全')
  })

  it('does not present non-finite or out-of-range indices as scores', () => {
    const wrapper = mount(WorkspaceAbilityChart, {
      props: {
        dimensions: [
          { code: 'foundations', index: Number.NaN, level: 'L1', evidence_count: 1 },
          { code: 'prompting', index: 120, level: 'L4', evidence_count: 1 },
          { code: 'evaluation', index: 70, level: 'L3', evidence_count: 0 },
        ],
      },
    })
    expect(wrapper.get('[data-testid="radar-coverage"]').text()).toBe('0/6')
    expect(wrapper.findAll('circle[data-evidence]').length).toBe(0)
  })
})
