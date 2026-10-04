import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AssessmentRunnerView from '../views/AssessmentRunnerView.vue'
import { useAccessStore } from '../stores/access'
import { useAuthStore } from '../stores/auth'

const wrappers: VueWrapper[] = []
const fixture = (paused: boolean) => ({
  session: {
    id: 'session-1',
    organization_id: 'org-1',
    blueprint_version_id: 'bp',
    mode: 'standard',
    scenario: 'higher_education',
    status: 'active',
    blueprint_snapshot: {},
    replayed: false,
    paused_at: paused ? '2026-09-20T00:00:00Z' : null,
    activity_revision: 5,
  },
  server_now: '2026-09-20T00:01:00Z',
  blueprint_name: '暂存测试',
  min_items: 2,
  max_items: 18,
  answered_count: 1,
  dispatched_count: 2,
  flagged_count: 0,
  current_item: {
    session_id: 'session-1',
    item_version_id: 'item-2',
    sequence: 2,
    item_type: 'objective',
    dimension_code: 'evaluation',
    difficulty: 0,
    stem: '选择需要核验的信息',
    configuration: { options: ['原始来源', '未经核实的转述'] },
  },
  items: [],
  type_coverage: [],
  can_complete: false,
  completion_reason: 'insufficient',
  unmet_dimensions: [],
  unmet_item_types: [],
})

async function render(paused = true, pauseFails = false) {
  const state = fixture(paused)
  const request = vi.fn<typeof fetch>(async (input, init) => {
    const path = String(input)
    if (path.endsWith('/activity')) {
      if (pauseFails)
        return new Response(JSON.stringify({ detail: 'SESSION_BUSY: 请等待生成完成' }), {
          status: 409,
        })
      const body = JSON.parse(String(init?.body))
      expect(body.revision).toBe(state.session.activity_revision)
      state.session.paused_at = body.paused ? '2026-09-20T00:01:00Z' : null
      state.session.activity_revision += 1
      return Response.json(state.session)
    }
    if (path.endsWith('/workspace')) return Response.json(state)
    if (path.endsWith('/draft'))
      return Response.json({
        draft: {
          response:
            init?.method === 'PUT'
              ? JSON.parse(String(init.body)).response
              : { selected_option: '原始来源' },
          revision: 1,
          context_revision: 0,
          saved_at: '2026-09-20T00:00:00Z',
        },
        context_revision: 0,
        can_edit: !state.session.paused_at,
      })
    if (path.endsWith('/features'))
      return Response.json({
        training_enabled: false,
        training_content_status: 'formative_preview',
        growth_guide_mode: 'deepseek',
        attachments_enabled: true,
        assessment_in_progress: !state.session.paused_at,
      })
    return new Response(JSON.stringify({ detail: 'unexpected endpoint' }), { status: 404 })
  })
  vi.stubGlobal('fetch', request)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/assessment/:sessionId', component: AssessmentRunnerView },
      { path: '/workspace', component: { template: '<div>工作台</div>' } },
    ],
  })
  await router.push('/assessment/session-1')
  const wrapper = mount({ template: '<RouterView />' }, { global: { plugins: [router] } })
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, request, router, state }
}

describe('explicit assessment pause and resume', () => {
  beforeEach(() => {
    sessionStorage.clear()
    setActivePinia(createPinia())
    const auth = useAuthStore()
    auth.accessToken = 'synthetic-token'
    auth.refreshToken = 'synthetic-refresh'
    auth.user = { id: 'actor', email: null, display_name: '学员', is_active: true }
    const access = useAccessStore()
    access.ready = true
    access.organizationId = 'org-1'
  })
  afterEach(() => {
    wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
    vi.unstubAllGlobals()
  })
  it('does not resume or dispatch simply by opening a saved assessment', async () => {
    const { wrapper, request } = await render()
    expect(wrapper.text()).toContain('本次测评已暂存')
    expect(wrapper.find('input[type=radio]').exists()).toBe(false)
    expect(
      request.mock.calls.some(
        ([url]) => String(url).endsWith('/activity') || String(url).endsWith('/next'),
      ),
    ).toBe(false)
    await wrapper.get('[data-testid="resume-assessment"]').trigger('click')
    await flushPromises()
    expect(request.mock.calls.filter(([url]) => String(url).endsWith('/activity'))).toHaveLength(1)
    expect(wrapper.find('input[type=radio]').exists()).toBe(true)
    expect((wrapper.get('input[type=radio]').element as HTMLInputElement).checked).toBe(true)
  })
  it('saves the draft before pausing and only then exits', async () => {
    const { wrapper, request, router, state } = await render(false)
    await wrapper.findAll('input[type=radio]')[1]!.setValue(true)
    await wrapper.findComponent({ name: 'AssessmentSessionFrame' }).vm.$emit('exit')
    await flushPromises()
    const writes = request.mock.calls.filter(([, init]) => init?.method === 'PUT')
    expect(writes.map(([url]) => String(url).split('/').pop())).toEqual(['draft', 'activity'])
    expect(state.session.paused_at).not.toBeNull()
    expect(router.currentRoute.value.path).toBe('/workspace')
  })
  it('stays on the assessment when the server cannot confirm pause', async () => {
    const { wrapper, request, router } = await render(false, true)
    await wrapper.findComponent({ name: 'AssessmentSessionFrame' }).vm.$emit('exit')
    await flushPromises()
    expect(wrapper.text()).toContain('SESSION_BUSY')
    expect(router.currentRoute.value.path).toBe('/assessment/session-1')
    expect(request.mock.calls.filter(([url]) => String(url).endsWith('/activity'))).toHaveLength(1)
  })
  it('also pauses before leaving through sidebar navigation', async () => {
    const { request, router, state } = await render(false)
    await router.push('/workspace')
    await flushPromises()
    expect(state.session.paused_at).not.toBeNull()
    expect(request.mock.calls.filter(([url]) => String(url).endsWith('/activity'))).toHaveLength(1)
    expect(router.currentRoute.value.path).toBe('/workspace')
  })
  it('disables completion and does not show answer actions on a paused screen', async () => {
    const { wrapper } = await render()
    expect(wrapper.get('.exam-finish').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-testid="submit-current-answer"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="flag-question"]').exists()).toBe(false)
  })
})
