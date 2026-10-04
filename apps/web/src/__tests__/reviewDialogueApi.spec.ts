import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  downloadReviewDialogueAttachment,
  type ReviewDialogueAttachment,
} from '../services/reviewApi'

const attachment: ReviewDialogueAttachment = {
  id: 'file-1',
  filename: 'proof.txt',
  media_type: 'text/plain',
  byte_size: 3,
  sha256: 'a'.repeat(64),
  state: 'ready',
  parse_status: 'text_ready',
  bound_turn_id: 'turn-1',
  created_at: '2026-09-15T01:00:00Z',
}
beforeEach(() => {
  sessionStorage.clear()
  sessionStorage.setItem(
    'zhijian-auth-session',
    JSON.stringify({ accessToken: 'token', refreshToken: 'refresh' }),
  )
  setActivePinia(createPinia())
})
afterEach(() => vi.unstubAllGlobals())

describe('review dialogue file API', () => {
  it('uses the authorized reviewer endpoint and requires the sealed metadata to match', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('abc', {
        headers: {
          'Content-Type': 'text/plain',
          'X-Artifact-SHA256': attachment.sha256,
        },
      }),
    )
    vi.stubGlobal('fetch', fetcher)
    expect((await downloadReviewDialogueAttachment('decision-1', attachment)).size).toBe(3)
    expect(String(fetcher.mock.calls[0]?.[0])).toContain(
      '/admin/reviews/decision-1/dialogue-attachments/file-1/content',
    )
  })
  it.each(['hash', 'size', 'type'])(
    'refuses mismatched %s instead of returning a renderable blob',
    async (kind) => {
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>().mockResolvedValue(
          new Response(kind === 'size' ? 'extra' : 'abc', {
            headers: {
              'Content-Type': kind === 'type' ? 'text/html' : 'text/plain',
              'X-Artifact-SHA256': kind === 'hash' ? 'b'.repeat(64) : attachment.sha256,
            },
          }),
        ),
      )
      await expect(downloadReviewDialogueAttachment('decision-1', attachment)).rejects.toThrow(
        '文件信息与封存记录不一致',
      )
    },
  )
})
