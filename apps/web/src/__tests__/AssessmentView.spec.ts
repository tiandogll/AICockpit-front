import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AssessmentView from '../views/AssessmentView.vue'
import { useAccessStore } from '../stores/access'

const context = {
  organizations: [{ id: 'org-1', name: '浙江示范高校', role: 'learner' }],
  blueprints: [
    {
      id: 'blueprint-standard',
      name: '高校AI能力标准测',
      mode: 'standard',
      scenario: 'higher_education',
      min_items: 24,
      max_items: 36,
      item_type_minimums: { objective: 12, dialogue: 6, practical: 3 },
      dimension_codes: ['foundations', 'prompting', 'tool_use', 'evaluation'],
    },
  ],
  active_sessions: [
    {
      id: 'session-active',
      organization_id: 'org-1',
      blueprint_version_id: 'blueprint-standard',
      blueprint_name: '高校AI能力标准测',
      mode: 'standard',
      scenario: 'higher_education',
      status: 'active',
      created_at: '2026-08-22T08:00:00Z',
    },
  ],
}

function authSession() {
  sessionStorage.setItem(
    'zhijian-auth-session',
    JSON.stringify({ accessToken: 'access-token', refreshToken: 'refresh-token' }),
  )
}

describe('AssessmentView', () => {
  beforeEach(() => {
    sessionStorage.clear()
    setActivePinia(createPinia())
    authSession()
    const access = useAccessStore()
    access.organizationId = 'org-1'
    access.organizations = [
      { id: 'org-1', name: '浙江示范高校', role: 'learner', capabilities: [] },
    ]
    access.ready = true
    vi.stubGlobal('crypto', { randomUUID: () => 'stable-launch-key' })
  })

  it('uses one platform without a selector and can resume an owned legacy assessment', async () => {
    useAccessStore().singlePlatform = true
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              ...context,
              active_sessions: [{ ...context.active_sessions[0], organization_id: 'legacy-org' }],
            }),
          ),
      ),
    )
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/assessment', component: AssessmentView },
        { path: '/assessment/:sessionId', component: { template: '<div>运行器</div>' } },
      ],
    })
    await router.push('/assessment')
    const wrapper = mount(AssessmentView, { global: { plugins: [router] } })
    await flushPromises()
    expect(wrapper.find('[data-testid=launch-organization]').exists()).toBe(false)
    await wrapper.get('[data-testid=resume-session]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/assessment/session-active')
    wrapper.unmount()
    vi.unstubAllGlobals()
  })

  it('loads actor-scoped launch options and resumes an active assessment', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify(context), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/assessment', component: AssessmentView },
        { path: '/assessment/:sessionId', component: { template: '<div>运行器</div>' } },
      ],
    })
    await router.push('/assessment')
    await router.isReady()
    const wrapper = mount(AssessmentView, { global: { plugins: [router] } })
    await flushPromises()

    expect(wrapper.text()).toContain('浙江示范高校')
    expect(wrapper.text()).toContain('继续上次测评')
    expect(wrapper.get('[data-testid=assessment-title]').text()).toBe('选择测评方式')
    expect(wrapper.text()).toContain('开始后进入答题工作区')
    expect(wrapper.text()).not.toContain('Assessment setup')
    expect(wrapper.text()).toContain('RESUME')
    await wrapper.get('[data-testid=resume-session]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/assessment/session-active')
    vi.unstubAllGlobals()
  })

  it('starts a selected published blueprint with a stable idempotency key', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ...context, active_sessions: [] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'session-new',
            organization_id: 'org-1',
            blueprint_version_id: 'blueprint-standard',
            mode: 'standard',
            scenario: 'higher_education',
            status: 'active',
            blueprint_snapshot: {},
            replayed: false,
          }),
          { status: 201 },
        ),
      )
    vi.stubGlobal('fetch', fetchMock)
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/assessment', component: AssessmentView },
        { path: '/assessment/:sessionId', component: { template: '<div>运行器</div>' } },
      ],
    })
    await router.push('/assessment')
    await router.isReady()
    const wrapper = mount(AssessmentView, { global: { plugins: [router] } })
    await flushPromises()
    await wrapper.get('[data-testid=start-assessment]').trigger('click')
    await flushPromises()

    const headers = fetchMock.mock.calls.find((call) => call[1]?.method === 'POST')![1]
      ?.headers as Record<string, string>
    expect(headers['Idempotency-Key']).toContain('stable-launch-key')
    expect(router.currentRoute.value.fullPath).toBe('/assessment/session-new')
    vi.unstubAllGlobals()
  })

  it('uses the header organization even when it is not first in the launch context', async () => {
    const access = useAccessStore()
    access.organizations.push({ id: 'org-2', name: '第二组织', role: 'learner', capabilities: [] })
    access.organizationId = 'org-2'
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            ...context,
            organizations: [
              ...context.organizations,
              { id: 'org-2', name: '第二组织', role: 'learner' },
            ],
          }),
          { status: 200 },
        ),
      ),
    )
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/assessment', component: AssessmentView }],
    })
    await router.push('/assessment')
    const wrapper = mount(AssessmentView, { global: { plugins: [router] } })
    await flushPromises()
    expect((wrapper.findAll('select')[0]!.element as HTMLSelectElement).value).toBe('org-2')
    vi.unstubAllGlobals()
  })

  it('synchronizes a local organization choice before allowing launch', async () => {
    const access = useAccessStore()
    access.organizations.push({ id: 'org-2', name: '第二组织', role: 'learner', capabilities: [] })
    const sync = vi.spyOn(access, 'selectOrganization').mockImplementation(async (id) => {
      access.organizationId = id
    })
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            ...context,
            organizations: [
              ...context.organizations,
              { id: 'org-2', name: '第二组织', role: 'learner' },
            ],
          }),
          { status: 200 },
        ),
      ),
    )
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/assessment', component: AssessmentView }],
    })
    await router.push('/assessment')
    const wrapper = mount(AssessmentView, { global: { plugins: [router] } })
    await flushPromises()
    await wrapper.findAll('select')[0]!.setValue('org-2')
    await flushPromises()
    expect(sync).toHaveBeenCalledWith('org-2')
    expect(access.organizationId).toBe('org-2')
    vi.unstubAllGlobals()
  })

  it('does not navigate to a stale launch response after the header organization changes', async () => {
    let resolveSession!: (value: Response) => void
    const pending = new Promise<Response>((resolve) => {
      resolveSession = resolve
    })
    const access = useAccessStore()
    access.organizations.push({ id: 'org-2', name: '第二组织', role: 'learner', capabilities: [] })
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              ...context,
              active_sessions: [],
              organizations: [
                ...context.organizations,
                { id: 'org-2', name: '第二组织', role: 'learner' },
              ],
            }),
            { status: 200 },
          ),
        )
        .mockReturnValueOnce(pending),
    )
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/assessment', component: AssessmentView },
        { path: '/workspace', component: { template: '<div />' } },
        { path: '/assessment/:sessionId', component: { template: '<div />' } },
      ],
    })
    await router.push('/assessment')
    const wrapper = mount(AssessmentView, { global: { plugins: [router] } })
    await flushPromises()
    await wrapper.get('[data-testid="start-assessment"]').trigger('click')
    access.organizationId = 'org-2'
    await flushPromises()
    resolveSession(
      new Response(JSON.stringify({ id: 'session-old', organization_id: 'org-1' }), {
        status: 201,
      }),
    )
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/assessment')
    vi.unstubAllGlobals()
  })

  it('does not offer malformed published configurations as launchable assessments', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            ...context,
            active_sessions: [],
            blueprints: [
              {
                ...context.blueprints[0],
                id: 'invalid',
                name: '空配置版本',
                dimension_codes: [],
                item_type_minimums: { objective: 0, dialogue: 0, practical: 0 },
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    )
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/assessment', component: AssessmentView }],
    })
    await router.push('/assessment')
    const wrapper = mount(AssessmentView, { global: { plugins: [router] } })
    await flushPromises()
    expect(wrapper.text()).not.toContain('空配置版本')
    expect(wrapper.text()).toContain('标准测暂无可开始的方案')
    expect(wrapper.text()).toContain('已隐藏配置不完整的版本')
    expect(wrapper.get('[data-testid=start-assessment]').attributes('disabled')).toBeDefined()
    vi.unstubAllGlobals()
  })

  it('repairs a management-only organization selection using actual participating memberships', async () => {
    const access = useAccessStore()
    access.organizationId = 'management-only'
    access.organizations.push({
      id: 'management-only',
      name: '管理组织',
      role: 'system_admin',
      capabilities: [],
    })
    const sync = vi.spyOn(access, 'selectOrganization').mockImplementation(async (id) => {
      access.organizationId = id
    })
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(JSON.stringify(context), { status: 200 })),
    )
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/assessment', component: AssessmentView }],
    })
    await router.push('/assessment')
    const wrapper = mount(AssessmentView, { global: { plugins: [router] } })
    await flushPromises()
    expect(sync).toHaveBeenCalledWith('org-1')
    expect(wrapper.get<HTMLSelectElement>('[data-testid=launch-organization]').element.value).toBe(
      'org-1',
    )
    expect(wrapper.text()).toContain('已切换到你可参与测评的组织')
    expect(wrapper.get('[data-testid=start-assessment]').attributes('disabled')).toBeUndefined()
    vi.unstubAllGlobals()
  })

  it('shows resume sessions only for the selected organization and preserves all its choices', async () => {
    const access = useAccessStore()
    access.organizations.push({ id: 'org-2', name: '第二组织', role: 'learner', capabilities: [] })
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            ...context,
            organizations: [
              ...context.organizations,
              { id: 'org-2', name: '第二组织', role: 'learner' },
            ],
            active_sessions: [
              {
                ...context.active_sessions[0],
                id: 'other',
                organization_id: 'org-2',
                blueprint_name: '其他组织测评',
              },
              ...context.active_sessions,
              { ...context.active_sessions[0], id: 'another', blueprint_name: '第二份未完成测评' },
            ],
          }),
          { status: 200 },
        ),
      ),
    )
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/assessment', component: AssessmentView },
        { path: '/assessment/:sessionId', component: { template: '<div />' } },
      ],
    })
    await router.push('/assessment')
    const wrapper = mount(AssessmentView, { global: { plugins: [router] } })
    await flushPromises()
    expect(wrapper.text()).not.toContain('其他组织测评')
    expect(wrapper.text()).toContain('第二份未完成测评')
    await wrapper.get('[data-testid=resume-session-choice]').setValue('another')
    await wrapper.get('[data-testid=resume-session]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/assessment/another')
    vi.unstubAllGlobals()
  })

  it('keeps an organization-scoped local experience separate from regular published plans', async () => {
    const access = useAccessStore()
    access.organizations.push({ id: 'org-2', name: '正式组织', role: 'learner', capabilities: [] })
    vi.spyOn(access, 'selectOrganization').mockImplementation(async (id) => {
      access.organizationId = id
    })
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            ...context,
            active_sessions: [],
            organizations: [
              ...context.organizations,
              { id: 'org-2', name: '正式组织', role: 'learner' },
            ],
            blueprints: [
              {
                ...context.blueprints[0],
                id: 'experience',
                name: '本地标准体验',
                organization_ids: ['org-1'],
                data_origin: 'synthetic',
              },
              {
                ...context.blueprints[0],
                id: 'formal',
                name: '正式标准测',
                organization_ids: ['org-2'],
              },
              {
                ...context.blueprints[0],
                id: 'inaccessible',
                name: '不可访问版本',
                organization_ids: [],
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    )
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/assessment', component: AssessmentView }],
    })
    await router.push('/assessment')
    const wrapper = mount(AssessmentView, { global: { plugins: [router] } })
    await flushPromises()
    expect(wrapper.text()).toContain('本地体验 · 非正式比赛题库')
    expect(wrapper.text()).toContain('本地标准体验')
    expect(wrapper.text()).not.toContain('正式标准测')
    expect(wrapper.text()).not.toContain('不可访问版本')
    await wrapper.get('[data-testid=launch-organization]').setValue('org-2')
    await flushPromises()
    expect(wrapper.text()).toContain('正式标准测')
    expect(wrapper.text()).not.toContain('本地标准体验')
    expect(wrapper.text()).not.toContain('本地体验 · 非正式比赛题库')
    expect(wrapper.get('[data-testid=confirmed-blueprint]').text()).toContain('正式标准测')
    expect(wrapper.find('[data-testid=launch-blueprint]').exists()).toBe(false)
    vi.unstubAllGlobals()
  })
})
