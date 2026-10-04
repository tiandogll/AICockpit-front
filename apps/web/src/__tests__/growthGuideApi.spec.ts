import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getGrowthGuide as rawGetGrowthGuide,
  isSafeGrowthGuidePath,
} from '../services/growthGuideApi'
const getGrowthGuide: typeof rawGetGrowthGuide = (
  org,
  question,
  options = { provider: 'deepseek', idempotencyKey: 'test-request' },
) => rawGetGrowthGuide(org, question, options)

const sessionId = '2e59576f-0b97-4138-8fd8-c3d01bac1e10'
const reply = {
  mode: 'deepseek',
  scope: 'personal_growth',
  paragraphs: ['按系统顺序完成正式测评。'],
  actions: [{ label: '开始测评', path: '/assessment' }],
  source: null,
  generation: {
    requested_provider: 'deepseek',
    status: 'succeeded',
    model: 'deepseek-flash',
    error_code: null,
    usage: null,
  },
}

describe('growth guide API', () => {
  it('rejects legacy local fallbacks rather than returning them as answers', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(
            JSON.stringify({
              ...reply,
              mode: 'local_guidance',
              generation: {
                requested_provider: 'deepseek',
                status: 'fallback',
                model: null,
                error_code: 'timeout',
                usage: null,
              },
            }),
          ),
        ),
    )
    await expect(
      getGrowthGuide('org-1', '你好', { provider: 'deepseek', idempotencyKey: 'request-1' }),
    ).rejects.toMatchObject({ code: 'timeout' })
  })
  it('preserves structured assessment errors as system state, not generated answers', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(
            JSON.stringify({
              detail: { code: 'assessment_active', message: '请先暂存退出当前测评。' },
            }),
            { status: 409 },
          ),
        ),
    )
    await expect(
      getGrowthGuide('org-1', '你好', { provider: 'deepseek', idempotencyKey: 'request-1' }),
    ).rejects.toMatchObject({ code: 'assessment_active', message: '请先暂存退出当前测评。' })
  })
  it('rejects legacy pending-report fixed guidance rather than presenting a reply', async () => {
    const restricted = {
      ...reply,
      mode: 'local_guidance',
      scope: 'personal_growth',
      generation: {
        requested_provider: 'deepseek',
        status: 'restricted',
        model: null,
        error_code: null,
        usage: null,
      },
      source: {
        report_id: sessionId,
        session_id: sessionId,
        revision: 2,
        status: 'pending_scoring',
      },
    }
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(restricted))),
    )
    await expect(getGrowthGuide('org-1', '报告怎么看？')).rejects.toThrow('未返回有效回答')
  })
  it('requires an explicit provider and stable key for a real generation, validating its metadata', async () => {
    const generated = {
      ...reply,
      mode: 'deepseek',
      scope: 'personal_growth',
      generation: {
        requested_provider: 'deepseek',
        status: 'succeeded',
        model: 'deepseek-flash',
        error_code: null,
        usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
      },
    }
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(generated)))
    vi.stubGlobal('fetch', request)
    expect(
      await getGrowthGuide('org-1', '如何核验？', {
        provider: 'deepseek',
        idempotencyKey: 'stable-guide-key',
      }),
    ).toEqual(generated)
    expect(new Headers(request.mock.calls[0]![1]!.headers).get('Idempotency-Key')).toBe(
      'stable-guide-key',
    )
    expect(JSON.parse(String(request.mock.calls[0]![1]!.body)).provider).toBe('deepseek')
    await expect(getGrowthGuide('org-1', '如何核验？', { provider: 'deepseek' })).rejects.toThrow(
      '请求标识',
    )
    expect(request).toHaveBeenCalledTimes(1)
  })

  it.each([
    { status: 'fallback', model: 'deepseek-flash', error_code: 'timeout', usage: null },
    { status: 'succeeded', model: null, error_code: null, usage: null },
    {
      status: 'succeeded',
      model: 'deepseek-flash',
      error_code: null,
      usage: { input_tokens: -1, output_tokens: 5, total_tokens: 4 },
    },
  ])('rejects contradictory generation metadata %s', async (generation) => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            ...reply,
            mode: 'deepseek',
            scope: 'personal_growth',
            generation: { requested_provider: 'deepseek', ...generation },
          }),
        ),
      ),
    )
    await expect(getGrowthGuide('org-1', '帮助')).rejects.toThrow('引导响应格式')
  })

  it('explains an already attempted generation without silently reissuing it', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{"detail":"request_already_processed"}', { status: 409 }))
    vi.stubGlobal('fetch', request)
    await expect(
      getGrowthGuide('org-1', '帮助', { provider: 'deepseek', idempotencyKey: 'same-request-id' }),
    ).rejects.toThrow('不会再次调用')
    expect(request).toHaveBeenCalledTimes(1)
  })
  beforeEach(() => {
    sessionStorage.clear()
    sessionStorage.setItem(
      'zhijian-auth-session',
      JSON.stringify({ accessToken: 'token', refreshToken: 'refresh' }),
    )
    setActivePinia(createPinia())
  })
  afterEach(() => vi.unstubAllGlobals())

  it('sends only the current organization and trimmed question through authenticated POST', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(reply)))
    vi.stubGlobal('fetch', request)
    expect(await getGrowthGuide('org-1', '  如何开始？  ')).toEqual(reply)
    expect(String(request.mock.calls[0]![0])).toMatch(/\/workspace\/guide$/)
    const init = request.mock.calls[0]![1]!
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      organization_id: 'org-1',
      question: '如何开始？',
      provider: 'deepseek',
    })
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer token')
    expect(new Headers(init.headers).get('Idempotency-Key')).toBe('test-request')
  })

  it.each(['', '   ', '问'.repeat(201)])(
    'rejects invalid questions without a request',
    async (question) => {
      const request = vi.fn<typeof fetch>()
      vi.stubGlobal('fetch', request)
      await expect(getGrowthGuide('org-1', question)).rejects.toThrow('1–200')
      expect(request).not.toHaveBeenCalled()
    },
  )

  it.each([
    '/workspace',
    '/assessment',
    '/reports',
    '/training',
    '/history',
    '/help',
    `/assessment/${sessionId}`,
    `/reports/${sessionId}`,
  ])('allows existing learner route %s', (path) => {
    expect(isSafeGrowthGuidePath(path)).toBe(true)
  })

  it.each([
    'https://evil.test',
    '//evil.test',
    'javascript:alert(1)',
    '/\\evil.test',
    '/reports/not-a-uuid',
    '/reports/../members',
    '/%2f%2fevil.test',
    '/assessment?redirect=https://evil.test',
    '/system',
    `/sessions/${sessionId}`,
    '/help#unsafe',
    '/help\n',
    `/reports/${sessionId}\n`,
    `/assessment/${sessionId}\r`,
  ])('rejects unsafe or unsupported action route %s', (path) => {
    expect(isSafeGrowthGuidePath(path)).toBe(false)
  })

  it('filters unsafe actions and malformed source instead of rendering links', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            ...reply,
            actions: [...reply.actions, { label: '危险', path: '//evil.test' }],
            source: {
              report_id: sessionId,
              session_id: '//evil.test',
              revision: 1,
              status: 'complete',
            },
          }),
        ),
      ),
    )
    const result = await getGrowthGuide('org-1', '查看报告')
    expect(result.actions).toEqual(reply.actions)
    expect(result.source).toBeNull()
  })

  it('preserves server failures and rejects responses posing as another service mode', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{"detail":"请稍后重试"}', { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...reply, mode: 'large_model' })))
    vi.stubGlobal('fetch', request)
    await expect(getGrowthGuide('org-1', '帮助')).rejects.toThrow('请稍后重试')
    await expect(getGrowthGuide('org-1', '帮助')).rejects.toThrow('引导响应格式')
  })

  it('does not accept a source UUID with trailing control characters', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            ...reply,
            source: {
              report_id: sessionId,
              session_id: `${sessionId}\n`,
              revision: 2,
              status: 'complete',
            },
          }),
        ),
      ),
    )
    expect((await getGrowthGuide('org-1', '报告')).source).toBeNull()
  })
})
