import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AssessmentView from '../views/AssessmentView.vue'
import { useAccessStore } from '../stores/access'
import { createAssessmentSession, getLaunchContext } from '../services/assessmentApi'
import type { AssessmentSession, LaunchBlueprint, LaunchContext } from '../services/assessmentApi'

vi.mock('../services/assessmentApi', () => ({
  getLaunchContext: vi.fn(),
  createAssessmentSession: vi.fn(),
  operationKey: () => 'stable-key',
}))
const wrappers: ReturnType<typeof mount>[] = []
function plan(
  mode: LaunchBlueprint['mode'],
  overrides: Partial<LaunchBlueprint> = {},
): LaunchBlueprint {
  return {
    id: mode,
    name: `${mode} 已发布方案`,
    mode,
    scenario: 'higher_education',
    min_items: 6,
    max_items: 9,
    dimension_codes: ['evaluation'],
    item_type_minimums: { objective: 1, dialogue: 1, practical: 1 },
    organization_ids: ['org'],
    ...overrides,
  }
}
let launch: LaunchContext
beforeEach(() => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  const access = useAccessStore()
  access.organizationId = 'org'
  access.ready = true
  access.singlePlatform = true
  access.organizations = [{ id: 'org', name: 'AI Measure', role: 'learner', capabilities: [] }]
  launch = {
    organizations: [{ id: 'org', name: 'AI Measure', role: 'learner' }],
    blueprints: [plan('rapid'), plan('standard'), plan('specialized'), plan('fixed')],
    active_sessions: [],
  }
  vi.mocked(getLaunchContext).mockImplementation(async () => launch)
  vi.mocked(createAssessmentSession).mockResolvedValue({ id: 'new-session' } as AssessmentSession)
})
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()))
async function render() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/assessment', component: AssessmentView },
      { path: '/assessment/:sessionId', component: { template: '<div>答题区</div>' } },
    ],
  })
  await router.push('/assessment')
  const wrapper = mount(AssessmentView, {
    global: {
      plugins: [router],
      stubs: { ResumeProgress: true },
    },
  })
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, router }
}
describe('learner self-service entry', () => {
  it.each(['rapid', 'standard', 'specialized', 'fixed'] as const)(
    'only selects %s until the learner confirms with the start button',
    async (mode) => {
      const { wrapper, router } = await render()
      await wrapper.get(`[data-testid=mode-${mode}]`).trigger('click')
      await flushPromises()
      expect(createAssessmentSession).not.toHaveBeenCalled()
      expect(router.currentRoute.value.path).toBe('/assessment')
      expect(wrapper.get(`[data-testid=mode-${mode}]`).attributes('aria-pressed')).toBe('true')
      expect(wrapper.get('[data-testid=confirmed-blueprint]').text()).toContain(
        `${mode} 已发布方案`,
      )
      await wrapper.get('[data-testid=start-assessment]').trigger('click')
      await flushPromises()
      expect(createAssessmentSession).toHaveBeenCalledExactlyOnceWith('org', mode, 'stable-key')
      expect(router.currentRoute.value.path).toBe('/assessment/new-session')
    },
  )
  it('selects a specialty before launch instead of silently selecting a dimension', async () => {
    launch.blueprints.push(plan('specialized', { id: 'ethics-plan', dimension_codes: ['ethics'] }))
    const { wrapper } = await render()
    await wrapper.get('[data-testid=mode-specialized]').trigger('click')
    await flushPromises()
    expect(createAssessmentSession).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('选择专项维度与方案')
    expect(wrapper.get('[data-testid=launch-blueprint]').text()).toContain('伦理合规')
    await wrapper.get('[data-testid=launch-blueprint]').setValue('ethics-plan')
    await wrapper.get('[data-testid=start-assessment]').trigger('click')
    await flushPromises()
    expect(createAssessmentSession).toHaveBeenCalledWith('org', 'ethics-plan', 'stable-key')
  })
  it('keeps timed assessment consent required', async () => {
    launch.blueprints = [plan('standard', { assessment_time_limit_seconds: 600 })]
    const { wrapper } = await render()
    await wrapper.get('[data-testid=mode-standard]').trigger('click')
    await flushPromises()
    expect(createAssessmentSession).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('请阅读并确认下方限时规则')
    expect(wrapper.get('[data-testid=start-assessment]').attributes('disabled')).toBeDefined()
    await wrapper.get('.timing-ack input').setValue(true)
    await wrapper.get('[data-testid=start-assessment]').trigger('click')
    await flushPromises()
    expect(createAssessmentSession).toHaveBeenCalledOnce()
  })
  it('resumes an existing assessment without creating another session', async () => {
    launch.active_sessions = [
      {
        id: 'existing',
        organization_id: 'org',
        blueprint_version_id: 'standard',
        blueprint_name: '在测方案',
        mode: 'standard',
        scenario: 'higher_education',
        status: 'active',
        created_at: '',
      },
    ]
    const { wrapper, router } = await render()
    await wrapper.get('[data-testid=mode-standard]').trigger('click')
    await flushPromises()
    expect(createAssessmentSession).not.toHaveBeenCalled()
    expect(router.currentRoute.value.path).toBe('/assessment')
    expect(wrapper.get('[data-testid=start-assessment]').text()).toContain('继续此方案测评')
    await wrapper.get('[data-testid=start-assessment]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/assessment/existing')
    expect(createAssessmentSession).not.toHaveBeenCalled()
  })
  it('explains unavailable modes without inventing a plan or submitting a request', async () => {
    launch.blueprints = [plan('rapid')]
    const { wrapper } = await render()
    await wrapper.get('[data-testid=mode-fixed]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('平台尚未发布你可参与的有效方案')
    expect(createAssessmentSession).not.toHaveBeenCalled()
  })
  it('prefers formal plans to synthetic experience and enforces organization scope', async () => {
    launch.blueprints = [
      plan('standard', { id: 'demo', data_origin: 'synthetic' }),
      plan('standard', { id: 'denied', organization_ids: ['other-org'] }),
      plan('standard', { id: 'formal' }),
    ]
    const { wrapper } = await render()
    await wrapper.get('[data-testid=mode-standard]').trigger('click')
    await flushPromises()
    expect(createAssessmentSession).not.toHaveBeenCalled()
    await wrapper.get('[data-testid=start-assessment]').trigger('click')
    await flushPromises()
    expect(createAssessmentSession).toHaveBeenCalledExactlyOnceWith('org', 'formal', 'stable-key')
  })
  it('locks double clicks and retries failed starts with the same operation key', async () => {
    let reject!: (error: Error) => void
    vi.mocked(createAssessmentSession).mockImplementationOnce(
      () =>
        new Promise((_, fail) => {
          reject = fail
        }),
    )
    const { wrapper } = await render()
    await wrapper.get('[data-testid=mode-rapid]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid=start-assessment]').trigger('click')
    await wrapper.get('[data-testid=start-assessment]').trigger('click')
    await wrapper.get('[data-testid=mode-standard]').trigger('click')
    expect(createAssessmentSession).toHaveBeenCalledOnce()
    reject(new Error('网络中断'))
    await flushPromises()
    expect(wrapper.get('[role=alert]').text()).toContain('网络中断')
    await wrapper.get('[data-testid=mode-rapid]').trigger('click')
    await flushPromises()
    expect(createAssessmentSession).toHaveBeenCalledOnce()
    await wrapper.get('[data-testid=start-assessment]').trigger('click')
    await flushPromises()
    expect(vi.mocked(createAssessmentSession).mock.calls[0]).toEqual(
      vi.mocked(createAssessmentSession).mock.calls[1],
    )
  })

  it('keeps retired-catalog experience sessions in resume only, never on a current mode card', async () => {
    launch.active_sessions = [
      {
        id: 'old-demo',
        organization_id: 'org',
        blueprint_version_id: 'old-plan',
        blueprint_name: '旧体验测评',
        mode: 'standard',
        scenario: 'general',
        status: 'active',
        created_at: '',
        data_origin: 'synthetic',
      },
    ]
    const { wrapper, router } = await render()
    const card = wrapper.get('[data-testid=mode-standard]')
    expect(card.text()).toContain('standard 已发布方案')
    expect(card.text()).not.toContain('体验')
    expect(wrapper.get('.resume-strip').text()).toContain('旧体验测评')
    await card.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/assessment')
    expect(createAssessmentSession).not.toHaveBeenCalled()
    await wrapper.get('[data-testid=start-assessment]').trigger('click')
    await flushPromises()
    expect(createAssessmentSession).toHaveBeenCalledExactlyOnceWith('org', 'standard', 'stable-key')
  })

  it('changes scenario without starting and shows non-duplicated labels', async () => {
    launch.blueprints = [
      plan('standard', { name: 'AI能力标准测 · 高校学习' }),
      plan('standard', {
        id: 'enterprise',
        name: 'AI能力标准测 · 企业办公',
        scenario: 'enterprise',
      }),
      plan('fixed', { name: 'AI能力固定卷 · 高校学习', min_items: 18, max_items: 18 }),
    ]
    const { wrapper, router } = await render()
    const options = wrapper.get('[data-testid=launch-blueprint]')
    expect(options.findAll('option').map((row) => row.text())).toEqual([
      'AI能力标准测 · 高校学习 · 6–9题',
      'AI能力标准测 · 企业办公 · 6–9题',
    ])
    await options.setValue('enterprise')
    await flushPromises()
    expect(createAssessmentSession).not.toHaveBeenCalled()
    expect(router.currentRoute.value.path).toBe('/assessment')
    expect(wrapper.get('.launch-preview h2').text()).toBe('AI能力标准测 · 企业办公')
    expect(wrapper.get('[data-testid=mode-standard]').text()).toContain('AI能力标准测 · 企业办公')
    await wrapper.get('[data-testid=mode-fixed]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid=confirmed-blueprint] strong').text()).toBe(
      'AI能力固定卷 · 高校学习 · 18题',
    )
    expect(createAssessmentSession).not.toHaveBeenCalled()
  })

  it('does not duplicate a specialty already present in the plan name', async () => {
    launch.blueprints = [plan('specialized', { name: 'AI能力专项测 · 高校学习 · 结果评估' })]
    const { wrapper } = await render()
    await wrapper.get('[data-testid=mode-specialized]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid=confirmed-blueprint] strong').text()).toBe(
      'AI能力专项测 · 高校学习 · 结果评估 · 6–9题',
    )
  })

  it('shows only the configured objective type for rapid and specialty plans', async () => {
    launch.blueprints = [
      plan('rapid', {
        min_items: 12,
        max_items: 18,
        dimension_codes: [
          'foundations',
          'prompting',
          'tool_use',
          'evaluation',
          'collaboration',
          'ethics',
        ],
        item_type_minimums: { objective: 12, dialogue: 0, practical: 0 },
      }),
      plan('specialized', {
        min_items: 2,
        max_items: 5,
        item_type_minimums: { objective: 2, dialogue: 0, practical: 0 },
      }),
    ]
    const { wrapper } = await render()
    await wrapper.get('[data-testid=mode-rapid]').trigger('click')
    await flushPromises()
    let preview = wrapper.get('.launch-preview')
    expect(wrapper.get('[data-testid=mode-rapid] p').text()).toBe('客观题 · 六维初步画像')
    expect(preview.get('.type-coverage').text()).toBe('客观题 12题起')
    expect(preview.find('.type-coverage i').exists()).toBe(false)
    expect(preview.text()).toContain('本次仅含客观题')
    expect(preview.text()).not.toContain('对话题')
    expect(preview.text()).not.toContain('实操题')
    expect(wrapper.find('[data-testid=launch-blueprint]').exists()).toBe(false)
    expect(createAssessmentSession).not.toHaveBeenCalled()

    await wrapper.get('[data-testid=mode-specialized]').trigger('click')
    await flushPromises()
    preview = wrapper.get('.launch-preview')
    expect(wrapper.get('[data-testid=mode-specialized] p').text()).toBe('聚焦单一能力维度 · 客观题')
    expect(preview.get('.type-coverage').text()).toBe('客观题 2题起')
    expect(preview.text()).toContain('结果评估')
    expect(preview.text()).not.toContain('对话题')
    expect(preview.text()).not.toContain('实操题')
  })

  it('retains all configured mixed types and uses exact fixed counts only when guaranteed', async () => {
    launch.blueprints = [
      plan('standard'),
      plan('fixed', {
        min_items: 18,
        max_items: 18,
        item_type_minimums: { objective: 6, dialogue: 6, practical: 6 },
      }),
    ]
    const { wrapper } = await render()
    expect(wrapper.get('.type-coverage').text()).toBe('客观题 1题起对话题 1题起实操题 1题起')
    expect(wrapper.findAll('.type-coverage i')).toHaveLength(2)
    expect(wrapper.get('.launch-preview').text()).not.toContain('本次仅含')
    await wrapper.get('[data-testid=mode-fixed]').trigger('click')
    await flushPromises()
    expect(wrapper.get('.type-coverage').text()).toBe('客观题 6题对话题 6题实操题 6题')
    expect(wrapper.get('.launch-preview').text()).toContain('固定题量')
    expect(wrapper.get('.dimension-details').text()).toContain('以上为本卷题型数量')
    expect(wrapper.get('.dimension-details').text()).toContain('不按学员随机换题')
  })

  it('keeps only applicable timing notes without weakening time-limit consent', async () => {
    launch.blueprints = [
      plan('rapid', {
        assessment_time_limit_seconds: 300,
        item_type_minimums: { objective: 6, dialogue: 0, practical: 0 },
      }),
      plan('standard', { assessment_time_limit_seconds: 600 }),
    ]
    const { wrapper } = await render()
    expect(wrapper.get('.timing-ack').text()).toContain('包含模型等待')
    await wrapper.get('[data-testid=mode-rapid]').trigger('click')
    await flushPromises()
    expect(wrapper.get('.timing-ack').text()).not.toContain('模型等待')
    expect(wrapper.get('.timing-ack').text()).toContain('退出后继续计时')
    expect(wrapper.get('[data-testid=start-assessment]').attributes('disabled')).toBeDefined()
    await wrapper.get('.timing-ack input').setValue(true)
    await wrapper.get('[data-testid=start-assessment]').trigger('click')
    await flushPromises()
    expect(createAssessmentSession).toHaveBeenCalledExactlyOnceWith('org', 'rapid', 'stable-key')
  })
})
