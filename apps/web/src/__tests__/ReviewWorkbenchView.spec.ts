import { createPinia, setActivePinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ReviewWorkbenchView from '../views/ReviewWorkbenchView.vue'
import { useAccessStore } from '../stores/access'
import { useAuthStore } from '../stores/auth'

enableAutoUnmount(afterEach)
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
const organization = (id = 'org-1', capabilities = ['reviews'], role = 'evaluator') => ({
  id,
  name: `组织 ${id}`,
  role,
  capabilities,
})
const permissions = (...organizations: ReturnType<typeof organization>[]) => ({
  organizations,
  global_capabilities: [],
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const queueItem = (id = 'decision-1') => ({
  decision_id: id,
  session_id: 'session-1',
  item_type: 'dialogue',
  dimension_code: 'evaluation',
  provisional_score: 2,
  confidence: 0.5,
  review_reasons: ['safety_flag'],
  updated_at: '2026-09-20T00:00:00Z',
})
const dossier = (id = 'decision-1') => ({
  decision_id: id,
  state: 'needs_review',
  provisional_score: 2,
  final_score: null,
  confidence: 0.5,
  final_source: null,
  review_reasons: ['safety_flag'],
  answer: { content: '旧组织私有作答' },
  item: {
    id: 'item-1',
    stem: '旧组织私有题目',
    item_type: 'dialogue',
    dimension_code: 'evaluation',
  },
  rubric: { id: 'rubric-1', version: 1, title: '核验量规', criteria: {} },
  tasks: [],
})
async function render() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/reviews', component: ReviewWorkbenchView }],
  })
  await router.push('/reviews')
  await router.isReady()
  const wrapper = mount(ReviewWorkbenchView, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

describe('ReviewWorkbenchView', () => {
  beforeEach(() => {
    sessionStorage.clear()
    sessionStorage.setItem(
      'zhijian-auth-session',
      JSON.stringify({ accessToken: 'access-token', refreshToken: 'refresh-token' }),
    )
    setActivePinia(createPinia())
    useAuthStore().user = { id: 'actor-1', email: null, display_name: '评估员', is_active: true }
    vi.stubGlobal('crypto', { randomUUID: () => 'stable-review-key' })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads an evaluator queue and seals a stable idempotent review', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            organizations: [
              { id: 'org-1', name: '浙江示范高校', role: 'evaluator', capabilities: ['reviews'] },
            ],
            global_capabilities: [],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              decision_id: 'decision-1',
              session_id: 'session-1',
              item_type: 'dialogue',
              dimension_code: 'evaluation',
              provisional_score: 2.5,
              confidence: 0.72,
              review_reasons: ['safety_flag'],
              updated_at: '2026-08-24T08:00:00Z',
            },
          ]),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            decision_id: 'decision-1',
            state: 'needs_review',
            provisional_score: 2.5,
            final_score: null,
            confidence: 0.72,
            final_source: null,
            review_reasons: ['safety_flag'],
            answer: { transcript: [{ role: 'user', content: '我会核对来源。' }] },
            item: {
              id: 'item-1',
              stem: '如何核验AI结论?',
              item_type: 'dialogue',
              dimension_code: 'evaluation',
            },
            rubric: {
              id: 'rubric-1',
              version: 1,
              title: '结果核验量规',
              criteria: { criteria: [] },
            },
            tasks: [
              {
                id: 'task-1',
                role: 'primary',
                state: 'completed',
                model: 'model-a',
                prompt_version: 'scoring-primary-v1',
                score: 3,
                confidence: 0.8,
                result_hash: 'a'.repeat(64),
                evidence: [
                  {
                    criterion_code: 'verification',
                    score: 3,
                    confidence: 0.8,
                    quote: '核对来源',
                    rationale: '对应量规',
                    evidence_hash: 'b'.repeat(64),
                    verified: true,
                  },
                ],
              },
              {
                id: 'task-2',
                role: 'verifier',
                state: 'completed',
                model: 'model-b',
                prompt_version: 'scoring-verifier-v1',
                score: 2,
                confidence: 0.72,
                result_hash: 'c'.repeat(64),
                evidence: [],
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            review_id: 'review-1',
            decision_id: 'decision-1',
            state: 'completed',
            final_score: 3.5,
            final_source: 'human',
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/reviews', component: ReviewWorkbenchView }],
    })
    await router.push('/reviews')
    await router.isReady()
    const wrapper = mount(ReviewWorkbenchView, { global: { plugins: [router] } })
    await flushPromises()

    expect(wrapper.text()).toContain('如何核验AI结论')
    expect(wrapper.text()).toContain('核对来源')
    await wrapper.get('[data-testid=review-score]').setValue('3.5')
    await wrapper.get('[data-testid=review-rationale]').setValue('人工核对后确认达到完整闭环。')
    await wrapper.get('[data-testid=review-evidence]').setValue('回答明确提出核对来源。')
    expect(wrapper.get('[data-testid=resolve-review]').attributes('disabled')).toBeUndefined()
    await wrapper.get('form.verdict').trigger('submit')
    await flushPromises()

    const resolveCall = fetchMock.mock.calls.find(([path]) =>
      String(path).endsWith('/admin/reviews/decision-1/resolve'),
    )
    expect(resolveCall).toBeDefined()
    const headers = new Headers(resolveCall?.[1]?.headers)
    expect(headers.get('Idempotency-Key')).toContain('stable-review-key')
    expect(wrapper.text()).toContain('最终评分已封存')
    vi.unstubAllGlobals()
  })

  it.each(['learner', 'evaluator', 'org_admin', 'system_admin'])(
    'uses effective review capabilities instead of the %s role label',
    async (role) => {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(json(permissions(organization('org-1', ['reviews'], role))))
        .mockResolvedValueOnce(json([]))
      vi.stubGlobal('fetch', fetchMock)
      const view = await render()
      expect(fetchMock.mock.calls[0]?.[0]).toContain('/workspace/access')
      expect(fetchMock.mock.calls.some(([path]) => String(path).includes('launch-context'))).toBe(
        false,
      )
      expect(fetchMock.mock.calls[1]?.[0]).toContain('/admin/reviews?organization_id=org-1')
      expect(view.text()).toContain('当前组织暂无待复核评分')
      expect(view.text()).toContain('你已有评分复核权限')
      expect(view.text()).not.toContain('没有评分复核权限')
    },
  )

  it.each(['learner', 'system_admin'])(
    'does not grant reviews from the %s role label alone',
    async (role) => {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValue(json(permissions(organization('org-1', [], role))))
      vi.stubGlobal('fetch', fetchMock)
      const view = await render()
      expect(view.text()).toContain('当前组织没有评分复核权限')
      expect(fetchMock).toHaveBeenCalledTimes(1)
    },
  )

  it('shows permission lookup failure separately and retries without changing roles', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ detail: '权限服务暂不可用' }, 503))
      .mockResolvedValueOnce(json(permissions(organization())))
      .mockResolvedValueOnce(json([]))
    vi.stubGlobal('fetch', fetchMock)
    const view = await render()
    expect(view.text()).toContain('访问权限读取失败')
    expect(view.text()).not.toContain('没有评分复核权限')
    await view.get('.review-empty button').trigger('click')
    await flushPromises()
    expect(view.text()).toContain('当前组织暂无待复核评分')
    expect(fetchMock.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(
      true,
    )
  })

  it('honors the shell-selected organization and discards an old queue after switching', async () => {
    const access = useAccessStore()
    access.organizations = [organization('org-1'), organization('org-2')]
    access.organizationId = 'org-2'
    access.ready = true
    const old = deferred<Response>()
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(() => old.promise)
      .mockResolvedValueOnce(json([]))
    vi.stubGlobal('fetch', fetchMock)
    const view = await render()
    expect(fetchMock.mock.calls[0]?.[0]).toContain('organization_id=org-2')
    access.organizationId = 'org-1'
    await flushPromises()
    old.resolve(json([queueItem()]))
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(view.text()).toContain('当前组织暂无待复核评分')
    expect(view.find('.dossier').exists()).toBe(false)
  })

  it('switches from an unauthorized selected organization only when explicitly selected', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(permissions(organization('org-1', []), organization('org-2'))))
      .mockImplementation(async (path) =>
        String(path).includes('/workspace/access')
          ? json(permissions(organization('org-1', []), organization('org-2')))
          : json([]),
      )
    vi.stubGlobal('fetch', fetchMock)
    const view = await render()
    expect(view.text()).toContain('你在其他组织有复核权限')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await view.get('select').setValue('org-2')
    await flushPromises()
    expect(useAccessStore().organizationId).toBe('org-2')
    expect(view.text()).toContain('当前组织暂无待复核评分')
    expect(
      fetchMock.mock.calls.some(([path]) => String(path).includes('organization_id=org-1')),
    ).toBe(false)
  })

  it('discards a late private dossier when review permission is revoked', async () => {
    const pending = deferred<Response>()
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(permissions(organization())))
      .mockResolvedValueOnce(json([queueItem()]))
      .mockImplementationOnce(() => pending.promise)
    vi.stubGlobal('fetch', fetchMock)
    const view = await render()
    useAccessStore().organizations = [organization('org-1', [])]
    pending.resolve(json(dossier()))
    await flushPromises()
    expect(view.text()).toContain('没有评分复核权限')
    expect(view.text()).not.toContain('旧组织私有')
    expect(view.find('form.verdict').exists()).toBe(false)
  })

  it('clears already displayed evidence and unsaved rationale on account change', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(json(permissions(organization())))
        .mockResolvedValueOnce(json([queueItem()]))
        .mockResolvedValueOnce(json(dossier())),
    )
    const view = await render()
    await view.get('[data-testid=review-rationale]').setValue('旧账号未提交的私有意见')
    useAuthStore().user = { id: 'other', email: null, display_name: '其他账号', is_active: true }
    await flushPromises()
    expect(view.text()).not.toContain('旧组织私有')
    expect(view.find('form.verdict').exists()).toBe(false)
    expect(useAccessStore().ready).toBe(false)
  })

  it('does not label a queue read failure as an empty queue or missing permission', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(json(permissions(organization())))
        .mockResolvedValueOnce(json({ detail: '复核服务暂不可用' }, 503)),
    )
    const view = await render()
    expect(view.text()).toContain('复核服务暂不可用')
    expect(view.text()).not.toContain('当前组织暂无待复核评分')
    expect(view.text()).not.toContain('没有评分复核权限')
    expect(view.get('[role=alert]').text()).toContain('重新读取队列')
  })

  it('discards a late resolution receipt after switching organizations', async () => {
    const pending = deferred<Response>()
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(permissions(organization(), organization('org-2'))))
      .mockResolvedValueOnce(json([queueItem()]))
      .mockResolvedValueOnce(json(dossier()))
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValueOnce(json([]))
    vi.stubGlobal('fetch', fetchMock)
    const view = await render()
    await view.get('[data-testid=review-rationale]').setValue('核验原始回答与行为锚点')
    await view.get('[data-testid=review-evidence]').setValue('已定位对应的原文证据')
    await view.get('form.verdict').trigger('submit')
    useAccessStore().organizationId = 'org-2'
    await flushPromises()
    pending.resolve(json({ state: 'completed', final_source: 'human' }))
    await flushPromises()
    expect(view.text()).not.toContain('最终评分已封存')
    expect(view.text()).not.toContain('旧组织私有')
    expect(view.text()).toContain('当前组织暂无待复核评分')
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })
})
