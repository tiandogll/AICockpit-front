import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getContentReview,
  listContentReviews,
  submitContentReview,
  getPublicationPreview,
  publishContentReview,
  type SubmitReview,
} from '../services/contentReviewApi'

describe('content review API', () => {
  beforeEach(() => {
    sessionStorage.clear()
    sessionStorage.setItem(
      'zhijian-auth-session',
      JSON.stringify({ accessToken: 'review-test-only', refreshToken: 'refresh-test-only' }),
    )
    setActivePinia(createPinia())
  })
  afterEach(() => vi.unstubAllGlobals())
  it('loads filtered bounded pages with authentication and escapes detail identifiers', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ items: [], total: 0, limit: 20, offset: 0 })),
      )
    vi.stubGlobal('fetch', request)
    await listContentReviews(
      { status: 'pending', dimension: 'evaluation', item_type: 'dialogue' },
      -20,
    )
    const [url, init] = request.mock.calls[0]!
    const query = new URL(String(url)).searchParams
    expect(query.get('limit')).toBe('20')
    expect(query.get('offset')).toBe('0')
    expect(query.get('status')).toBe('pending')
    expect(query.get('dimension')).toBe('evaluation')
    expect(query.get('item_type')).toBe('dialogue')
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer review-test-only')
    request.mockResolvedValueOnce(new Response('{}'))
    await getContentReview('a/b')
    expect(String(request.mock.calls[1]![0])).toContain('/content-reviews/a%2Fb')
  })
  it('binds a decision to the digest and forwards the same caller idempotency key, without publication', async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(async () => new Response('{}'))
    vi.stubGlobal('fetch', request)
    const body: SubmitReview = {
      expected_digest: 'a'.repeat(64),
      decision: 'request_changes',
      comment: '请校对这一处原文并补齐评分依据。',
      checks: { source: true, answer: false, rubric: false, fairness: false },
    }
    await submitContentReview('packet-1', body, 'review-key')
    await submitContentReview('packet-1', body, 'review-key')
    for (const [url, init] of request.mock.calls) {
      expect(String(url)).toContain('/content-reviews/packet-1/decisions')
      expect(init?.method).toBe('POST')
      expect(new Headers(init?.headers).get('Idempotency-Key')).toBe('review-key')
      expect(JSON.parse(String(init?.body))).toEqual(body)
      expect(String(init?.body)).not.toContain('published')
    }
  })
  it('preserves error status to allow sensitive UI cleanup', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(JSON.stringify({ detail: 'assignment revoked' }), { status: 403 }),
        ),
    )
    await expect(getContentReview('packet-1')).rejects.toMatchObject({
      status: 403,
      message: 'assignment revoked',
    })
  })
  it.each(['published', 'unpublished', 'ready'] as const)(
    'sends publication filter %s with the audit filters before pagination',
    async (publication_status) => {
      const request = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(JSON.stringify({ items: [], total: 0, limit: 20, offset: 20 })),
        )
      vi.stubGlobal('fetch', request)
      await listContentReviews(
        { status: 'reviewed', dimension: 'evaluation', item_type: 'dialogue', publication_status },
        20,
      )
      const query = new URL(String(request.mock.calls[0]![0])).searchParams
      expect(query.get('publication_status')).toBe(publication_status)
      expect(query.get('status')).toBe('reviewed')
      expect(query.get('offset')).toBe('20')
    },
  )
  it('reads publication preview and sends only the selected plans with a stable idempotency key', async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(async () => new Response('{}'))
    vi.stubGlobal('fetch', request)
    await getPublicationPreview('packet/1')
    expect(String(request.mock.calls[0]![0])).toContain(
      '/content-reviews/packet%2F1/publication-preview',
    )
    const body = { expected_digest: 'digest', preview_token: 'preview', blueprint_ids: ['plan-1'] }
    await publishContentReview('packet/1', body, 'stable-publication-key')
    await publishContentReview('packet/1', body, 'stable-publication-key')
    for (const [url, init] of request.mock.calls.slice(1)) {
      expect(String(url)).toContain('/content-reviews/packet%2F1/publication')
      expect(init?.method).toBe('POST')
      expect(new Headers(init?.headers).get('Idempotency-Key')).toBe('stable-publication-key')
      expect(JSON.parse(String(init?.body))).toEqual(body)
    }
  })
})
