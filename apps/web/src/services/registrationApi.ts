import type { CurrentUser } from '../stores/auth'
import { apiUrl, ApiError, requireJson } from './apiClient'

export type RegistrationInput = {
  username: string
  password: string
  display_name: string
  email?: string
}

export async function registerLearner(input: RegistrationInput): Promise<CurrentUser> {
  const response = await fetch(apiUrl('/auth/register'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const messages: Record<number, string> = {
    409: '用户名或邮箱已被使用。请换一个，或返回登录。',
    422: '注册信息格式不符合要求，请检查用户名、密码和邮箱。',
    429: '注册请求过于频繁，请稍后再试。',
    503: '注册服务暂不可用，请稍后再试。',
  }
  if (messages[response.status]) throw new ApiError(messages[response.status]!, response.status)
  return requireJson<CurrentUser>(response, '注册未完成，请检查连接后重试。')
}
