import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AUTH_EXPIRED_EVENT, useAuthStore } from '../stores/auth'

const tokenPair = {
  access_token: 'access-next',
  refresh_token: 'refresh-next',
  token_type: 'bearer',
}

describe('auth store', () => {
  it('explains an unreachable login service without exposing a raw browser error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const auth = useAuthStore()
    await expect(auth.login('user', 'test-only')).rejects.toThrow('暂时无法连接登录服务')
    expect(auth.isAuthenticated).toBe(false)
    vi.unstubAllGlobals()
  })
  it.each([401, 422, 429, 503])(
    'localizes login failure %s and does not create a session',
    async (status) => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            new Response(JSON.stringify({ detail: 'English server error' }), { status }),
          ),
      )
      const auth = useAuthStore()
      await expect(auth.login('user', 'test-only')).rejects.toThrow(/[\u4e00-\u9fff]/)
      expect(auth.isAuthenticated).toBe(false)
      vi.unstubAllGlobals()
    },
  )
  beforeEach(() => {
    sessionStorage.clear()
    setActivePinia(createPinia())
  })

  it('persists profile fields through the API and updates the shared identity, without storing profile locally', async () => {
    const auth = useAuthStore()
    auth.accessToken = 'fixture-access'
    auth.refreshToken = 'fixture-refresh'
    auth.user = {
      id: 'user-1',
      username: 'user',
      email: null,
      display_name: '学员',
      is_active: true,
    }
    const updated = {
      ...auth.user,
      display_name: '林晓',
      affiliation: '大学',
      specialty: null,
      learning_goal: '核验',
    }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(updated)))
    vi.stubGlobal('fetch', fetchMock)
    await auth.updateProfile({
      display_name: ' 林晓 ',
      affiliation: ' 大学 ',
      specialty: '',
      learning_goal: '核验',
    })
    expect(auth.user).toEqual(updated)
    expect(fetchMock.mock.calls[0]![1]?.method).toBe('PATCH')
    expect(JSON.parse(fetchMock.mock.calls[0]![1]?.body as string)).toMatchObject({
      display_name: '林晓',
      specialty: null,
    })
    expect(JSON.stringify(sessionStorage)).not.toContain('林晓')
    vi.unstubAllGlobals()
  })

  it('keeps the saved identity unchanged on profile failure', async () => {
    const auth = useAuthStore()
    auth.accessToken = 'fixture-access'
    auth.user = { id: 'user-1', email: null, display_name: '学员', is_active: true }
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 503 })),
    )
    await expect(auth.updateProfile({ display_name: '新姓名' })).rejects.toThrow('保存失败')
    expect(auth.user.display_name).toBe('学员')
    vi.unstubAllGlobals()
  })

  it.each([200, 401])(
    'does not replay a stale profile write to a new actor after an HTTP %s response',
    async (status) => {
      const auth = useAuthStore()
      auth.accessToken = 'old-access'
      auth.user = { id: 'old', email: null, display_name: '原账号', is_active: true }
      let finish!: (response: Response) => void
      const fetchMock = vi.fn<typeof fetch>().mockImplementation(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve
          }),
      )
      vi.stubGlobal('fetch', fetchMock)
      const pending = auth
        .updateProfile({ display_name: '新姓名' })
        .catch((cause: unknown) => cause)
      auth.user = { ...auth.user, id: 'new', display_name: '另一个账号' }
      auth.accessToken = 'new-access'
      finish(
        new Response(JSON.stringify({ ...auth.user, id: 'old', display_name: '新姓名' }), {
          status,
        }),
      )
      expect(await pending).toBeInstanceOf(Error)
      expect(auth.user.display_name).toBe('另一个账号')
      expect(fetchMock).toHaveBeenCalledOnce()
      vi.unstubAllGlobals()
    },
  )

  it('cannot be resurrected by a refresh response that arrives after logout begins', async () => {
    sessionStorage.setItem(
      'zhijian-auth-session',
      JSON.stringify({ accessToken: 'expired-access', refreshToken: 'active-refresh' }),
    )
    setActivePinia(createPinia())
    let finishRefresh: ((response: Response) => void) | undefined
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/protected')) return new Response(null, { status: 401 })
      if (url.endsWith('/auth/refresh')) {
        return await new Promise<Response>((resolve) => {
          finishRefresh = resolve
        })
      }
      if (url.endsWith('/auth/logout')) return new Response(null, { status: 204 })
      throw new Error(`unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const auth = useAuthStore()

    const protectedRequest = auth.request('/protected').catch((error: unknown) => error)
    await vi.waitFor(() => expect(finishRefresh).toBeTypeOf('function'))
    const logout = auth.logout()
    finishRefresh!(
      new Response(
        JSON.stringify({
          access_token: 'resurrected',
          refresh_token: 'resurrected-refresh',
          token_type: 'bearer',
        }),
        { status: 200 },
      ),
    )
    await Promise.all([protectedRequest, logout])

    expect(auth.isAuthenticated).toBe(false)
    expect(sessionStorage.getItem('zhijian-auth-session')).toBeNull()
    vi.unstubAllGlobals()
  })

  it('logs in, restores the current user and persists only in this tab', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(tokenPair), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'user-1',
            email: 'learner@example.test',
            display_name: '测评学员',
            is_active: true,
          }),
          { status: 200 },
        ),
      )
    vi.stubGlobal('fetch', fetchMock)
    const auth = useAuthStore()

    await auth.login('learner@example.test', 'secure-password')

    expect(auth.user?.display_name).toBe('测评学员')
    expect(sessionStorage.getItem('zhijian-auth-session')).toContain('refresh-next')
    expect(fetchMock.mock.calls[1]![1]?.headers).toMatchObject({
      Authorization: 'Bearer access-next',
    })
    vi.unstubAllGlobals()
  })

  it('uses one refresh rotation for concurrent 401 responses', async () => {
    sessionStorage.setItem(
      'zhijian-auth-session',
      JSON.stringify({ accessToken: 'access-old', refreshToken: 'refresh-old' }),
    )
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      const authorization = (init?.headers as Record<string, string> | undefined)?.Authorization
      if (url.endsWith('/auth/refresh')) {
        await Promise.resolve()
        return new Response(JSON.stringify(tokenPair), { status: 200 })
      }
      if (authorization === 'Bearer access-old') return new Response('', { status: 401 })
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const auth = useAuthStore()

    const [first, second] = await Promise.all([
      auth.request('/protected/one'),
      auth.request('/protected/two'),
    ])

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/auth/refresh')),
    ).toHaveLength(1)
    expect(auth.accessToken).toBe('access-next')
    vi.unstubAllGlobals()
  })

  it('accepts a username-only user and never trims the submitted password', async () => {
    const samplePassword = ` ${'x'.repeat(12)} `
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(tokenPair), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'user-1',
            username: 'learner.demo',
            email: null,
            display_name: '学员',
            is_active: true,
          }),
          { status: 200 },
        ),
      )
    vi.stubGlobal('fetch', fetchMock)
    const auth = useAuthStore()
    await auth.login(' learner.demo ', samplePassword)
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({
      identifier: 'learner.demo',
      password: samplePassword,
    })
    expect(auth.user?.email).toBeNull()
    expect(auth.user?.username).toBe('learner.demo')
    vi.unstubAllGlobals()
  })

  it('clears credentials when refresh fails and always clears on logout', async () => {
    const expired = vi.fn<() => void>()
    window.addEventListener(AUTH_EXPIRED_EVENT, expired, { once: true })
    sessionStorage.setItem(
      'zhijian-auth-session',
      JSON.stringify({ accessToken: 'expired', refreshToken: 'revoked' }),
    )
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response('', { status: 401 }))
        .mockResolvedValueOnce(new Response('', { status: 401 })),
    )
    const auth = useAuthStore()

    await expect(auth.request('/protected')).rejects.toThrow('登录状态已失效')
    expect(auth.isAuthenticated).toBe(false)
    expect(expired).toHaveBeenCalledOnce()
    expect(sessionStorage.getItem('zhijian-auth-session')).toBeNull()

    sessionStorage.setItem(
      'zhijian-auth-session',
      JSON.stringify({ accessToken: 'access', refreshToken: 'refresh' }),
    )
    setActivePinia(createPinia())
    const second = useAuthStore()
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new Error('offline')))
    await second.logout()
    expect(second.isAuthenticated).toBe(false)
    expect(sessionStorage.getItem('zhijian-auth-session')).toBeNull()
    vi.unstubAllGlobals()
  })
})
