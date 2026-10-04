import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createItem, type CreateItemRequest } from '../services/contentApi'

const body: CreateItemRequest = {
  dimension_code: 'foundations',
  item_type: 'objective',
  difficulty: 0,
  stem: '核验题',
  configuration: {
    options: ['核验', '不核验'],
    metadata: { tags: [], scenarios: ['general'], content_tier: 'basic' },
  },
  answer_key: { correct_option: '核验' },
  rubric_version_id: null,
}
describe('content creation API', () => {
  beforeEach(() => {
    sessionStorage.clear()
    sessionStorage.setItem(
      'zhijian-auth-session',
      JSON.stringify({ accessToken: 'test-only', refreshToken: 'test-refresh' }),
    )
    setActivePinia(createPinia())
  })
  afterEach(() => vi.unstubAllGlobals())
  it('posts an authenticated new draft without a publication transition', async () => {
    const identity = {
      id: 'new-item',
      logical_id: 'logical-item',
      version: 1,
      publication_status: 'draft',
    }
    const request = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify(identity), { status: 201 }),
    )
    vi.stubGlobal('fetch', request)
    expect(await createItem(body)).toEqual(identity)
    expect(request).toHaveBeenCalledTimes(1)
    const [url, init] = request.mock.calls[0]!
    expect(String(url)).toContain('/admin/items')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual(body)
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test-only')
  })
  it('surfaces backend validation errors without reporting success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(
        async () =>
          new Response(JSON.stringify({ detail: 'metadata scenarios is invalid' }), {
            status: 422,
          }),
      ),
    )
    await expect(createItem(body)).rejects.toThrow('metadata scenarios is invalid')
  })
})
