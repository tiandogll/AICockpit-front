import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAccessStore } from '../stores/access'
import { useOrganizationScope } from '../domain/organizationScope'
describe('legacy workflow organization adapter', () => {
  beforeEach(() => {
    sessionStorage.clear()
    setActivePinia(createPinia())
  })
  it('prefers the shell organization and never falls back to a different tenant', () => {
    const access = useAccessStore()
    access.ready = true
    access.organizationId = 'B'
    const scope = useOrganizationScope()
    expect(scope.initialOrganization([{ id: 'A' }, { id: 'B' }])).toBe('B')
    expect(scope.organizationId.value).toBe('B')
    expect(scope.initialOrganization([{ id: 'A' }])).toBe('')
  })
  it('local selection reloads the same server-backed access context', () => {
    const access = useAccessStore()
    access.ready = true
    access.organizationId = 'A'
    const select = vi.spyOn(access, 'selectOrganization').mockResolvedValue(undefined)
    const scope = useOrganizationScope()
    scope.organizationId.value = 'B'
    expect(select).toHaveBeenCalledWith('B')
  })

  it('preserves local defaults only while the access store is untouched and has no error', () => {
    const scope = useOrganizationScope()
    expect(scope.organizationId.value).toBe('')
    expect(scope.initialOrganization([{ id: 'A' }, { id: 'B' }])).toBe('A')
    scope.organizationId.value = 'B'
    expect(scope.organizationId.value).toBe('B')
  })

  it('fails closed after a permission refresh fails instead of restoring local scope', () => {
    const access = useAccessStore()
    const scope = useOrganizationScope()
    scope.organizationId.value = 'A'
    access.ready = false
    access.loading = false
    access.error = '权限刷新暂不可用'

    expect(scope.organizationId.value).toBe('')
    expect(scope.initialOrganization([{ id: 'A' }, { id: 'B' }])).toBe('')
  })

  it('does not accept local selections or invoke access selection while access has failed', () => {
    const access = useAccessStore()
    const scope = useOrganizationScope()
    const select = vi.spyOn(access, 'selectOrganization').mockResolvedValue(undefined)
    access.error = '权限读取失败'
    scope.organizationId.value = 'B'
    expect(scope.organizationId.value).toBe('')
    expect(select).not.toHaveBeenCalled()

    access.error = ''
    expect(scope.organizationId.value).toBe('')
  })

  it('does not choose the first row after remounting with a failed access context', () => {
    const access = useAccessStore()
    access.error = '无法读取访问权限，请重试。'
    const remountedScope = useOrganizationScope()
    remountedScope.organizationId.value = remountedScope.initialOrganization([{ id: 'A' }])
    expect(remountedScope.organizationId.value).toBe('')
  })

  it('prioritizes an access error over a stale ready flag or selected organization', () => {
    const access = useAccessStore()
    access.ready = true
    access.organizationId = 'B'
    access.error = '权限刷新失败'
    const select = vi.spyOn(access, 'selectOrganization').mockResolvedValue(undefined)
    const scope = useOrganizationScope()
    expect(scope.organizationId.value).toBe('')
    expect(scope.initialOrganization([{ id: 'B' }])).toBe('')
    scope.organizationId.value = 'A'
    expect(select).not.toHaveBeenCalled()
  })
})
