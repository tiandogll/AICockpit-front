import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { useAuthStore } from '../stores/auth'
import {
  createAssignedVersion,
  getAssignedItem,
  listAssignedItems,
  listAssignedRubrics,
  listItemAssignments,
  setItemAssignment,
  submitAssignedItem,
} from '../services/authoringApi'

describe('assigned content API', () => {
  let request: MockInstance<ReturnType<typeof useAuthStore>['request']>
  beforeEach(() => {
    setActivePinia(createPinia())
    request = vi.spyOn(useAuthStore(), 'request').mockImplementation(async () => new Response('{}'))
  })
  afterEach(() => vi.restoreAllMocks())
  it('uses only teacher read endpoints for assigned items and their own related rubrics', async () => {
    await listAssignedItems('draft', 20)
    await getAssignedItem('item/one')
    await listAssignedRubrics('item/one', 40)
    expect(request.mock.calls.map((call) => call[0])).toEqual([
      '/teacher/items/details?limit=20&offset=20&publication_status=draft',
      '/teacher/items/item%2Fone',
      '/teacher/items/item%2Fone/rubrics?limit=20&offset=40',
    ])
  })
  it('removes logical_id from successor writes and preserves caller retry keys', async () => {
    const body = {
      logical_id: 'never-send',
      dimension_code: 'evaluation',
      item_type: 'objective' as const,
      difficulty: 0,
      stem: '核验来源',
      configuration: {},
      answer_key: null,
      rubric_version_id: null,
    }
    await createAssignedVersion('source-id', body, 'stable-attempt-123')
    await createAssignedVersion('source-id', body, 'stable-attempt-123')
    await submitAssignedItem('new-id', 'stable-submit-123')
    expect(request.mock.calls[0]?.[0]).toBe('/teacher/items/source-id/versions')
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).not.toHaveProperty('logical_id')
    for (const call of request.mock.calls.slice(0, 2)) {
      expect(new Headers(call[1]?.headers).get('Idempotency-Key')).toBe('stable-attempt-123')
    }
    expect(request.mock.calls[2]).toEqual([
      '/teacher/items/new-id/submit',
      expect.objectContaining({ method: 'POST' }),
    ])
    expect(request.mock.calls[2]?.[1]?.body).toBeUndefined()
  })
  it('uses explicit existing-user assignment PUT and does not invite or grant global roles', async () => {
    await listItemAssignments('item-id')
    await setItemAssignment('item-id', 'user-id', false, 'stable-revoke-123')
    expect(request.mock.calls[0]?.[0]).toBe('/admin/items/item-id/assignments')
    expect(request.mock.calls[1]).toEqual([
      '/admin/items/item-id/assignments/user-id',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ active: false }),
      }),
    ])
    expect(new Headers(request.mock.calls[1]?.[1]?.headers).get('Idempotency-Key')).toBe(
      'stable-revoke-123',
    )
  })
  it('rejects missing keys before making a write and surfaces permission errors', async () => {
    await expect(submitAssignedItem('item-id', '')).rejects.toThrow('重试标识')
    expect(request).not.toHaveBeenCalled()
    request.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: '指派已撤销' }), { status: 403 }),
    )
    await expect(getAssignedItem('item-id')).rejects.toThrow('指派已撤销')
  })
})
