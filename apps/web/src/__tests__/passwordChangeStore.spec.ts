import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '../stores/auth'

const values = {
  current_password: 'old1234',
  new_password: ' 新的密码 🌱 abc ',
  confirm_password: ' 新的密码 🌱 abc ',
}

function signedIn() {
  const auth = useAuthStore()
  auth.user = {
    id: 'first',
    username: 'sample',
    email: null,
    display_name: '学员',
    is_active: true,
    password_change_available: true,
  }
  auth.accessToken = 'old-access'
  auth.refreshToken = 'old-refresh'
  sessionStorage.setItem(
    'zhijian-auth-session',
    JSON.stringify({ accessToken: 'old-access', refreshToken: 'old-refresh' }),
  )
  return auth
}

beforeEach(() => {
  sessionStorage.clear()
  setActivePinia(createPinia())
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('change-password auth contract', () => {
  it('bounds a 401 refresh wait and never replays the mutation after its timeout', async () => {
    vi.useFakeTimers()
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((delay) => {
      const controller = new AbortController()
      setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), delay)
      return controller.signal
    })
    const auth = signedIn()
    let finishRefresh!: (response: Response) => void
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((url) =>
      String(url).endsWith('/auth/refresh')
        ? new Promise((resolve) => {
            finishRefresh = resolve
          })
        : Promise.resolve(new Response(null, { status: 401 })),
    )
    vi.stubGlobal('fetch', fetchMock)
    const pending = auth.changePassword(values).catch((cause: unknown) => cause)
    await vi.advanceTimersByTimeAsync(20_001)
    expect(await pending).toBeInstanceOf(Error)
    expect(auth.isAuthenticated).toBe(false)
    finishRefresh(
      new Response(
        JSON.stringify({
          access_token: 'too-late',
          refresh_token: 'too-late',
          token_type: 'bearer',
        }),
      ),
    )
    await vi.advanceTimersByTimeAsync(1)
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/auth/change-password')),
    ).toHaveLength(1)
    expect(auth.accessToken).toBe('')
  })

  it('bounds a completely unresponsive password request without repeating it', async () => {
    vi.useFakeTimers()
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((delay) => {
      const controller = new AbortController()
      setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), delay)
      return controller.signal
    })
    const auth = signedIn()
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {})),
    )
    const pending = auth.changePassword(values).catch((cause: unknown) => cause)
    await vi.advanceTimersByTimeAsync(20_001)
    expect(await pending).toMatchObject({
      message: expect.stringContaining('无法确认密码是否已修改'),
    })
    expect(fetch).toHaveBeenCalledOnce()
    expect(auth.isAuthenticated).toBe(true)
  })

  it('does not sign out a new actor when the old session retry returns 401', async () => {
    const auth = signedIn()
    let finishRetry!: (response: Response) => void
    let sent = 0
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation((url) => {
        if (String(url).endsWith('/auth/refresh'))
          return Promise.resolve(
            new Response(
              JSON.stringify({
                access_token: 'rotated',
                refresh_token: 'rotated-refresh',
                token_type: 'bearer',
              }),
            ),
          )
        sent += 1
        return sent === 1
          ? Promise.resolve(new Response(null, { status: 401 }))
          : new Promise((resolve) => {
              finishRetry = resolve
            })
      }),
    )
    const pending = auth.changePassword(values).catch((cause: unknown) => cause)
    await vi.waitFor(() => expect(finishRetry).toBeTypeOf('function'))
    auth.user = { ...auth.user!, id: 'second' }
    auth.accessToken = 'second-access'
    auth.refreshToken = 'second-refresh'
    finishRetry(new Response(null, { status: 401 }))
    expect(await pending).toBeInstanceOf(Error)
    expect(auth.user?.id).toBe('second')
    expect(auth.accessToken).toBe('second-access')
  })
  it.each([undefined, false])(
    'does not call an old API without the explicit password-change capability (%s)',
    async (available) => {
      const auth = signedIn()
      auth.user!.password_change_available = available
      vi.stubGlobal('fetch', vi.fn<typeof fetch>())
      await expect(auth.changePassword(values)).rejects.toThrow('当前服务尚未开放修改密码')
      expect(fetch).not.toHaveBeenCalled()
      expect(auth.isAuthenticated).toBe(true)
    },
  )
  it('sends exact password strings and clears only the successful current session', async () => {
    const auth = signedIn()
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    await auth.changePassword(values)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(String(fetchMock.mock.calls[0]![0])).toMatch(/\/auth\/change-password$/)
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({
      method: 'POST',
      headers: { Authorization: 'Bearer old-access' },
    })
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual(values)
    expect(auth.user).toBeNull()
    expect(auth.isAuthenticated).toBe(false)
    expect(sessionStorage.getItem('zhijian-auth-session')).toBeNull()
    expect(JSON.stringify(sessionStorage)).not.toContain(values.new_password)
  })

  it.each([
    [400, '当前密码不正确'],
    [409, '账号安全信息已变化'],
    [422, '8–256'],
    [429, '过于频繁'],
    [503, '暂不可用'],
  ])(
    'localizes HTTP %s without leaking server detail or clearing the session',
    async (status, message) => {
      const auth = signedIn()
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>().mockResolvedValue(
          new Response(JSON.stringify({ detail: values.new_password }), {
            status: Number(status),
          }),
        ),
      )
      await expect(auth.changePassword(values)).rejects.toThrow(String(message))
      expect(auth.user?.id).toBe('first')
      expect(auth.isAuthenticated).toBe(true)
      expect(fetch).toHaveBeenCalledOnce()
    },
  )

  it('explains an uncertain network outcome without retrying the mutation', async () => {
    const auth = signedIn()
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch')),
    )
    await expect(auth.changePassword(values)).rejects.toThrow('无法确认密码是否已修改')
    expect(fetch).toHaveBeenCalledOnce()
    expect(auth.user?.id).toBe('first')
  })

  it.each([204, 400, 401])(
    'does not clear or replay a stale HTTP %s result into another account',
    async (status) => {
      const auth = signedIn()
      let finish!: (response: Response) => void
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>().mockImplementation(
          () =>
            new Promise((resolve) => {
              finish = resolve
            }),
        ),
      )
      const changing = auth.changePassword(values).catch((error: unknown) => error)
      auth.user = { ...auth.user!, id: 'second' }
      auth.accessToken = 'new-access'
      auth.refreshToken = 'new-refresh'
      finish(new Response(null, { status }))
      expect(await changing).toBeInstanceOf(Error)
      expect(auth.user.id).toBe('second')
      expect(auth.accessToken).toBe('new-access')
      expect(fetch).toHaveBeenCalledOnce()
    },
  )

  it('does not clear a newly established session for the same account after explicit logout', async () => {
    const auth = signedIn()
    let finish!: (response: Response) => void
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation((url) =>
        String(url).endsWith('/auth/logout')
          ? Promise.resolve(new Response(null, { status: 204 }))
          : new Promise((resolve) => {
              finish = resolve
            }),
      ),
    )
    const changing = auth.changePassword(values).catch((error: unknown) => error)
    await auth.logout()
    auth.user = { id: 'first', email: null, display_name: '学员', is_active: true }
    auth.accessToken = 'same-user-new-access'
    auth.refreshToken = 'same-user-new-refresh'
    finish(new Response(null, { status: 204 }))
    expect(await changing).toBeInstanceOf(Error)
    expect(auth.accessToken).toBe('same-user-new-access')
  })
})
