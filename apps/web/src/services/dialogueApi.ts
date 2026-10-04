import { requireJson, responseError } from './apiClient'
import { useAuthStore } from '../stores/auth'
import type { DialogueAttachment } from './assessmentWorkspaceApi'

export type DialogueTurn = {
  exchange_id: string
  turn_id: string
  item_version_id: string
  sequence: number
  state: 'awaiting_ai' | 'generating' | 'awaiting_user' | 'completed'
  max_turns: number
  turn_count: number
  user_content: string
  submitted_at: string
  replayed: boolean
}

export type DialogueHistoryTurn = {
  id: string
  sequence: number
  user_content: string
  submitted_at: string
  assistant_content: string | null
  assistant_completed_at: string | null
  degraded: boolean
  attachments?: DialogueAttachment[]
}

export type DialogueSnapshot = {
  exchange_id: string
  session_id: string
  item_version_id: string
  state: 'awaiting_ai' | 'generating' | 'awaiting_user' | 'completed'
  max_turns: number
  turn_count: number
  last_error_code: string | null
  completed_at: string | null
  can_submit: boolean
  can_retry_generation: boolean
  turns: DialogueHistoryTurn[]
}

export type DialogueDone = { turn_id: string; replayed?: boolean; completed?: boolean }

export class DialogueStreamError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    message = 'AI面试官响应未能完整固化。',
  ) {
    super(message)
    this.name = 'DialogueStreamError'
  }
}

export function getDialogueSnapshot(
  sessionId: string,
  itemVersionId: string,
  signal?: AbortSignal,
) {
  return useAuthStore()
    .request(`/sessions/${sessionId}/dialogue/${itemVersionId}`, { signal })
    .then((response) => requireJson<DialogueSnapshot>(response, '无法恢复对话记录。'))
}

export function submitDialogueTurn(
  sessionId: string,
  itemVersionId: string,
  content: string,
  idempotencyKey: string,
  attachmentIds: string[] = [],
  signal?: AbortSignal,
) {
  return useAuthStore()
    .request(`/sessions/${sessionId}/dialogue/turns`, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({
        item_version_id: itemVersionId,
        content,
        attachment_ids: attachmentIds,
      }),
    })
    .then((response) => requireJson<DialogueTurn>(response, '对话回答未能保存。'))
}

type SseFrame = { event: string; payload: Record<string, unknown> }

function parseFrame(frame: string): SseFrame | null {
  let event = ''
  const data: string[] = []
  for (const line of frame.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue
    const separator = line.indexOf(':')
    const field = separator < 0 ? line : line.slice(0, separator)
    let value = separator < 0 ? '' : line.slice(separator + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') event = value
    if (field === 'data') data.push(value)
  }
  if (!event || !data.length) return null
  let payload: unknown
  try {
    payload = JSON.parse(data.join('\n'))
  } catch {
    throw new DialogueStreamError('invalid_event', false)
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new DialogueStreamError('invalid_event', false)
  }
  return { event, payload: payload as Record<string, unknown> }
}

export async function streamDialogueResponse(
  sessionId: string,
  turnId: string,
  idempotencyKey: string,
  onDelta: (content: string) => void,
  signal?: AbortSignal,
): Promise<DialogueDone> {
  const response = await useAuthStore().request(
    `/sessions/${sessionId}/dialogue/turns/${turnId}/response:stream`,
    { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, signal },
  )
  if (!response.ok) throw await responseError(response, 'AI面试官暂时无法响应。')
  if (!response.body) throw new DialogueStreamError('missing_stream', true)

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let metaSeen = false
  const cancelReader = () => {
    void reader.cancel().catch(() => undefined)
  }
  signal?.addEventListener('abort', cancelReader, { once: true })
  try {
    while (true) {
      signal?.throwIfAborted()
      const { done, value } = await reader.read()
      signal?.throwIfAborted()
      buffer += decoder.decode(value, { stream: !done })
      if (buffer.length > 100_000) throw new DialogueStreamError('event_too_large', false)
      let boundary = buffer.search(/\r?\n\r?\n/)
      while (boundary >= 0) {
        const frame = parseFrame(buffer.slice(0, boundary))
        const separator = buffer.slice(boundary).match(/^\r?\n\r?\n/)?.[0] ?? '\n\n'
        buffer = buffer.slice(boundary + separator.length)
        if (frame?.event === 'meta') {
          if (metaSeen || frame.payload.turn_id !== turnId) {
            throw new DialogueStreamError('turn_mismatch', false)
          }
          metaSeen = true
        } else if (frame?.event === 'delta') {
          if (!metaSeen) throw new DialogueStreamError('invalid_event_order', false)
          const content = frame.payload.content
          if (typeof content !== 'string') throw new DialogueStreamError('invalid_event', false)
          onDelta(content)
        } else if (frame?.event === 'error') {
          throw new DialogueStreamError(
            typeof frame.payload.code === 'string' ? frame.payload.code : 'generation_failed',
            frame.payload.retryable === true,
          )
        } else if (frame?.event === 'done') {
          if (!metaSeen || frame.payload.turn_id !== turnId) {
            throw new DialogueStreamError('turn_mismatch', false)
          }
          try {
            await reader.cancel()
          } catch {
            /* Durable done remains authoritative. */
          }
          return frame.payload as DialogueDone
        } else if (frame) {
          throw new DialogueStreamError('unsupported_event', false)
        }
        boundary = buffer.search(/\r?\n\r?\n/)
      }
      if (done) break
    }
  } finally {
    signal?.removeEventListener('abort', cancelReader)
    try {
      await reader.cancel()
    } catch {
      /* Preserve the original stream failure. */
    }
    reader.releaseLock()
  }
  throw new DialogueStreamError('incomplete_stream', true)
}
