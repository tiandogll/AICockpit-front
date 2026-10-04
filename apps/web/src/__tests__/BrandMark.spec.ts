import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import BrandMark from '../components/BrandMark.vue'

describe('provided brand asset', () => {
  it('renders the provided transparent raster without redrawing the M', () => {
    const wrapper = mount(BrandMark)
    expect(wrapper.attributes('aria-hidden')).toBe('true')
    const asset = wrapper.get('image')
    expect(asset.attributes('href')).toContain('ai-measure-logo.png')
    expect(wrapper.find('path').exists()).toBe(false)
    expect(wrapper.attributes('viewBox')).toBe('250 215 800 610')
    const clip = wrapper.get('clipPath')
    expect(asset.attributes('clip-path')).toBe(`url(#${clip.attributes('id')})`)
    expect(clip.get('rect').attributes()).toMatchObject({
      x: '250',
      y: '215',
      width: '800',
      height: '610',
    })
  })
})
