export const API_BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ??
  (import.meta.env.PROD ? `${window.location.origin}/api/v1` : 'http://localhost:18000/api/v1')

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export function apiUrl(path: string) {
  return `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`
}

export async function responseError(response: Response, fallback: string) {
  let message = fallback
  try {
    const payload = (await response.json()) as {
      detail?: string | { message?: string } | Array<{ msg?: string }>
    }
    if (typeof payload.detail === 'string') message = payload.detail
    else if (Array.isArray(payload.detail)) {
      message = payload.detail.map((entry) => entry.msg).filter(Boolean).join('；') || fallback
    } else if (payload.detail?.message) message = payload.detail.message
  } catch {
    // Preserve the safe caller-provided fallback for non-JSON failures.
  }
  return new ApiError(message, response.status)
}

export async function requireJson<T>(response: Response, fallback: string): Promise<T> {
  if (!response.ok) throw await responseError(response, fallback)
  return (await response.json()) as T
}
