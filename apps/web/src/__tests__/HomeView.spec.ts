import { mount, RouterLinkStub } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import HomeView from '../views/HomeView.vue'
import { DIMENSIONS } from '../domain/capabilities'

describe('HomeView', () => {
  it('labels demonstration results and does not claim an unverified live bank count or blanket accuracy', () => {
    const wrapper = mount(HomeView, { global: { stubs: { RouterLink: RouterLinkStub } } })
    expect(wrapper.get('[aria-label="六维AI能力示例画像"]').text()).toContain('示例')
    expect(wrapper.text()).not.toContain('100%')
    expect(wrapper.text()).not.toContain('120版本化题目')
    expect(wrapper.text()).not.toContain('智鉴AI')
    for (const dimension of DIMENSIONS) expect(wrapper.text()).toContain(dimension.name)
  })
})
