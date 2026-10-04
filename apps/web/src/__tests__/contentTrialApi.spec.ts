import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assignContentTrial,
  consentContentTrial,
  getContentTrial,
  listContentTrials,
  listTrialResults,
  saveContentTrialDraft,
  submitContentTrial,
  withdrawContentTrial,
} from '../services/contentTrialApi'

describe('independent content trial API', () => {
  beforeEach(() => {
    sessionStorage.clear()
    sessionStorage.setItem(
      'zhijian-auth-session',
      JSON.stringify({ accessToken: 'test-token', refreshToken: 'test-refresh' }),
    )
    setActivePinia(createPinia())
  })
  afterEach(() => vi.unstubAllGlobals())
  it('uses the isolated routes, escaped identifiers, bounded pages and authenticated requests', async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(async () => new Response('{}'))
    vi.stubGlobal('fetch', request)
    await listContentTrials(-5)
    await getContentTrial('a/b')
    await listTrialResults('a/b', 20000)
    expect(String(request.mock.calls[0]![0])).toContain('/content-trials?limit=20&offset=0')
    expect(String(request.mock.calls[1]![0])).toContain('/content-trials/a%2Fb')
    expect(String(request.mock.calls[2]![0])).toContain(
      '/content-reviews/a%2Fb/trial-results?limit=20&offset=10000',
    )
    for (const [, init] of request.mock.calls)
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test-token')
  })
  it('forwards revision and stable operation keys without writing formal assessment routes', async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(async () => new Response('{}'))
    vi.stubGlobal('fetch', request)
    const body = { expected_revision: 3, response: { selected_index: 1 }, feedback: '选项表述清楚' }
    await assignContentTrial(
      'packet',
      { expected_digest: 'digest', organization_id: 'org', learner_username: 'learner' },
      'assign-key',
    )
    await consentContentTrial('trial', 'consent-key')
    await saveContentTrialDraft('trial', body, 'draft-key')
    await submitContentTrial('trial', body, 'submit-key')
    await submitContentTrial('trial', body, 'submit-key')
    await withdrawContentTrial('trial', 'withdraw-key')
    expect(
      request.mock.calls.map(([, init]) => new Headers(init?.headers).get('Idempotency-Key')),
    ).toEqual([
      'assign-key',
      'consent-key',
      'draft-key',
      'submit-key',
      'submit-key',
      'withdraw-key',
    ])
    expect(JSON.parse(String(request.mock.calls[2]![1]?.body))).toEqual(body)
    expect(JSON.parse(String(request.mock.calls[1]![1]?.body))).toEqual({
      consent_version: 'content-quality-trial-v1',
    })
    expect(request.mock.calls.every(([url]) => !String(url).includes('/assessment'))).toBe(true)
  })
  it('keeps conflict and permission errors visible to the caller', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(JSON.stringify({ detail: '草稿已更新' }), { status: 409 })),
    )
    await expect(getContentTrial('trial')).rejects.toMatchObject({
      status: 409,
      message: '草稿已更新',
    })
  })
})
