import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DialogueStreamError, streamDialogueResponse } from '../services/dialogueApi'

function streamedResponse(chunks: string[]) {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
        controller.close()
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  )
}

describe('dialogue SSE client', () => {
  beforeEach(() => {
    sessionStorage.clear()
    sessionStorage.setItem(
      'zhijian-auth-session',
      JSON.stringify({ accessToken: 'access-token', refreshToken: 'refresh-token' }),
    )
    setActivePinia(createPinia())
  })

  it('parses frames split across arbitrary network chunks and completes only on done', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          streamedResponse([
            'event: meta\r\ndata: {"turn_id":"turn-1"}\r\n\r\nevent: del',
            'ta\r\ndata: {"content":"请先"}\r\n\r\nevent: delta\r\ndata: {"content":"说明依据"}\r\n',
            '\r\nevent: done\r\ndata: {"turn_id":"turn-1","completed":false}\r\n\r\n',
          ]),
        ),
    )
    const deltas: string[] = []

    const done = await streamDialogueResponse('session-1', 'turn-1', 'generation-key', (value) =>
      deltas.push(value),
    )

    expect(deltas.join('')).toBe('请先说明依据')
    expect(done.completed).toBe(false)
    vi.unstubAllGlobals()
  })

  it('rejects a normal EOF when the durable done event never arrives', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          streamedResponse([
            'event: meta\ndata: {"turn_id":"turn-1"}\n\n',
            'event: delta\ndata: {"content":"未固化内容"}\n\n',
          ]),
        ),
    )

    await expect(
      streamDialogueResponse('session-1', 'turn-1', 'generation-key', () => undefined),
    ).rejects.toMatchObject({ code: 'incomplete_stream', retryable: true })
    vi.unstubAllGlobals()
  })

  it('rejects a done event that belongs to another turn', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          streamedResponse([
            'event: meta\ndata: {"turn_id":"turn-1"}\n\n',
            'event: done\ndata: {"turn_id":"turn-2","completed":false}\n\n',
          ]),
        ),
    )

    await expect(
      streamDialogueResponse('session-1', 'turn-1', 'generation-key', () => undefined),
    ).rejects.toMatchObject({ code: 'turn_mismatch', retryable: false })
    vi.unstubAllGlobals()
  })

  it('surfaces a safe server error event with its retryability', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          streamedResponse([
            'event: meta\ndata: {"turn_id":"turn-1"}\n\n',
            'event: error\ndata: {"code":"generation_timeout","retryable":true}\n\n',
          ]),
        ),
    )

    const failure = streamDialogueResponse('session-1', 'turn-1', 'generation-key', () => undefined)
    await expect(failure).rejects.toBeInstanceOf(DialogueStreamError)
    await expect(failure).rejects.toMatchObject({ code: 'generation_timeout', retryable: true })
    vi.unstubAllGlobals()
  })

  it('cancels an in-flight stream on abort and never delivers a late delta', async () => {
    let source: ReadableStreamDefaultController<Uint8Array> | undefined
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      start(value) {
        source = value
      },
      cancel,
    })
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(body)))
    const controller = new AbortController(),
      onDelta = vi.fn()
    const response = streamDialogueResponse(
      'session-1',
      'turn-1',
      'generation-key',
      onDelta,
      controller.signal,
    )
    const rejected = expect(response).rejects.toMatchObject({ name: 'AbortError' })
    await Promise.resolve()
    await Promise.resolve()
    source?.enqueue(new TextEncoder().encode('event: meta\ndata: {"turn_id":"turn-1"}\n\n'))
    controller.abort()
    await rejected
    expect(onDelta).not.toHaveBeenCalled()
    expect(cancel).toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
