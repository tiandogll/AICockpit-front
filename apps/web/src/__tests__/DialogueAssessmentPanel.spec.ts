import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import DialogueAssessmentPanel from '../components/DialogueAssessmentPanel.vue'
import type { AssessmentItem } from '../services/assessmentApi'

const item: AssessmentItem = {
  session_id: 'session-1',
  item_version_id: 'item-1',
  sequence: 2,
  item_type: 'dialogue',
  dimension_code: 'evaluation',
  difficulty: 0.2,
  stem: '请说明你会如何核验AI给出的活动数据。',
  configuration: { dialogue_max_turns: 2 },
}

describe('DialogueAssessmentPanel', () => {
  beforeEach(() => {
    sessionStorage.clear()
    sessionStorage.setItem(
      'zhijian-auth-session',
      JSON.stringify({ accessToken: 'access-token', refreshToken: 'refresh-token' }),
    )
    setActivePinia(createPinia())
    vi.stubGlobal('crypto', { randomUUID: () => 'stable-dialogue-key' })
  })

  it('keeps the assigned image beside the dialogue prompt before the first turn', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(JSON.stringify({ detail: 'not found' }), { status: 404 })),
    )
    const wrapper = mount(DialogueAssessmentPanel, {
      props: {
        sessionId: 'session-1',
        item: {
          ...item,
          configuration: {
            ...item.configuration,
            media: {
              images: [
                {
                  src: '/assessment-media/dialogue-evidence.svg',
                  alt: '两个来源对活动人数的不同记录',
                },
              ],
            },
          },
        },
      },
    })
    await flushPromises()

    expect(wrapper.get('img').attributes('src')).toBe('/assessment-media/dialogue-evidence.svg')
    expect(wrapper.get('img').attributes('alt')).toBe('两个来源对活动人数的不同记录')
    expect(wrapper.find('textarea').exists()).toBe(true)
    wrapper.unmount()
    vi.unstubAllGlobals()
  })

  it('persists the learner turn, streams the interviewer response, then restores snapshot', async () => {
    const turn = {
      exchange_id: 'exchange-1',
      turn_id: 'turn-1',
      item_version_id: 'item-1',
      sequence: 1,
      state: 'awaiting_ai',
      max_turns: 2,
      turn_count: 1,
      user_content: '我会查原始来源。',
      submitted_at: '2026-08-22T10:00:00Z',
      replayed: false,
    }
    const snapshot = {
      exchange_id: 'exchange-1',
      session_id: 'session-1',
      item_version_id: 'item-1',
      state: 'awaiting_user',
      max_turns: 2,
      turn_count: 1,
      last_error_code: null,
      completed_at: null,
      can_submit: true,
      can_retry_generation: false,
      turns: [
        {
          id: 'turn-1',
          sequence: 1,
          user_content: '我会查原始来源。',
          submitted_at: turn.submitted_at,
          assistant_content: '你会如何判断来源是否可信？',
          assistant_completed_at: '2026-08-22T10:00:01Z',
          degraded: false,
        },
      ],
    }
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('event: meta\ndata: {"turn_id":"turn-1"}\n\n'))
        controller.enqueue(
          encoder.encode('event: delta\ndata: {"content":"你会如何判断来源是否可信？"}\n\n'),
        )
        controller.enqueue(
          encoder.encode('event: done\ndata: {"turn_id":"turn-1","completed":false}\n\n'),
        )
        controller.close()
      },
    })
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'not found' }), { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(turn), { status: 200 }))
      .mockResolvedValueOnce(new Response(stream, { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(snapshot), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(DialogueAssessmentPanel, { props: { sessionId: 'session-1', item } })
    await flushPromises()

    await wrapper.get('textarea').setValue('我会查原始来源。')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('你会如何判断来源是否可信')
    expect(fetchMock.mock.calls[1]![0]).toContain('/dialogue/turns')
    expect(fetchMock.mock.calls[2]![0]).toContain('/response:stream')
    expect(fetchMock.mock.calls[3]![0]).toContain('/dialogue/item-1')
    vi.unstubAllGlobals()
  })

  it('keeps the next learner turn locked when generation fails after persistence', async () => {
    const turn = {
      exchange_id: 'exchange-1',
      turn_id: 'turn-1',
      item_version_id: 'item-1',
      sequence: 1,
      state: 'awaiting_ai',
      max_turns: 2,
      turn_count: 1,
      user_content: '已保存回答',
      submitted_at: '2026-08-22T10:00:00Z',
      replayed: false,
    }
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('event: meta\ndata: {"turn_id":"turn-1"}\n\n'))
        controller.enqueue(encoder.encode('event: delta\ndata: {"content":"未固化片段"}\n\n'))
        controller.enqueue(
          encoder.encode('event: error\ndata: {"code":"generation_timeout","retryable":true}\n\n'),
        )
        controller.close()
      },
    })
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ detail: 'not found' }), { status: 404 }),
        )
        .mockResolvedValueOnce(new Response(JSON.stringify(turn), { status: 200 }))
        .mockResolvedValueOnce(new Response(stream, { status: 200 })),
    )
    const wrapper = mount(DialogueAssessmentPanel, { props: { sessionId: 'session-1', item } })
    await flushPromises()
    await wrapper.get('textarea').setValue('已保存回答')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('可以安全重试')
    expect(wrapper.text()).not.toContain('未固化片段')
    expect(wrapper.find('textarea').exists()).toBe(false)
    expect(wrapper.find('.retry-button').exists()).toBe(true)
    vi.unstubAllGlobals()
  })

  it('uses the latest follow-up as the single main question in the reference layout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            exchange_id: 'exchange-1',
            session_id: 'session-1',
            item_version_id: 'item-1',
            state: 'awaiting_user',
            max_turns: 3,
            turn_count: 2,
            can_submit: true,
            can_retry_generation: false,
            last_error_code: null,
            completed_at: null,
            turns: [
              {
                id: 'turn-2',
                sequence: 2,
                user_content: '我比较了原始材料。',
                assistant_content: '三个来源互相矛盾时，你会如何判断可信度？',
                submitted_at: '2026-09-15T10:00:00Z',
                assistant_completed_at: '2026-09-15T10:00:01Z',
                degraded: false,
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    )
    const wrapper = mount(DialogueAssessmentPanel, {
      props: { sessionId: 'session-1', item, externalFooter: true },
    })
    await flushPromises()
    expect(wrapper.get('.dialogue-current-question').text()).toBe(
      '三个来源互相矛盾时，你会如何判断可信度？',
    )
    expect(wrapper.get('.interviewer-name').text()).toContain('第2次追问')
    expect(wrapper.get('.interviewer-badge').text()).toBe('鉴')
    expect(wrapper.find('button[type="submit"]').exists()).toBe(false)
    expect(wrapper.get('details').attributes('open')).toBeUndefined()
    wrapper.unmount()
    vi.unstubAllGlobals()
  })

  it('keeps the actual preceding follow-up visible when a saved later turn awaits AI after refresh', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            exchange_id: 'e',
            session_id: 'session-1',
            item_version_id: 'item-1',
            state: 'awaiting_ai',
            max_turns: 3,
            turn_count: 2,
            can_submit: false,
            can_retry_generation: true,
            last_error_code: 'generation_timeout',
            completed_at: null,
            turns: [
              {
                id: 't1',
                sequence: 1,
                user_content: '第一轮',
                assistant_content: '这是上轮已固化的追问',
                submitted_at: '2026-09-15T00:00:00Z',
                assistant_completed_at: '2026-09-15T00:00:01Z',
                degraded: false,
              },
              {
                id: 't2',
                sequence: 2,
                user_content: '第二轮已保存',
                assistant_content: null,
                submitted_at: '2026-09-15T00:01:00Z',
                assistant_completed_at: null,
                degraded: false,
              },
            ],
          }),
        ),
      ),
    )
    const wrapper = mount(DialogueAssessmentPanel, {
      props: { sessionId: 'session-1', item, externalFooter: true },
    })
    await flushPromises()
    expect(wrapper.get('.dialogue-current-question').text()).toBe('这是上轮已固化的追问')
    expect(wrapper.get('.interviewer-name').text()).toContain('第1次追问')
    expect(wrapper.find('textarea').exists()).toBe(false)
    expect(wrapper.find('.retry-button').exists()).toBe(true)
    wrapper.unmount()
    vi.unstubAllGlobals()
  })

  it('restores the current turn draft and persists edits with server revision and timestamp', async () => {
    vi.useFakeTimers()
    const persistedAt = '2026-09-15T10:20:30Z'
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      if (String(url).endsWith('/draft')) {
        if (init?.method === 'PUT')
          return new Response(
            JSON.stringify({
              context_revision: 0,
              can_edit: true,
              draft: {
                revision: 3,
                context_revision: 0,
                saved_at: persistedAt,
                response: JSON.parse(String(init.body)).response,
              },
            }),
          )
        return new Response(
          JSON.stringify({
            context_revision: 0,
            can_edit: true,
            draft: {
              revision: 2,
              context_revision: 0,
              saved_at: '2026-09-15T10:00:00Z',
              response: { content: '此前保存的草稿', attachment_ids: [] },
            },
          }),
        )
      }
      return new Response(JSON.stringify({ detail: 'not found' }), { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(DialogueAssessmentPanel, {
      props: { sessionId: 'session-1', item, persistDraft: true },
    })
    await flushPromises()
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('此前保存的草稿')
    await wrapper.get('textarea').setValue('修改后的核验记录')
    await vi.advanceTimersByTimeAsync(850)
    await flushPromises()
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({
      response: { content: '修改后的核验记录', attachment_ids: [] },
      revision: 2,
      context_revision: 0,
    })
    expect(wrapper.vm.savedAt).toBe(persistedAt)
    expect(wrapper.vm.dirty).toBe(false)
    wrapper.unmount()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('does not allow submission when the current draft failed to restore', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(
        async (url) =>
          new Response(
            JSON.stringify({
              detail: String(url).endsWith('/draft') ? '草稿服务不可用' : 'not found',
            }),
            { status: String(url).endsWith('/draft') ? 503 : 404 },
          ),
      ),
    )
    const wrapper = mount(DialogueAssessmentPanel, {
      props: { sessionId: 'session-1', item, persistDraft: true },
    })
    await flushPromises()
    expect(wrapper.get('textarea').attributes('disabled')).toBeDefined()
    expect(wrapper.vm.canSubmit).toBe(false)
    expect(wrapper.text()).toContain('草稿服务不可用')
    wrapper.unmount()
    vi.unstubAllGlobals()
  })

  it('passes the selected server attachment IDs with the immutable user turn', async () => {
    const attachment = {
      id: 'file-1',
      filename: '核验.txt',
      media_type: 'text/plain',
      byte_size: 6,
      sha256: 'abc',
      state: 'ready',
      parse_status: 'text_ready',
      bound_turn_id: null,
      created_at: '2026-09-15T10:00:00Z',
    }
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      if (String(url).endsWith('/attachments'))
        return new Response(JSON.stringify({ attachments: [attachment] }))
      if (String(url).endsWith('/draft'))
        return new Response(
          JSON.stringify({
            context_revision: 0,
            can_edit: true,
            draft: {
              revision: 1,
              context_revision: 0,
              saved_at: '2026-09-15T10:00:00Z',
              response: { content: '我的核验说明', attachment_ids: ['file-1'] },
            },
          }),
        )
      if (String(url).endsWith('/turns') && init?.method === 'POST')
        return new Response(
          JSON.stringify({
            exchange_id: 'exchange-1',
            turn_id: 'turn-1',
            sequence: 1,
            turn_count: 1,
            max_turns: 2,
            item_version_id: item.item_version_id,
            state: 'awaiting_ai',
            user_content: '我的核验说明',
            submitted_at: '2026-09-15T10:00:01Z',
            replayed: false,
          }),
        )
      return new Response(JSON.stringify({ detail: 'not found' }), { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(DialogueAssessmentPanel, {
      props: {
        sessionId: 'session-1',
        item: {
          ...item,
          configuration: { ...item.configuration, attachment_policy: { enabled: true } },
        },
        persistDraft: true,
      },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('核验.txt')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    const request = fetchMock.mock.calls.find(
      ([url, init]) => String(url).endsWith('/turns') && init?.method === 'POST',
    )
    expect(JSON.parse(String(request?.[1]?.body)).attachment_ids).toEqual(['file-1'])
    expect(wrapper.find('textarea').exists()).toBe(false)
    wrapper.unmount()
    vi.unstubAllGlobals()
  })
})
