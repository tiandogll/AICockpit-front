import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AssessmentMaterials from '../components/AssessmentMaterials.vue'
import type { AssessmentItem } from '../services/assessmentApi'

const item: AssessmentItem = {
  session_id: 'session',
  item_version_id: 'question-one',
  sequence: 1,
  item_type: 'objective',
  dimension_code: 'foundations',
  difficulty: 0,
  stem: '选择适用的核验方式',
  configuration: {},
}
function withContent(
  configuration: AssessmentItem['configuration'],
  id = 'question-one',
): AssessmentItem {
  return { ...item, item_version_id: id, configuration }
}
const showModal = vi.fn(function (this: HTMLDialogElement) {
  this.open = true
})
const close = vi.fn(function (this: HTMLDialogElement) {
  this.open = false
})
const wrappers: ReturnType<typeof mount>[] = []
function render(value = item, hideHint = false) {
  const wrapper = mount(AssessmentMaterials, { props: { item: value, hideHint } })
  wrappers.push(wrapper)
  return wrapper
}
beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: showModal,
  })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: close })
})
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'close')
})

describe('assessment materials follow the published question', () => {
  it.each([true, false])(
    'renders no empty help region when content is absent (hideHint=%s)',
    (hideHint) => {
      const wrapper = render(item, hideHint)
      expect(wrapper.find('.assessment-materials').exists()).toBe(false)
      expect(wrapper.find('dialog').exists()).toBe(false)
      expect(wrapper.text()).not.toContain('说明操作过程')
      expect(() => wrapper.vm.open()).not.toThrow()
      expect(showModal).not.toHaveBeenCalled()
    },
  )

  it('ignores empty, whitespace-only and malformed material or guidance values', () => {
    const wrapper = render(
      withContent({
        learner_guidance: ' \n\t ',
        reference_materials: [
          null,
          'not a material',
          {},
          { title: '材料', content: ' \n ' },
          { title: ' ', content: '无有效标题' },
          { title: 123, content: '无有效标题' },
        ],
      }),
      true,
    )
    expect(wrapper.find('.assessment-materials').exists()).toBe(false)
    expect(wrapper.find('.materials-trigger').exists()).toBe(false)
    expect(wrapper.find('dialog').exists()).toBe(false)
    const hintWrapper = render(withContent({ learner_guidance: ' \n\t ' }))
    expect(hintWrapper.find('.exam-guidance').exists()).toBe(false)
  })

  it('opens genuine task materials without fabricating a guidance block', async () => {
    const wrapper = render(
      withContent({
        reference_materials: [
          { title: '公开来源说明', content: '发布机构：某研究机构。\n请依据题干核验日期。' },
        ],
      }),
      true,
    )
    expect(wrapper.find('.exam-guidance').exists()).toBe(false)
    await wrapper.get('button.materials-trigger').trigger('click')
    expect(showModal).toHaveBeenCalledOnce()
    expect(wrapper.get<HTMLDialogElement>('dialog').element.open).toBe(true)
    expect(wrapper.get('dialog article').text()).toContain('公开来源说明')
    expect(wrapper.get('.material-scope').text()).toContain('不提供正式作答答案')
    wrapper.vm.open()
    expect(showModal).toHaveBeenCalledOnce()
    await wrapper.get('[aria-label="关闭任务资料"]').trigger('click')
    expect(wrapper.get<HTMLDialogElement>('dialog').element.open).toBe(false)
  })

  it('shows only configured public guidance and never private scoring fields', () => {
    const wrapper = render(
      withContent({
        learner_guidance: '  请只选择一个选项。\n依据题面数据判断。  ',
        scoring_prompt: '隐藏评分要求',
        answer_key: '隐藏正确答案',
      }),
    )
    expect(wrapper.get('.exam-guidance p').text()).toBe('请只选择一个选项。\n依据题面数据判断。')
    expect(wrapper.find('.materials-trigger').exists()).toBe(false)
    expect(wrapper.find('dialog').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('隐藏')
    expect(() => wrapper.vm.open()).not.toThrow()
  })

  it('keeps material access exposed when guidance and materials both exist', () => {
    const wrapper = render(
      withContent({
        learner_guidance: '请参考下列公开资料。',
        reference_materials: [{ title: '资料一', content: '公开内容' }],
      }),
    )
    expect(wrapper.get('.exam-guidance').text()).toContain('请参考下列公开资料')
    wrapper.vm.open()
    expect(wrapper.get<HTMLDialogElement>('dialog').element.open).toBe(true)
  })

  it('closes an open drawer when switching questions and removes stale content and margins', async () => {
    const wrapper = render(
      withContent({
        learner_guidance: '旧题提示',
        reference_materials: [{ title: '旧题资料', content: '旧题内容' }],
      }),
    )
    wrapper.vm.open()
    await wrapper.setProps({ item: withContent({ learner_guidance: '新题提示' }, 'question-two') })
    expect(close).toHaveBeenCalledOnce()
    expect(wrapper.find('dialog').exists()).toBe(false)
    expect(wrapper.get('.exam-guidance').text()).toContain('新题提示')
    expect(wrapper.text()).not.toContain('旧题')
    await wrapper.setProps({ item: withContent({}, 'question-three') })
    expect(wrapper.find('.assessment-materials').exists()).toBe(false)
    expect(() => wrapper.vm.open()).not.toThrow()
  })
})
