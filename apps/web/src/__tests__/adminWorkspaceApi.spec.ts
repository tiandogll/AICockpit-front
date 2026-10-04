import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addOrganizationMember,
  assignCohortMember,
  executeRetention,
  listOrganizationMembers,
  readProviderHealth,
} from '../services/adminWorkspaceApi'

describe('admin workspace API', () => {
  beforeEach(() => {
    sessionStorage.clear()
    sessionStorage.setItem(
      'zhijian-auth-session',
      JSON.stringify({ accessToken: 'token', refreshToken: 'refresh' }),
    )
    setActivePinia(createPinia())
  })
  afterEach(() => vi.unstubAllGlobals())
  it('uses authenticated existing member and cohort endpoints', async () => {
    const request = vi.fn<typeof fetch>(async () => new Response('{}'))
    vi.stubGlobal('fetch', request)
    await addOrganizationMember('org-1', 'user-1', 'learner')
    expect(request.mock.calls[0]?.[0]).toContain('/organizations/org-1/members')
    expect(request.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ user_id: 'user-1', role: 'learner' }),
      headers: { Authorization: 'Bearer token' },
    })
    await assignCohortMember('org-1', 'cohort-1', 'user-1', 'same-attempt')
    expect(request.mock.calls[1]?.[0]).toContain(
      '/organizations/org-1/cohorts/cohort-1/members/user-1',
    )
    expect(request.mock.calls[1]?.[1]).toMatchObject({
      method: 'PUT',
      headers: { 'Idempotency-Key': 'same-attempt' },
    })
  })
  it('retains caller supplied privacy retry key and sends no invented cutoff body', async () => {
    const request = vi.fn<typeof fetch>(async () => new Response('{}'))
    vi.stubGlobal('fetch', request)
    await executeRetention('org-1', 'stable-private-run-key')
    await executeRetention('org-1', 'stable-private-run-key')
    for (const [path, init] of request.mock.calls) {
      expect(path).toContain('/admin/organizations/org-1/privacy-runs')
      expect(init).toMatchObject({
        method: 'POST',
        headers: { 'Idempotency-Key': 'stable-private-run-key' },
      })
      expect(init?.body).toBeUndefined()
    }
  })
  it('rejects absent organization scope and permits global provider health without one', async () => {
    const request = vi.fn<typeof fetch>(async () => new Response('{}'))
    vi.stubGlobal('fetch', request)
    await expect(listOrganizationMembers('')).rejects.toThrow('组织')
    expect(request).not.toHaveBeenCalled()
    await readProviderHealth()
    expect(request.mock.calls[0]?.[0]).toContain('/ai/providers/health')
  })
})
