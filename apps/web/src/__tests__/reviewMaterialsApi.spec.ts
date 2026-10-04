import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadReviewArtifact, getReviewMaterials } from '../services/reviewApi'

const artifact = {
  id: 'artifact-1',
  filename: 'evidence.txt',
  byte_size: 3,
  media_type: 'text/plain',
  sha256: 'a'.repeat(64),
}
beforeEach(() => {
  sessionStorage.clear()
  sessionStorage.setItem(
    'zhijian-auth-session',
    JSON.stringify({ accessToken: 'synthetic-review', refreshToken: 'synthetic-refresh' }),
  )
  setActivePinia(createPinia())
})
afterEach(() => vi.unstubAllGlobals())

describe('authorized review material API', () => {
  it('uses explicit cursors and authenticated requests without putting credentials in the URL', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    await getReviewMaterials('decision-1', 50, 20)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toContain(
      '/decision-1/materials?event_after=50&interaction_after=20&limit=50',
    )
    expect(String(url)).not.toContain('synthetic-review')
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer synthetic-review')
  })
  it('accepts only a successful file matching sealed size, media type and hash metadata', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response('abc', {
            headers: { 'Content-Type': 'text/plain', 'X-Artifact-SHA256': artifact.sha256 },
          }),
        ),
    )
    const blob = await downloadReviewArtifact('decision-1', artifact)
    expect(await blob.text()).toBe('abc')
  })
  it.each<Record<string, string>>([
    { 'Content-Type': 'text/plain', 'X-Artifact-SHA256': 'b'.repeat(64) },
    { 'Content-Type': 'text/html', 'X-Artifact-SHA256': artifact.sha256 },
    { 'Content-Type': 'text/plain' },
  ])('rejects missing or inconsistent sealed metadata', async (headers) => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response('abc', { headers })),
    )
    await expect(downloadReviewArtifact('decision-1', artifact)).rejects.toThrow('封存记录不一致')
  })
  it('propagates a privacy or permission failure without returning file bytes', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response('{"detail":"材料不存在或不可访问"}', { status: 404 })),
    )
    await expect(downloadReviewArtifact('decision-1', artifact)).rejects.toThrow('不可访问')
  })
})
