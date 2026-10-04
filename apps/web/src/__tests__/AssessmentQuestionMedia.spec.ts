import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import AssessmentQuestionMedia from '../components/AssessmentQuestionMedia.vue'

const validImage = {
  src: '/assessment-media/campus-source-check.svg',
  alt: '活动报告中的原始人数与 AI 总结人数对照图',
  caption: '请结合图中数据回答。',
}

describe('AssessmentQuestionMedia', () => {
  it('renders approved same-origin images with descriptive alt and a text caption', () => {
    const wrapper = mount(AssessmentQuestionMedia, { props: { media: { images: [validImage] } } })

    expect(wrapper.get('img').attributes('src')).toBe(validImage.src)
    expect(wrapper.get('img').attributes('alt')).toBe(validImage.alt)
    expect(wrapper.get('figcaption').text()).toBe(validImage.caption)
    expect(wrapper.get('img').attributes('referrerpolicy')).toBe('no-referrer')
    expect(wrapper.find('iframe, object, embed').exists()).toBe(false)
  })

  it.each([
    'https://external.example/assessment-media/image.svg',
    'https://localhost/assessment-media/image.svg',
    '//external.example/assessment-media/image.svg',
    'data:image/svg+xml,<svg/>',
    'blob:https://localhost/image',
    'javascript:alert(1)',
    '/uploads/image.svg',
    '/assessment-media-other/image.svg',
    '/assessment-media/../image.svg',
    '/assessment-media/./image.svg',
    '/assessment-media/%2e%2e/image.svg',
    '/assessment-media/%252e%252e/image.svg',
    '/assessment-media/%2fexternal.example/image.svg',
    '/assessment-media/\\external.example/image.svg',
    '/assessment-media//external.example/image.svg',
    '/assessment-media/image.svg?redirect=https://external.example',
    '/assessment-media/image.svg#fragment',
    '/assessment-media/image.html',
    '/assessment-media/image.svg\n',
  ])('does not create an image request for unsafe or noncanonical src %s', (src) => {
    const wrapper = mount(AssessmentQuestionMedia, {
      props: { media: { images: [{ ...validImage, src }] } },
    })

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.get('[role="alert"]').text()).toContain('图片材料格式不正确')
  })

  it.each(['', '   ', null, 12, undefined])('rejects missing or blank alt %s', (alt) => {
    const wrapper = mount(AssessmentQuestionMedia, {
      props: { media: { images: [{ ...validImage, alt }] } },
    })

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.get('[role="alert"]').text()).toContain('图片材料格式不正确')
  })

  it.each(['svg', 'png', 'jpg', 'jpeg', 'webp'])(
    'accepts local %s images in named subdirectories',
    (extension) => {
      const wrapper = mount(AssessmentQuestionMedia, {
        props: {
          media: {
            images: [
              { src: `/assessment-media/campus/source-check.${extension}`, alt: '数据对照' },
            ],
          },
        },
      })
      expect(wrapper.get('img').attributes('src')).toContain(`source-check.${extension}`)
    },
  )

  it('keeps the original text-only question layout when media is absent or empty', () => {
    for (const media of [undefined, null, [], { images: [] }]) {
      const wrapper = mount(AssessmentQuestionMedia, { props: { media } })
      expect(wrapper.find('section, figure, img, [role="alert"]').exists()).toBe(false)
    }
  })

  it.each([{}, [validImage], 'image.svg', { images: {} }, { images: [null] }])(
    'handles malformed API media without throwing',
    (media) => {
      const wrapper = mount(AssessmentQuestionMedia, { props: { media } })
      expect(wrapper.find('img').exists()).toBe(false)
      expect(wrapper.get('[role="alert"]').text()).toContain('图片材料格式不正确')
    },
  )

  it('renders valid entries but flags rejected entries, without interpreting caption HTML', () => {
    const wrapper = mount(AssessmentQuestionMedia, {
      props: {
        media: {
          images: [
            { ...validImage, caption: '<script>alert(1)</script>' },
            { src: '//external.example/track.png', alt: '外部图片' },
          ],
        },
      },
    })
    expect(wrapper.findAll('img')).toHaveLength(1)
    expect(wrapper.get('figcaption').text()).toBe('<script>alert(1)</script>')
    expect(wrapper.find('script').exists()).toBe(false)
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
  })

  it('provides the alt text on a broken image and resets the failure for the next item', async () => {
    const wrapper = mount(AssessmentQuestionMedia, { props: { media: { images: [validImage] } } })
    await wrapper.get('img').trigger('error')

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.get('[role="alert"]').text()).toContain('图片暂时无法加载')
    expect(wrapper.get('[role="alert"]').text()).toContain(validImage.alt)
    await wrapper.setProps({
      media: { images: [{ ...validImage, src: '/assessment-media/next-task.svg' }] },
    })
    expect(wrapper.get('img').attributes('src')).toBe('/assessment-media/next-task.svg')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })
})
