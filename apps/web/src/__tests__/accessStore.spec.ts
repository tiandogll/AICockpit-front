import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '../stores/auth'
import { useAccessStore } from '../stores/access'

describe('server access context', () => {
  beforeEach(() => {
    sessionStorage.clear()
    sessionStorage.setItem(
      'zhijian-auth-session',
      JSON.stringify({ accessToken: 'a', refreshToken: 'r' }),
    )
    setActivePinia(createPinia())
    useAuthStore().user = {
      id: 'u',
      email: 'u@example.test',
      display_name: '学员',
      is_active: true,
    }
  })
  afterEach(() => vi.unstubAllGlobals())
  it('reads single-platform mode and resets it on failed refresh and logout', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({
      single_platform_enabled: true,
      organizations: [{ id: 'platform', name: 'AI Measure', role: 'learner', capabilities: [] }],
      global_capabilities: [],
    }))).mockResolvedValueOnce(new Response('', { status: 503 }))
    vi.stubGlobal('fetch', request)
    const access = useAccessStore()
    expect(access.singlePlatform).toBe(false)
    await access.load()
    expect(access.singlePlatform).toBe(true)
    await access.load(true)
    expect(access.singlePlatform).toBe(false)
    access.singlePlatform = true
    access.clear()
    expect(access.singlePlatform).toBe(false)
  })
  it('waits for /auth/me before publishing organization scope', async () => {
    const auth = useAuthStore()
    auth.user = null
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          organizations: [{ id: 'o', name: '本人的组织', role: 'learner', capabilities: [] }],
          global_capabilities: [],
        }),
      ),
    )
    vi.stubGlobal('fetch', request)
    const access = useAccessStore()
    await access.load()
    expect(request).not.toHaveBeenCalled()
    expect(access.organizationId).toBe('')
    expect(access.ready).toBe(false)
    auth.user = { id: 'hydrated', email: null, display_name: '学员', is_active: true }
    await access.load()
    expect(request).toHaveBeenCalledTimes(1)
    expect(access.organizationId).toBe('o')
    expect(access.ready).toBe(true)
  })
  it('fails closed and does not infer admin from the organization name', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(
            JSON.stringify({
              organizations: [
                { id: 'o', name: '管理组织', role: 'learner', capabilities: ['pilot_participate'] },
              ],
              global_capabilities: [],
            }),
          ),
        ),
    )
    const access = useAccessStore()
    await access.load()
    expect(access.organizationId).toBe('o')
    expect(access.can('content')).toBe(false)
    expect(access.can('pilot_participate')).toBe(true)
  })
  it('clears permissions after a failed refresh', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ organizations: [], global_capabilities: ['system'] })),
      )
      .mockResolvedValueOnce(new Response('', { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)
    const access = useAccessStore()
    await access.load()
    expect(access.can('system')).toBe(true)
    await access.load(true)
    expect(access.can('system')).toBe(false)
    expect(access.error).toBeTruthy()
  })
  it('rejects a late result after clearing the session', async () => {
    let resolve!: (value: Response) => void
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(
        () =>
          new Promise((done) => {
            resolve = done
          }),
      ),
    )
    const access = useAccessStore()
    const pending = access.load()
    access.clear()
    resolve(new Response(JSON.stringify({ organizations: [], global_capabilities: ['system'] })))
    await pending
    expect(access.can('system')).toBe(false)
    expect(access.ready).toBe(false)
  })
})
