import { effectScope, ref } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAssessmentDraft } from '../composables/useAssessmentDraft'
import { getAssessmentDraft, putAssessmentDraft } from '../services/assessmentWorkspaceApi'
import { ApiError } from '../services/apiClient'

vi.mock('../services/assessmentWorkspaceApi', () => ({
  getAssessmentDraft: vi.fn(),
  putAssessmentDraft: vi.fn(),
}))
const empty = { draft: null, context_revision: 0, can_edit: true }
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})
describe('assessment server draft', () => {
  it('blocks stale revision retries without discarding local text', async () => {
    vi.mocked(getAssessmentDraft).mockResolvedValue(empty)
    vi.mocked(putAssessmentDraft).mockRejectedValue(new ApiError('newer revision', 409))
    const scope = effectScope(),
      response = ref({ content: '' })
    const draft = scope.run(() =>
      useAssessmentDraft({
        sessionId: () => 's',
        itemId: () => 'i',
        contextRevision: () => 0,
        response: () => response.value,
        restore: () => {},
      }),
    )!
    await draft.load()
    response.value.content = '本页的未同步文字'
    expect(await draft.flush()).toBe(false)
    expect(draft.state.value).toBe('conflict')
    response.value.content += '继续编辑'
    expect(await draft.flush()).toBe(false)
    expect(putAssessmentDraft).toHaveBeenCalledTimes(1)
    expect(response.value.content).toContain('继续编辑')
    scope.stop()
  })
  it('serializes overlapping flushes and persists edits made while a save is pending', async () => {
    vi.mocked(getAssessmentDraft).mockResolvedValue(empty)
    let release!: (value: Awaited<ReturnType<typeof putAssessmentDraft>>) => void
    vi.mocked(putAssessmentDraft)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve
          }),
      )
      .mockImplementationOnce(async (_s, _i, value) => ({
        ...empty,
        draft: { ...value, revision: 2, saved_at: '2026-09-15T08:00:02Z' },
      }))
    const scope = effectScope(),
      response = ref({ content: '' }),
      draft = scope.run(() =>
        useAssessmentDraft({
          sessionId: () => 's',
          itemId: () => 'i',
          contextRevision: () => 0,
          response: () => response.value,
          restore: () => {},
        }),
      )!
    await draft.load()
    response.value.content = '第一版'
    const first = draft.flush()
    response.value.content = '第二版'
    const second = draft.flush()
    expect(putAssessmentDraft).toHaveBeenCalledTimes(1)
    release({
      ...empty,
      draft: {
        response: { content: '第一版' },
        revision: 1,
        context_revision: 0,
        saved_at: '2026-09-15T08:00:01Z',
      },
    })
    expect(await first).toBe(true)
    expect(await second).toBe(true)
    expect(putAssessmentDraft).toHaveBeenCalledTimes(2)
    expect(vi.mocked(putAssessmentDraft).mock.calls[1]?.[2]).toMatchObject({
      revision: 1,
      response: { content: '第二版' },
    })
    expect(draft.dirty.value).toBe(false)
    scope.stop()
  })
  it('ignores a late save response after the answer is sealed', async () => {
    vi.mocked(getAssessmentDraft).mockResolvedValue(empty)
    let release!: (value: Awaited<ReturnType<typeof putAssessmentDraft>>) => void
    vi.mocked(putAssessmentDraft).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    const scope = effectScope(),
      response = ref({ content: '' }),
      draft = scope.run(() =>
        useAssessmentDraft({
          sessionId: () => 's',
          itemId: () => 'i',
          contextRevision: () => 0,
          response: () => response.value,
          restore: () => {},
        }),
      )!
    await draft.load()
    response.value.content = '已提交内容'
    const pending = draft.flush()
    draft.markSubmitted()
    release({
      ...empty,
      draft: {
        response: response.value,
        revision: 1,
        context_revision: 0,
        saved_at: '2026-09-15T08:00:01Z',
      },
    })
    await pending
    expect(draft.state.value).toBe('submitted')
    expect(draft.canEdit.value).toBe(false)
    scope.stop()
  })
  it('debounces edits and acknowledges only the server saved timestamp', async () => {
    vi.useFakeTimers()
    vi.mocked(getAssessmentDraft).mockResolvedValue(empty)
    vi.mocked(putAssessmentDraft).mockResolvedValue({
      ...empty,
      draft: {
        response: { content: '核验原始来源' },
        revision: 1,
        context_revision: 0,
        saved_at: '2026-09-15T08:00:00Z',
      },
    })
    const scope = effectScope(),
      response = ref({ content: '' })
    const draft = scope.run(() =>
      useAssessmentDraft({
        sessionId: () => 's',
        itemId: () => 'i',
        contextRevision: () => 0,
        response: () => response.value,
        restore: (value) => {
          response.value = { content: String(value.content ?? '') }
        },
      }),
    )!
    await draft.load()
    response.value = { content: '核验原始来源' }
    await flushPromises()
    expect(draft.dirty.value).toBe(true)
    expect(putAssessmentDraft).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(800)
    expect(putAssessmentDraft).toHaveBeenCalledTimes(1)
    expect(draft.savedAt.value).toBe('2026-09-15T08:00:00Z')
    expect(draft.dirty.value).toBe(false)
    scope.stop()
  })
  it('retains unsaved input and a stable retry key when saving fails', async () => {
    vi.mocked(getAssessmentDraft).mockResolvedValue(empty)
    vi.mocked(putAssessmentDraft).mockRejectedValue(new Error('网络中断'))
    const scope = effectScope(),
      response = ref({ content: '' })
    const draft = scope.run(() =>
      useAssessmentDraft({
        sessionId: () => 's',
        itemId: () => 'i',
        contextRevision: () => 0,
        response: () => response.value,
        restore: () => {},
      }),
    )!
    await draft.load()
    response.value = { content: '不能丢失' }
    await flushPromises()
    expect(await draft.flush()).toBe(false)
    expect(await draft.flush()).toBe(false)
    expect(vi.mocked(putAssessmentDraft).mock.calls[0]?.[3]).toBe(
      vi.mocked(putAssessmentDraft).mock.calls[1]?.[3],
    )
    expect(response.value.content).toBe('不能丢失')
    expect(draft.dirty.value).toBe(true)
    expect(draft.state.value).toBe('error')
    scope.stop()
  })
})
