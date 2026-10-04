import { computed, onScopeDispose, ref, watch } from 'vue'
import { ApiError, operationKey } from '../services/assessmentApi'
import { getAssessmentDraft, putAssessmentDraft } from '../services/assessmentWorkspaceApi'

export type SaveState =
  'loading' | 'unsaved' | 'saving' | 'saved' | 'error' | 'conflict' | 'submitted'
export function useAssessmentDraft(options: {
  sessionId: () => string
  itemId: () => string
  contextRevision: () => number
  response: () => Record<string, unknown>
  restore: (response: Record<string, unknown>) => void
}) {
  const state = ref<SaveState>('loading'),
    savedAt = ref<string | null>(null)
  const dirty = ref(false),
    error = ref(''),
    ready = ref(false),
    canEdit = ref(false)
  const revision = ref(0)
  let baseline = '',
    epoch = 0,
    suppress = false
  let timer: ReturnType<typeof setTimeout> | undefined,
    maxTimer: ReturnType<typeof setTimeout> | undefined
  let flight: Promise<boolean> | null = null,
    retry: { fingerprint: string; key: string } | null = null
  const serialized = computed(() => JSON.stringify(options.response()))
  const context = () => `${options.sessionId()}:${options.itemId()}:${options.contextRevision()}`
  const clearTimers = () => {
    clearTimeout(timer)
    clearTimeout(maxTimer)
    timer = undefined
    maxTimer = undefined
  }
  const label = computed(
    () =>
      ({
        loading: '正在恢复草稿',
        unsaved: '尚未保存',
        saving: '正在保存',
        saved: '草稿已保存',
        error: '保存失败',
        conflict: '草稿版本冲突',
        submitted: '回答已提交',
      })[state.value],
  )

  async function load() {
    const ticket = ++epoch,
      identity = context()
    clearTimers()
    ready.value = false
    canEdit.value = false
    state.value = 'loading'
    error.value = ''
    try {
      const value = await getAssessmentDraft(options.sessionId(), options.itemId())
      if (ticket !== epoch || identity !== context()) return
      if (value.context_revision !== options.contextRevision())
        throw new Error('对话轮次已改变，请重新加载当前问题。')
      suppress = true
      if (value.draft) options.restore(value.draft.response)
      baseline = serialized.value
      suppress = false
      revision.value = value.draft?.revision ?? 0
      savedAt.value = value.draft?.saved_at ?? null
      canEdit.value = value.can_edit
      ready.value = true
      dirty.value = false
      retry = null
      state.value = value.can_edit ? (value.draft ? 'saved' : 'unsaved') : 'submitted'
    } catch (cause) {
      if (ticket !== epoch) return
      state.value = 'error'
      error.value = cause instanceof Error ? cause.message : '草稿恢复失败。'
    } finally {
      suppress = false
    }
  }
  async function saveOnce(): Promise<boolean> {
    if (!dirty.value) return ready.value
    if (!ready.value || !canEdit.value || state.value === 'conflict') return false
    const identity = context(),
      ticket = epoch,
      content = serialized.value
    const value = {
      response: JSON.parse(content) as Record<string, unknown>,
      revision: revision.value,
      context_revision: options.contextRevision(),
    }
    const fingerprint = JSON.stringify(value)
    if (retry?.fingerprint !== fingerprint)
      retry = { fingerprint, key: operationKey('assessment-draft') }
    state.value = 'saving'
    error.value = ''
    try {
      const result = await putAssessmentDraft(
        options.sessionId(),
        options.itemId(),
        value,
        retry.key,
      )
      if (ticket !== epoch || identity !== context()) return false
      if (!result.draft || result.context_revision !== options.contextRevision())
        throw new Error('保存回执不完整，请刷新确认。')
      revision.value = result.draft.revision
      savedAt.value = result.draft.saved_at
      baseline = content
      retry = null
      dirty.value = serialized.value !== baseline
      canEdit.value = result.can_edit
      state.value = !result.can_edit ? 'submitted' : dirty.value ? 'unsaved' : 'saved'
      return true
    } catch (cause) {
      if (ticket !== epoch) return false
      state.value = cause instanceof ApiError && cause.status === 409 ? 'conflict' : 'error'
      error.value =
        state.value === 'conflict'
          ? '另一标签页或轮次已更新。当前文字仍在此页，请复制后重新加载；不会自动覆盖。'
          : cause instanceof Error
            ? cause.message
            : '保存失败，请重试。'
      return false
    }
  }
  async function flush(): Promise<boolean> {
    clearTimers()
    if (flight) return flight
    const job = (async () => {
      while (dirty.value) {
        if (!(await saveOnce())) return false
      }
      return ready.value
    })()
    flight = job
    try {
      return await job
    } finally {
      if (flight === job) flight = null
    }
  }
  function markSubmitted() {
    ++epoch
    clearTimers()
    dirty.value = false
    canEdit.value = false
    baseline = serialized.value
    state.value = 'submitted'
    retry = null
  }
  watch(
    serialized,
    (value) => {
      if (suppress || !ready.value || !canEdit.value) return
      dirty.value = value !== baseline
      if (!dirty.value) return
      if (state.value !== 'conflict') state.value = 'unsaved'
      clearTimeout(timer)
      timer = setTimeout(() => {
        void flush()
      }, 800)
      maxTimer ??= setTimeout(() => {
        void flush()
      }, 3000)
    },
    { flush: 'sync' },
  )
  onScopeDispose(() => {
    ++epoch
    clearTimers()
  })
  return { state, label, savedAt, dirty, error, ready, canEdit, load, flush, markSubmitted }
}
