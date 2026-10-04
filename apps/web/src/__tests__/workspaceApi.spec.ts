import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getWorkspaceReports, getWorkspaceOverview } from '../services/workspaceApi'
import { useAccessStore } from '../stores/access'

describe('workspace API', () => {
  beforeEach(() => {
    sessionStorage.clear()
    sessionStorage.setItem(
      'zhijian-auth-session',
      JSON.stringify({ accessToken: 'token', refreshToken: 'refresh' }),
    )
    setActivePinia(createPinia())
  })
  afterEach(() => vi.unstubAllGlobals())
  it('does not hide owned historical records behind the new platform organization', async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(async () => new Response('{}'))
    vi.stubGlobal('fetch', request)
    useAccessStore().singlePlatform = true
    await getWorkspaceReports({ organization_id: 'platform', limit: 12 })
    await getWorkspaceOverview('platform')
    for (const call of request.mock.calls)
      expect(new URL(String(call[0])).searchParams.has('organization_id')).toBe(false)
  })

  it('encodes organization and filters without adding empty filters', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response('{"items":[],"total":0,"limit":12,"offset":0}', { status: 200 }),
      )
    vi.stubGlobal('fetch', request)
    await getWorkspaceReports({
      organization_id: 'org 1',
      mode: 'standard',
      scenario: '',
      status: '',
      limit: 12,
      offset: 0,
    })
    const url = new URL(String(request.mock.calls[0]![0]))
    expect(url.searchParams.get('organization_id')).toBe('org 1')
    expect(url.searchParams.get('mode')).toBe('standard')
    expect(url.searchParams.has('scenario')).toBe(false)
    expect(url.searchParams.has('status')).toBe(false)
  })

  it('preserves server errors rather than manufacturing an empty successful overview', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response('{"detail":"当前组织不可访问"}', { status: 403 })),
    )
    await expect(getWorkspaceOverview('org-1')).rejects.toThrow('当前组织不可访问')
  })
})
