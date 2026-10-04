import { createPinia, setActivePinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import { planOptions } from '../services/blueprintAuthoringApi'

afterEach(() => vi.unstubAllGlobals())
it('sends repeated query keys for multi-select filters and omits empty filters', async () => {
  sessionStorage.setItem(
    'zhijian-auth-session',
    JSON.stringify({ accessToken: 'test-token', refreshToken: 'test-refresh' }),
  )
  setActivePinia(createPinia())
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"items":[],"total":0}'))
  vi.stubGlobal('fetch', request)
  await planOptions('items', {
    q: '来源 & 核验',
    item_types: ['objective', 'dialogue'],
    dimensions: ['evaluation', 'ethics'],
    offset: '0',
    limit: '30',
  })
  const params = new URL(String(request.mock.calls[0]![0]), 'http://localhost').searchParams
  expect(params.getAll('item_types')).toEqual(['objective', 'dialogue'])
  expect(params.getAll('dimensions')).toEqual(['evaluation', 'ethics'])
  expect(params.get('q')).toBe('来源 & 核验')
  request.mockResolvedValue(new Response('{"items":[],"total":0}'))
  await planOptions('items', { item_types: [], dimensions: [] })
  expect(String(request.mock.calls[1]![0])).not.toContain('item_types=')
})
