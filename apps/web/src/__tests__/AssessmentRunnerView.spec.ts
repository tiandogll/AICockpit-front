import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AssessmentRunnerView from '../views/AssessmentRunnerView.vue'
import { useAccessStore } from '../stores/access'
import type { AssessmentItem } from '../services/assessmentApi'
import type { AssessmentWorkspace, DraftSnapshot } from '../services/assessmentWorkspaceApi'

const image = { src: '/assessment-media/assigned-question.svg', alt: '待核验的数据对照图' }
function fixture(type: AssessmentItem['item_type'] = 'objective'): AssessmentWorkspace {
  const item: AssessmentItem = {
    session_id: 'session-1',
    item_version_id: 'item-1',
    sequence: 1,
    item_type: type,
    dimension_code: 'evaluation',
    difficulty: 0,
    stem: '根据图片材料判断结论是否可靠。',
    configuration: {
      options: ['可靠', '需要核验'],
      dialogue_max_turns: 2,
      media: { images: [image] },
    },
  }
  return {
    session: {
      id: 'session-1',
      organization_id: 'org-1',
      blueprint_version_id: 'bp',
      mode: 'standard',
      scenario: 'higher_education',
      status: 'active',
      blueprint_snapshot: {},
      replayed: false,
    },
    server_now: '2026-09-15T06:00:00Z',
    blueprint_name: '图文测评',
    min_items: 1,
    max_items: 18,
    answered_count: 0,
    dispatched_count: 1,
    flagged_count: 0,
    current_item: item,
    items: [
      {
        item_version_id: 'item-1',
        sequence: 1,
        item_type: type,
        dimension_code: 'evaluation',
        answered_at: null,
        flagged: false,
      },
    ],
    type_coverage: [{ item_type: type, answered_count: 0, minimum: 1 }],
    can_complete: false,
    completion_reason: 'insufficient',
    unmet_dimensions: [],
    unmet_item_types: [],
  }
}
function mockApi(state: AssessmentWorkspace) {
  let draft: DraftSnapshot = { draft: null, context_revision: 0, can_edit: true }
  const mock = vi.fn<typeof fetch>(async (input, init) => {
    const path = String(input)
    let data: unknown
    if (path.endsWith('/workspace')) data = state
    else if (path.endsWith('/draft')) {
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body))
        draft = {
          draft: { ...body, revision: body.revision + 1, saved_at: '2026-09-15T06:00:01Z' },
          context_revision: 0,
          can_edit: true,
        }
      }
      data = draft
    } else if (path.endsWith('/answers')) {
      state.answered_count = 1
      state.current_item = null
      state.can_complete = true
      state.items[0]!.answered_at = '2026-09-15T06:00:02Z'
      data = { answer_id: 'answer-1', replayed: false }
    } else if (path.endsWith('/practical/item-1'))
      data = {
        workspace_id: 'pw',
        state: 'active',
        task_type: 'text',
        stem: state.current_item?.stem,
        media: { images: [image] },
        max_ai_interactions: 3,
        event_count: 0,
        interaction_count: 0,
        artifact_count: 0,
        submitted_at: null,
        can_edit: true,
        events: [],
        interactions: [],
        artifacts: [],
      }
    else if (path.endsWith('/dialogue/item-1'))
      return new Response(JSON.stringify({ detail: 'not found' }), { status: 404 })
    else return new Response(JSON.stringify({ detail: `not mocked: ${path}` }), { status: 404 })
    return new Response(JSON.stringify(data), { status: 200 })
  })
  vi.stubGlobal('fetch', mock)
  return mock
}
async function render() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/assessment/:sessionId', component: AssessmentRunnerView },
      { path: '/assessment', component: { template: '<div />' } },
      { path: '/reports/:sessionId', component: { template: '<div />' } },
    ],
  })
  await router.push('/assessment/session-1')
  const wrapper = mount(AssessmentRunnerView, { global: { plugins: [router] } })
  // jsdom does not implement native dialog methods; the browser smoke test does.
  for (const dialog of wrapper.findAll('dialog')) {
    const element = dialog.element as HTMLDialogElement
    element.close = vi.fn()
    element.showModal = vi.fn()
  }
  return wrapper
}
describe('AssessmentRunnerView server workspace', () => {
  beforeEach(() => {
    sessionStorage.clear()
    sessionStorage.setItem(
      'zhijian-auth-session',
      JSON.stringify({ accessToken: 'access-token', refreshToken: 'refresh-token' }),
    )
    setActivePinia(createPinia())
    vi.stubGlobal('crypto', { randomUUID: () => 'stable-answer-key' })
  })
  afterEach(() => vi.unstubAllGlobals())
  it('resumes owned legacy sessions without switching the unified platform context', async () => {
    const access = useAccessStore()
    access.singlePlatform = true
    access.ready = true
    access.organizationId = 'platform'
    const select = vi.spyOn(access, 'selectOrganization')
    mockApi(fixture())
    const wrapper = await render()
    await flushPromises()
    expect(select).not.toHaveBeenCalled()
    expect(access.organizationId).toBe('platform')
    expect(wrapper.find('input[type=radio]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('无法同步此测评所属组织')
    wrapper.unmount()
  })
  it('offers a separately confirmed early end without meeting the completion minimum', async () => {
    const state = fixture()
    const api = mockApi(state)
    const original = api.getMockImplementation()!
    api.mockImplementation(async (url, init) => {
      if (String(url).endsWith('/abandon')) {
        state.session = { ...state.session, status: 'abandoned', ended_reason: 'user_ended' }
        state.current_item = null
        return new Response(JSON.stringify(state.session))
      }
      return original(url, init)
    })
    const wrapper = await render()
    await flushPromises()
    const early = wrapper.get('[data-testid="early-end-assessment"]')
    expect(early.attributes('disabled')).toBeUndefined()
    await early.trigger('click')
    expect(api.mock.calls.some(([url]) => String(url).endsWith('/abandon'))).toBe(false)
    const dialog = wrapper.get('dialog[aria-label="确认提前结束"]')
    expect(dialog.text()).toContain('不能继续本次测评')
    await dialog.get('[data-testid="confirm-early-end"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('已提前结束 · 测评未完成')
    expect(wrapper.find('input[type=radio]').exists()).toBe(false)
    expect(api.mock.calls.filter(([url]) => String(url).endsWith('/abandon'))).toHaveLength(1)
    expect(api.mock.calls.some(([url]) => String(url).endsWith('/complete'))).toBe(false)
    wrapper.unmount()
  })
  it('keeps early-end failures visible and permits retry without claiming success', async () => {
    const state = fixture()
    const api = mockApi(state)
    const original = api.getMockImplementation()!
    api.mockImplementation(async (url, init) => {
      if (String(url).endsWith('/abandon')) throw new TypeError('Failed to fetch')
      return original(url, init)
    })
    const wrapper = await render()
    await flushPromises()
    await wrapper.get('[data-testid="early-end-assessment"]').trigger('click')
    const dialog = wrapper.get('dialog[aria-label="确认提前结束"]')
    await dialog.get('[data-testid="confirm-early-end"]').trigger('click')
    await flushPromises()
    expect(dialog.get('[role="alert"]').text()).toContain('未能确认结束结果')
    expect(dialog.get('[data-testid="confirm-early-end"]').attributes('disabled')).toBeUndefined()
    expect(state.session.status).toBe('active')
    wrapper.unmount()
  })
  it.each(['objective', 'dialogue', 'practical'] as const)(
    'renders assigned %s image exactly once',
    async (type) => {
      mockApi(fixture(type))
      const wrapper = await render()
      await flushPromises()
      expect(wrapper.findAll('img')).toHaveLength(1)
      expect(wrapper.get('img').attributes('src')).toBe(image.src)
      expect(wrapper.get('img').attributes('alt')).toBe(image.alt)
      wrapper.unmount()
    },
  )
  it('saves draft before submitting once and requires explicit completion', async () => {
    const api = mockApi(fixture())
    const wrapper = await render()
    await flushPromises()
    await wrapper.get('input[type=radio]').setValue(true)
    await wrapper.get('form.exam-objective').trigger('submit')
    await flushPromises()
    const writes = api.mock.calls.filter(
      ([, init]) => init?.method === 'PUT' || init?.method === 'POST',
    )
    expect(writes.map(([url]) => String(url).split('/').pop())).toEqual(['draft', 'answers'])
    expect((writes[1]![1]?.headers as Record<string, string>)['Idempotency-Key']).toContain(
      'stable-answer-key',
    )
    expect(wrapper.text()).toContain('本次作答已达到完成条件')
    expect(wrapper.findComponent({ name: 'AssessmentSessionFrame' }).props('saveLabel')).toBe(
      '作答已保存 · 待确认完成',
    )
    expect(api.mock.calls.some(([url]) => String(url).endsWith('/complete'))).toBe(false)
    wrapper.unmount()
  })
  it('clicking current question does not erase an unsaved selection', async () => {
    mockApi(fixture())
    const wrapper = await render()
    await flushPromises()
    await wrapper.get('input[type=radio]').setValue(true)
    await wrapper.findComponent({ name: 'AssessmentSessionFrame' }).vm.$emit('review', 'item-1')
    await flushPromises()
    expect((wrapper.get('input[type=radio]').element as HTMLInputElement).checked).toBe(true)
    wrapper.unmount()
  })
  it('shows completion failure inside the dialog and safely retries with the same key', async () => {
    const state = fixture()
    state.current_item = null
    state.can_complete = true
    const api = mockApi(state)
    const original = api.getMockImplementation()!
    const keys: string[] = []
    api.mockImplementation(async (url, init) => {
      if (String(url).endsWith('/complete')) {
        keys.push(new Headers(init?.headers).get('Idempotency-Key')!)
        if (keys.length === 1) throw new TypeError('Failed to fetch')
        state.session.status = 'completed'
        return new Response(
          JSON.stringify({ session_id: 'session-1', report_id: 'report-1', is_complete: false }),
        )
      }
      return original(url, init)
    })
    const wrapper = await render()
    await flushPromises()
    const dialog = wrapper.get('dialog[aria-label="确认完成测试"]')
    const confirm = dialog.findAll('button')[1]!
    await confirm.trigger('click')
    await flushPromises()
    expect(dialog.get('[role="alert"]').text()).toContain('未能确认封存结果')
    expect(dialog.text()).not.toContain('Failed to fetch')
    expect(confirm.attributes('disabled')).toBeUndefined()
    await confirm.trigger('click')
    await flushPromises()
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBe(keys[1])
    expect(wrapper.text()).toContain('本次测评已封存')
    wrapper.unmount()
  })
  it('synchronizes resumed organization and presents terminal records read-only', async () => {
    const access = useAccessStore()
    access.ready = true
    access.organizationId = 'other'
    const select = vi.spyOn(access, 'selectOrganization').mockImplementation(async (id) => {
      access.organizationId = id
    })
    const state = fixture()
    state.session.status = 'completed'
    state.current_item = null
    mockApi(state)
    const wrapper = await render()
    await flushPromises()
    expect(select).toHaveBeenCalledWith('org-1')
    expect(wrapper.text()).toContain('本次测评已封存')
    expect(wrapper.find('input[type=radio]').exists()).toBe(false)
    wrapper.unmount()
  })
  it('keeps successful completion when the follow-up workspace refresh fails', async () => {
    const state = fixture()
    state.current_item = null
    state.can_complete = true
    const api = mockApi(state)
    const original = api.getMockImplementation()!
    let sealed = false
    api.mockImplementation(async (url, init) => {
      if (String(url).endsWith('/complete')) {
        sealed = true
        return new Response(
          JSON.stringify({ session_id: 'session-1', report_id: 'report-1', is_complete: false }),
        )
      }
      if (sealed && String(url).endsWith('/workspace')) throw new TypeError('Failed to fetch')
      return original(url, init)
    })
    const wrapper = await render()
    await flushPromises()
    await wrapper.get('dialog[aria-label="确认完成测试"]').findAll('button')[1]!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('本次测评已封存')
    expect(wrapper.text()).toContain('测评已成功封存，但最新状态读取失败')
    expect(wrapper.get('dialog[aria-label="确认完成测试"]').find('[role="alert"]').exists()).toBe(
      false,
    )
    expect(api.mock.calls.filter(([url]) => String(url).endsWith('/complete'))).toHaveLength(1)
    wrapper.unmount()
  })
  it('deadline zero disables keyboard and button submission', async () => {
    const state = fixture()
    state.session.expires_at = state.server_now
    mockApi(state)
    const wrapper = await render()
    await flushPromises()
    expect(wrapper.get('fieldset').attributes('disabled')).toBeDefined()
    const submit = wrapper.findAll('button').find((button) => button.text() === '提交回答并继续')
    expect(submit?.attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('replaces a failed initial load with an actionable state and can recover', async () => {
    const api = mockApi(fixture())
    const original = api.getMockImplementation()!
    let failed = true
    api.mockImplementation(async (url, init) => {
      if (failed && String(url).endsWith('/workspace')) throw new TypeError('网络连接失败')
      return original(url, init)
    })
    const wrapper = await render()
    await flushPromises()
    const failure = wrapper.get('[data-testid="assessment-load-failed"]')
    expect(failure.text()).toContain('暂时无法读取本次测评')
    expect(failure.get('a').attributes('href')).toBe('/assessment')
    expect(wrapper.find('.runner-loading').exists()).toBe(false)
    expect(wrapper.text()).toContain('网络连接失败')
    failed = false
    await failure.get('button').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="assessment-load-failed"]').exists()).toBe(false)
    expect(wrapper.find('input[type=radio]').exists()).toBe(true)
    expect(wrapper.find('.exam-error').exists()).toBe(false)
    wrapper.unmount()
  })
})
