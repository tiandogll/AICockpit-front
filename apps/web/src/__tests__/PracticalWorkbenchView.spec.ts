import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import PracticalWorkbenchView from '../views/PracticalWorkbenchView.vue'
import type { PracticalSnapshot } from '../services/practicalApi'

function snapshot(overrides: Partial<PracticalSnapshot> = {}): PracticalSnapshot {
  return {
    workspace_id: 'workspace-1',
    session_id: 'session-1',
    item_version_id: 'item-1',
    state: 'active',
    task_type: 'text',
    stem: '使用AI形成一份活动方案，并核验关键事实。',
    max_ai_interactions: 3,
    event_count: 1,
    interaction_count: 0,
    artifact_count: 0,
    submitted_at: null,
    can_edit: true,
    events: [
      {
        id: 'event-12345678',
        sequence: 1,
        event_type: 'task_decomposition',
        payload: { steps: ['明确目标'] },
        occurred_at: '2026-08-22T08:00:00Z',
      },
    ],
    interactions: [],
    artifacts: [],
    replayed: false,
    ...overrides,
  }
}

async function fillConnection(wrapper: ReturnType<typeof mount>) {
  const fields = wrapper.findAll('.connection input')
  await fields[0]!.setValue('http://localhost:18000/api/v1')
  await fields[1]!.setValue('access-token')
  await fields[2]!.setValue('session-1')
  await fields[3]!.setValue('item-1')
  await wrapper.find('.connection').trigger('submit')
  await flushPromises()
}

describe('PracticalWorkbenchView', () => {
  it('read-only history never creates missing workspaces or writes drafts', async () => {
    sessionStorage.setItem(
      'zhijian-auth-session',
      JSON.stringify({ accessToken: 'read-only-token', refreshToken: 'refresh-token' }),
    )
    setActivePinia(createPinia())
    const api = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ detail: 'No saved practical workspace' }), { status: 404 }),
      )
    vi.stubGlobal('fetch', api)
    const wrapper = mount(PracticalWorkbenchView, {
      props: {
        formalSessionId: 's',
        formalItemId: 'i',
        embedded: true,
        readOnlyMode: true,
        sessionDisabled: true,
      },
    })
    await flushPromises()
    expect(api).toHaveBeenCalledTimes(1)
    expect(api.mock.calls[0]?.[1]?.method).toBe('GET')
    expect(wrapper.find('.connection').exists()).toBe(false)
    wrapper.unmount()
    vi.unstubAllGlobals()
  })
  beforeEach(() => {
    sessionStorage.clear()
    vi.stubGlobal('crypto', { randomUUID: () => 'fixed-uuid' })
  })

  it('restores task images from the formal practical snapshot without requiring the runner state', async () => {
    sessionStorage.setItem(
      'zhijian-auth-session',
      JSON.stringify({ accessToken: 'formal-token', refreshToken: 'refresh-token' }),
    )
    setActivePinia(createPinia())
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            ...snapshot(),
            media: {
              images: [
                { src: '/assessment-media/practical-brief.svg', alt: '需要改进的活动方案流程图' },
              ],
            },
          }),
          { status: 200 },
        ),
      ),
    )
    const wrapper = mount(PracticalWorkbenchView, {
      props: { formalSessionId: 'session-1', formalItemId: 'item-1' },
    })
    await flushPromises()

    expect(wrapper.get('.dossier img').attributes('src')).toBe(
      '/assessment-media/practical-brief.svg',
    )
    expect(wrapper.get('.dossier img').attributes('alt')).toBe('需要改进的活动方案流程图')
    expect(wrapper.find('.connection').exists()).toBe(false)
    wrapper.unmount()
    vi.unstubAllGlobals()
  })

  it('opens a formal deep link with the authenticated session and no connection form', async () => {
    sessionStorage.setItem(
      'zhijian-auth-session',
      JSON.stringify({ accessToken: 'formal-token', refreshToken: 'refresh-token' }),
    )
    setActivePinia(createPinia())
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(snapshot()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(PracticalWorkbenchView, {
      props: { formalSessionId: 'session-1', formalItemId: 'item-1' },
    })
    await flushPromises()

    expect(wrapper.find('.connection').exists()).toBe(false)
    expect(wrapper.text()).toContain('使用AI形成一份活动方案')
    expect(fetchMock.mock.calls[0]![0]).toContain('/sessions/session-1/practical/item-1')
    const formalInit = fetchMock.mock.calls[0]![1] as RequestInit
    const formalHeaders = formalInit.headers as Record<string, string>
    expect(formalHeaders.Authorization).toBe('Bearer formal-token')
    expect(sessionStorage.getItem('zhijian-practical-connection')).toBeNull()
    vi.unstubAllGlobals()
  })

  it('returns a sealed formal workspace to the assessment runner', async () => {
    sessionStorage.setItem(
      'zhijian-auth-session',
      JSON.stringify({ accessToken: 'formal-token', refreshToken: 'refresh-token' }),
    )
    setActivePinia(createPinia())
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(JSON.stringify(snapshot({ state: 'submitted', can_edit: false })), {
            status: 200,
          }),
        ),
    )
    const wrapper = mount(PracticalWorkbenchView, {
      props: { formalSessionId: 'session-1', formalItemId: 'item-1' },
    })
    await flushPromises()

    expect(wrapper.get('.formal-complete').text()).toContain('返回测评并继续')
    expect(wrapper.get('.formal-complete a').attributes('href')).toBe('/assessment/session-1')
    vi.unstubAllGlobals()
  })

  it('restores a three-part practical studio and evidence rail', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify(snapshot()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )
    const wrapper = mount(PracticalWorkbenchView)
    await fillConnection(wrapper)

    expect(wrapper.text()).toContain('使用AI形成一份活动方案')
    expect(wrapper.find('.dossier').exists()).toBe(true)
    expect(wrapper.find('.ai-lab').exists()).toBe(true)
    expect(wrapper.find('.proof-rail').exists()).toBe(true)
    expect(wrapper.text()).toContain('任务拆解已记录')
    expect(sessionStorage.getItem('zhijian-practical-connection')).toContain('access-token')
    vi.unstubAllGlobals()
  })

  it('records a prompt before showing its audited AI response', async () => {
    const completed = snapshot({
      event_count: 2,
      interaction_count: 1,
      events: [
        ...snapshot().events,
        {
          id: 'prompt-12345678',
          sequence: 2,
          event_type: 'prompt_draft',
          payload: { content: '生成一版结构化方案' },
          occurred_at: '2026-08-22T08:01:00Z',
        },
      ],
      interactions: [
        {
          id: 'ai-12345678',
          sequence: 1,
          state: 'succeeded',
          prompt: '生成一版结构化方案',
          response: '以下是含待核验标记的方案。',
          degraded: false,
          error_code: null,
          created_at: '2026-08-22T08:01:01Z',
          completed_at: '2026-08-22T08:01:02Z',
        },
      ],
    })
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(snapshot()), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ event: completed.events[1] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(completed.interactions[0]), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(completed), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(PracticalWorkbenchView)
    await fillConnection(wrapper)
    await wrapper.find('.composer textarea').setValue('生成一版结构化方案')
    await wrapper.find('.composer button').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('以下是含待核验标记的方案')
    expect(wrapper.text()).toContain('提示词草稿已封存')
    const promptCall = fetchMock.mock.calls[1]
    expect(promptCall).toBeDefined()
    expect(promptCall![0]).toContain('/events')
    const promptHeaders = promptCall![1]?.headers as Record<string, string>
    expect(String(promptHeaders['Idempotency-Key'])).toContain('fixed-uuid')
    vi.unstubAllGlobals()
  })

  it('reuses operation keys when a lost AI response is retried', async () => {
    const promptEvent = {
      id: 'prompt-12345678',
      sequence: 2,
      event_type: 'prompt_draft' as const,
      payload: { content: '生成一版结构化方案' },
      occurred_at: '2026-08-22T08:01:00Z',
    }
    const interaction = {
      id: 'ai-12345678',
      sequence: 1,
      state: 'succeeded' as const,
      prompt: '生成一版结构化方案',
      response: '重试后返回相同的已审计结果。',
      degraded: false,
      error_code: null,
      created_at: '2026-08-22T08:01:01Z',
      completed_at: '2026-08-22T08:01:02Z',
    }
    const completed = snapshot({
      event_count: 2,
      interaction_count: 1,
      events: [...snapshot().events, promptEvent],
      interactions: [interaction],
    })
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(snapshot()), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ event: promptEvent }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: '模型响应丢失，请重试。' }), { status: 503 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(snapshot()), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ event: promptEvent }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(interaction), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(completed), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(completed), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(PracticalWorkbenchView)
    await fillConnection(wrapper)
    await wrapper.find('.composer textarea').setValue('生成一版结构化方案')
    await wrapper.find('.composer button').trigger('click')
    await flushPromises()
    await wrapper.find('.composer button').trigger('click')
    await flushPromises()

    const firstEventHeaders = fetchMock.mock.calls[1]![1]?.headers as Record<string, string>
    const firstInteractionHeaders = fetchMock.mock.calls[2]![1]?.headers as Record<string, string>
    const retryEventHeaders = fetchMock.mock.calls[4]![1]?.headers as Record<string, string>
    const retryInteractionHeaders = fetchMock.mock.calls[5]![1]?.headers as Record<string, string>
    expect(retryEventHeaders['Idempotency-Key']).toBe(firstEventHeaders['Idempotency-Key'])
    expect(retryInteractionHeaders['Idempotency-Key']).toBe(
      firstInteractionHeaders['Idempotency-Key'],
    )
    expect(wrapper.text()).toContain('重试后返回相同的已审计结果')
    vi.unstubAllGlobals()
  })

  it('keeps final submission locked until every task gate is satisfied', async () => {
    const pendingImage = snapshot({
      task_type: 'image',
      interactions: [
        {
          id: 'ai-pending',
          sequence: 1,
          state: 'pending',
          prompt: '生成海报草图',
          response: null,
          degraded: false,
          error_code: null,
          created_at: '2026-08-22T08:01:01Z',
          completed_at: null,
        },
      ],
    })
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify(pendingImage), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )
    const wrapper = mount(PracticalWorkbenchView)
    await fillConnection(wrapper)
    await wrapper.find('textarea[aria-label="最终结果"]').setValue('最终海报说明')

    const gateText = wrapper.find('.submission-gates').text()
    expect(gateText).toContain('结果核验')
    expect(gateText).toContain('无在途任务')
    expect(gateText).toContain('已选图像产物')
    expect(wrapper.find('.seal-button').attributes('disabled')).toBeDefined()
    vi.unstubAllGlobals()
  })
})
