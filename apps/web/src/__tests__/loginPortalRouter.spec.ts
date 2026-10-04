import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import router from '../router'
import { pinia } from '../stores/pinia'
import { useAuthStore } from '../stores/auth'
import { useAccessStore } from '../stores/access'

describe('login portal router guards', () => {
  it('resolves unknown URLs to a recovery page rather than an empty view', async () => {
    await router.push('/removed-page/example')
    expect(router.currentRoute.value.name).toBe('not-found')
    expect(router.currentRoute.value.matched).toHaveLength(1)
  })
  beforeEach(async () => {
    sessionStorage.clear()
    const auth = useAuthStore(pinia)
    auth.accessToken = ''
    auth.refreshToken = ''
    auth.user = null
    auth.initialized = true
    useAccessStore(pinia).clear()
    await router.push('/')
  })
  afterEach(() => vi.unstubAllGlobals())

  it('opens the actual workspace at the signed-in root while preserving a product introduction route', async () => {
    const auth = useAuthStore(pinia)
    auth.accessToken = 'token'
    auth.refreshToken = 'refresh'
    auth.user = {
      id: 'learner',
      username: 'user',
      email: null,
      display_name: '学员',
      is_active: true,
    }
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              organizations: [],
              global_capabilities: [],
            }),
          ),
      ),
    )
    await router.push('/about')
    expect(router.currentRoute.value.name).toBe('about')
    await router.push('/')
    expect(router.currentRoute.value.name).toBe('workspace')
    await router.push('/about')
    expect(router.currentRoute.value.name).toBe('about')
  })

  it('sends an unauthenticated content deep link to the separate staff login and preserves its query', async () => {
    await router.push('/item-bank?state=draft')
    expect(router.currentRoute.value.name).toBe('staff-login')
    expect(router.currentRoute.value.query.redirect).toBe('/item-bank?state=draft')
  })
  it('protects assigned author tasks with their own capability and staff entry', async () => {
    expect(router.resolve('/authoring').meta.capabilities).toEqual(['content_author'])
    await router.push('/authoring')
    expect(router.currentRoute.value.name).toBe('staff-login')
    expect(router.currentRoute.value.query.redirect).toBe('/authoring')
  })
  it('keeps student assessment links on the student login entrance', async () => {
    await router.push('/assessment/session-1')
    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.redirect).toBe('/assessment/session-1')
  })
  it('allows an authenticated learner to read the staff entrance while still refusing the item bank', async () => {
    const auth = useAuthStore(pinia)
    auth.accessToken = 'token'
    auth.refreshToken = 'refresh'
    auth.user = {
      id: 'learner',
      username: 'admin',
      email: null,
      display_name: '学员',
      is_active: true,
    }
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            organizations: [
              {
                id: 'personal',
                name: '个人空间',
                role: 'learner',
                capabilities: ['pilot_participate'],
              },
            ],
            global_capabilities: [],
          }),
        ),
      ),
    )
    await router.push('/staff/login')
    expect(router.currentRoute.value.name).toBe('staff-login')
    await router.push('/item-bank')
    expect(router.currentRoute.value.name).toBe('access-denied')
    expect(useAccessStore(pinia).globalCapabilities).toEqual([])
  })
})
