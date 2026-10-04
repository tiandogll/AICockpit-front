import type { AssessmentMedia } from '../domain/assessmentMedia'

export type PracticalEventType =
  | 'task_decomposition'
  | 'prompt_draft'
  | 'prompt_revision'
  | 'tool_use'
  | 'result_verification'
  | 'artifact_note'

export type PracticalEvent = {
  id: string
  sequence: number
  event_type: PracticalEventType
  payload: Record<string, unknown>
  occurred_at: string
}

export type PracticalInteraction = {
  id: string
  sequence: number
  state: 'pending' | 'succeeded' | 'failed'
  prompt: string
  response: string | null
  degraded: boolean
  error_code: string | null
  created_at: string
  completed_at: string | null
}

export type PracticalArtifact = {
  id: string
  sequence: number
  state: 'pending' | 'ready' | 'failed'
  filename: string
  media_type: string
  byte_size: number
  sha256: string
  error_code: string | null
  created_at: string
  completed_at: string | null
  replayed: boolean
}

export type PracticalSnapshot = {
  workspace_id: string
  session_id: string
  item_version_id: string
  state: 'active' | 'submitted'
  task_type: 'text' | 'code' | 'image'
  stem: string
  media?: AssessmentMedia | null
  max_ai_interactions: number
  event_count: number
  interaction_count: number
  artifact_count: number
  submitted_at: string | null
  can_edit: boolean
  events: PracticalEvent[]
  interactions: PracticalInteraction[]
  artifacts: PracticalArtifact[]
  replayed: boolean
}

export type PracticalConnection = {
  apiBase: string
  token: string
  sessionId: string
  itemId: string
  request?: (path: string, init: RequestInit) => Promise<Response>
}

type Submission = {
  final_output: string
  artifact_id: string | null
  reflection: string | null
}

export class PracticalApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'PracticalApiError'
  }
}

function endpoint(connection: PracticalConnection, suffix = '') {
  return `/sessions/${connection.sessionId}/practical/${connection.itemId}${suffix}`
}

async function detail(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as {
      detail?: string | { code?: string; message?: string } | unknown[]
    }
    if (typeof body.detail === 'string') return body.detail
    if (body.detail && !Array.isArray(body.detail) && typeof body.detail.message === 'string') {
      return body.detail.message
    }
    if (Array.isArray(body.detail) && body.detail.length) return '请求字段不完整或格式不正确。'
    return fallback
  } catch {
    return fallback
  }
}

async function jsonRequest<T>(
  connection: PracticalConnection,
  path: string,
  init: RequestInit,
  fallback: string,
): Promise<T> {
  const response = connection.request
    ? await connection.request(path, init)
    : await fetch(`${connection.apiBase.replace(/\/$/, '')}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${connection.token}`,
          ...init.headers,
        },
      })
  if (!response.ok) {
    throw new PracticalApiError(await detail(response, fallback), response.status)
  }
  return (await response.json()) as T
}

export function makeIdempotencyKey(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`
}

export function getPracticalSnapshot(connection: PracticalConnection) {
  return jsonRequest<PracticalSnapshot>(
    connection,
    endpoint(connection),
    { method: 'GET' },
    '无法恢复实操工作台。',
  )
}

export function createPracticalWorkspace(
  connection: PracticalConnection,
  idempotencyKey = makeIdempotencyKey('workspace'),
) {
  return jsonRequest<PracticalSnapshot>(
    connection,
    `/sessions/${connection.sessionId}/practical/workspaces`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({ item_version_id: connection.itemId }),
    },
    '无法创建实操工作台。',
  )
}

export function appendPracticalEvent(
  connection: PracticalConnection,
  eventType: PracticalEventType,
  payload: Record<string, unknown>,
  idempotencyKey = makeIdempotencyKey('event'),
) {
  return jsonRequest<{ event: PracticalEvent }>(
    connection,
    endpoint(connection, '/events'),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({ event_type: eventType, payload }),
    },
    '证据记录失败。',
  )
}

export function runPracticalInteraction(
  connection: PracticalConnection,
  prompt: string,
  idempotencyKey = makeIdempotencyKey('interaction'),
) {
  return jsonRequest<PracticalInteraction>(
    connection,
    endpoint(connection, '/ai-interactions'),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({ prompt }),
    },
    'AI交互未能完成。',
  )
}

export function uploadPracticalArtifact(
  connection: PracticalConnection,
  file: File,
  idempotencyKey = makeIdempotencyKey('artifact'),
) {
  const body = new FormData()
  body.append('file', file)
  return jsonRequest<PracticalArtifact>(
    connection,
    endpoint(connection, '/artifacts'),
    {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body,
    },
    '文件产物上传失败。',
  )
}

export function submitPracticalWorkspace(
  connection: PracticalConnection,
  submission: Submission,
  idempotencyKey = makeIdempotencyKey('submit'),
) {
  return jsonRequest<{ answer_id: string; state: 'submitted' }>(
    connection,
    endpoint(connection, '/submit'),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(submission),
    },
    '最终产物提交失败。',
  )
}
