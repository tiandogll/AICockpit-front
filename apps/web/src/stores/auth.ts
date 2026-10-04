import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { ApiError, apiUrl, requireJson, responseError } from '../services/apiClient'

const STORAGE_KEY = 'zhijian-auth-session'
export const AUTH_EXPIRED_EVENT = 'zhijian:auth-expired'

type TokenPair = {
  access_token: string
  refresh_token: string
  token_type: string
}

export type CurrentUser = {
  id: string
  username?: string | null
  email: string | null
  display_name: string
  affiliation?: string | null
  specialty?: string | null
  learning_goal?: string | null
  created_at?: string | null
  is_active: boolean
  password_change_available?: boolean
}

export type ProfileUpdate = Pick<
  CurrentUser,
  'display_name' | 'affiliation' | 'specialty' | 'learning_goal'
>

export type PasswordChange = {
  current_password: string
  new_password: string
  confirm_password: string
}

type StoredSession = {
  accessToken: string
  refreshToken: string
}

function restoredSession(): StoredSession {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<StoredSession>
    if (typeof parsed.accessToken === 'string' && typeof parsed.refreshToken === 'string') {
      return { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken }
    }
  } catch {
    sessionStorage.removeItem(STORAGE_KEY)
  }
  return { accessToken: '', refreshToken: '' }
}

let refreshFlight: Promise<void> | null = null

// A fetch timeout alone does not bound a shared refresh or response decoding.
// Attach both handlers so an abandoned operation cannot surface an unhandled rejection.
function withinSignal<T>(operation: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return operation
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    const cleanup = () => signal.removeEventListener('abort', abort)
    signal.addEventListener('abort', abort, { once: true })
    operation.then(
      (result) => {
        cleanup()
        resolve(result)
      },
      (cause: unknown) => {
        cleanup()
        reject(cause)
      },
    )
    if (signal.aborted) {
      cleanup()
      abort()
    }
  })
}

export const useAuthStore = defineStore('auth', () => {
  const restored = restoredSession()
  const accessToken = ref(restored.accessToken)
  const refreshToken = ref(restored.refreshToken)
  const user = ref<CurrentUser | null>(null)
  const initialized = ref(false)
  let sessionGeneration = 0
  const isAuthenticated = computed(() => Boolean(accessToken.value && refreshToken.value))

  function persist() {
    if (!accessToken.value || !refreshToken.value) {
      sessionStorage.removeItem(STORAGE_KEY)
      return
    }
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ accessToken: accessToken.value, refreshToken: refreshToken.value }),
    )
  }

  function applyTokens(pair: TokenPair) {
    accessToken.value = pair.access_token
    refreshToken.value = pair.refresh_token
    persist()
  }

  function clear(notifyExpiration = false) {
    sessionGeneration += 1
    refreshFlight = null
    accessToken.value = ''
    refreshToken.value = ''
    user.value = null
    initialized.value = true
    sessionStorage.removeItem(STORAGE_KEY)
    if (notifyExpiration) window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT))
  }

  async function rotate() {
    if (!refreshToken.value) throw new Error('登录状态已失效，请重新登录。')
    const token = refreshToken.value
    const generation = sessionGeneration
    if (!refreshFlight) {
      const flight = (async () => {
        const signal = AbortSignal.timeout(15_000)
        const response = await withinSignal(
          fetch(apiUrl('/auth/refresh'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: token }),
            signal,
          }),
          signal,
        )
        if (!response.ok)
          throw await withinSignal(responseError(response, '登录状态已失效，请重新登录。'), signal)
        const pair = (await withinSignal(response.json(), signal)) as TokenPair
        if (generation !== sessionGeneration || refreshToken.value !== token) {
          throw new Error('stale refresh response')
        }
        applyTokens(pair)
      })()
      refreshFlight = flight
      void flight.then(
        () => {
          if (refreshFlight === flight) refreshFlight = null
        },
        () => {
          if (refreshFlight === flight) refreshFlight = null
        },
      )
    }
    const flight = refreshFlight
    try {
      await flight
    } catch {
      if (generation === sessionGeneration && refreshToken.value === token) clear(true)
      throw new Error('登录状态已失效，请重新登录。')
    }
  }

  async function request(path: string, init: RequestInit = {}) {
    if (!accessToken.value) throw new Error('登录状态已失效，请重新登录。')
    const generation = sessionGeneration
    const actor = user.value?.id
    const ensureSameSession = () => {
      if (generation !== sessionGeneration || actor !== user.value?.id)
        throw new Error('账号已切换，请重新操作。')
    }
    const send = () =>
      fetch(apiUrl(path), {
        ...init,
        headers: {
          ...(init.headers as Record<string, string> | undefined),
          Authorization: `Bearer ${accessToken.value}`,
        },
      })
    let response = await send()
    if (response.status !== 401) return response
    ensureSameSession()
    init.signal?.throwIfAborted()
    await withinSignal(rotate(), init.signal)
    ensureSameSession()
    init.signal?.throwIfAborted()
    response = await send()
    ensureSameSession()
    init.signal?.throwIfAborted()
    if (response.status === 401) {
      clear(true)
      throw new Error('登录状态已失效，请重新登录。')
    }
    return response
  }

  async function loadCurrentUser() {
    const response = await request('/auth/me')
    user.value = await requireJson<CurrentUser>(response, '无法读取当前账号信息。')
    return user.value
  }

  async function login(identifier: string, password: string) {
    const response = await fetch(apiUrl('/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: identifier.trim(), password }),
    }).catch(() => {
      throw new Error('暂时无法连接登录服务，请检查网络或确认后端服务已启动。')
    })
    const loginErrors: Record<number, string> = {
      401: '用户名、邮箱或密码不正确，请重新输入。',
      422: '登录信息格式不正确，请检查账号和密码。',
      429: '登录尝试过于频繁，请稍后再试。',
    }
    if (loginErrors[response.status])
      throw new ApiError(loginErrors[response.status]!, response.status)
    if (response.status >= 500)
      throw new ApiError('登录服务暂不可用，请稍后再试。', response.status)
    const pair = await requireJson<TokenPair>(response, '登录未完成，请稍后重试。')
    // A fresh login is a new session even when it is for the same user ID.
    sessionGeneration += 1
    refreshFlight = null
    applyTokens(pair)
    try {
      await loadCurrentUser()
      initialized.value = true
    } catch (error) {
      clear()
      throw error
    }
  }

  async function updateProfile(profile: ProfileUpdate) {
    const actor = user.value?.id
    const generation = sessionGeneration
    if (!actor) throw new Error('请重新登录后修改资料。')
    const response = await request('/auth/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        display_name: profile.display_name.trim(),
        affiliation: profile.affiliation?.trim() || null,
        specialty: profile.specialty?.trim() || null,
        learning_goal: profile.learning_goal?.trim() || null,
      }),
    })
    const updated = await requireJson<CurrentUser>(response, '个人资料保存失败，请稍后重试。')
    if (generation !== sessionGeneration || user.value?.id !== actor || updated.id !== actor)
      throw new Error('账号已切换，请重新打开个人资料。')
    user.value = updated
  }

  async function changePassword(passwords: PasswordChange) {
    const actor = user.value?.id
    const generation = sessionGeneration
    if (!actor) throw new Error('请重新登录后修改密码。')
    if (user.value?.password_change_available !== true)
      throw new Error('当前服务尚未开放修改密码，请更新后端后再试。')
    const ensureSameSession = () => {
      if (generation !== sessionGeneration || user.value?.id !== actor)
        throw new Error('账号已切换，请重新打开账号安全。')
    }
    let response: Response
    try {
      const signal = AbortSignal.timeout(20_000)
      response = await withinSignal(
        request('/auth/change-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(passwords),
          signal,
        }),
        signal,
      )
    } catch (cause) {
      ensureSameSession()
      if (
        cause instanceof TypeError ||
        (cause instanceof DOMException && ['AbortError', 'TimeoutError'].includes(cause.name))
      )
        throw new Error(
          '连接中断，无法确认密码是否已修改。请重新登录并先尝试新密码，不要连续重复提交。',
        )
      throw cause
    }
    ensureSameSession()
    const messages: Record<number, string> = {
      400: '当前密码不正确，请重新输入。',
      409: '账号安全信息已变化，请重新登录后再试。',
      422: '新密码须为 8–256 个字符，两次输入须一致，且不能与当前密码相同。',
      429: '修改密码尝试过于频繁，请稍后再试。',
    }
    if (messages[response.status]) throw new ApiError(messages[response.status]!, response.status)
    if (response.status >= 500)
      throw new ApiError('账号安全服务暂不可用，请稍后再试。', response.status)
    if (response.status !== 204)
      throw new ApiError('密码修改未能确认，请重新登录后检查。', response.status)
    // Server has committed the password and invalidated every old session.
    // Do not make another revocation request, or clear a newly switched account.
    clear()
  }

  async function initialize() {
    if (initialized.value) return isAuthenticated.value
    if (!isAuthenticated.value) {
      initialized.value = true
      return false
    }
    try {
      await loadCurrentUser()
      initialized.value = true
      return true
    } catch {
      clear()
      return false
    }
  }

  async function logout() {
    const token = refreshToken.value
    clear()
    try {
      if (token) {
        await fetch(apiUrl('/auth/logout'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: token }),
        })
      }
    } catch {
      // Local logout is authoritative for this tab even when the API is offline.
    } finally {
      /* Local state was cleared before the revocation request to prevent token revival. */
    }
  }

  return {
    accessToken,
    refreshToken,
    user,
    initialized,
    isAuthenticated,
    request,
    login,
    updateProfile,
    changePassword,
    initialize,
    logout,
  }
})
