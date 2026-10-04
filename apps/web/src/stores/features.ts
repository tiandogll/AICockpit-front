import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { requireJson } from '../services/apiClient'
import { useAuthStore } from './auth'

type RuntimeFeatures = {
  training_enabled: boolean
  training_content_status: 'formative_preview'
  growth_guide_mode: 'local_guidance' | 'deepseek'
  attachments_enabled: boolean
  assessment_in_progress?: boolean
}

export const useFeatureStore = defineStore('features', () => {
  const auth = useAuthStore()
  const data = ref<RuntimeFeatures | null>(null)
  const ready = ref(false)
  const loading = ref(false)
  const error = ref('')
  const trainingEnabled = computed(() => ready.value && data.value?.training_enabled === true)
  // Keep the last verified selection while refreshing the same identity. Consumers
  // must still require `ready` before acting; a refresh must not erase a conversation.
  const growthGuideMode = computed(() =>
    data.value?.growth_guide_mode === 'deepseek' ? 'deepseek' : 'local_guidance',
  )
  const attachmentsEnabled = computed(() => ready.value && data.value?.attachments_enabled === true)
  const assessmentInProgress = computed(() => data.value?.assessment_in_progress === true)
  let generation = 0
  let flight: Promise<void> | null = null

  function clear() {
    generation += 1
    data.value = null
    ready.value = false
    loading.value = false
    error.value = ''
    flight = null
  }
  async function load(force = false) {
    if (!auth.isAuthenticated || !auth.user?.id) {
      clear()
      return
    }
    if (flight) return flight
    if (ready.value && !force) return
    const ticket = ++generation
    const actor = auth.user?.id
    ready.value = false
    loading.value = true
    error.value = ''
    const job = (async () => {
      try {
        const response = await auth.request('/workspace/features')
        const value = await requireJson<Partial<RuntimeFeatures> | null>(
          response,
          '无法确认服务状态，请重试。',
        )
        if (
          !value ||
          typeof value.training_enabled !== 'boolean' ||
          value.training_content_status !== 'formative_preview' ||
          !['local_guidance', 'deepseek'].includes(String(value.growth_guide_mode)) ||
          typeof value.attachments_enabled !== 'boolean' ||
          (value.assessment_in_progress !== undefined &&
            typeof value.assessment_in_progress !== 'boolean')
        )
          throw new Error('服务状态格式不受支持，请刷新页面或联系管理员。')
        if (ticket !== generation || actor !== auth.user?.id || !auth.isAuthenticated) return
        data.value = value as RuntimeFeatures
        ready.value = true
      } catch (cause) {
        if (ticket === generation)
          error.value = cause instanceof Error ? cause.message : '无法确认服务状态，请重试。'
      } finally {
        if (ticket === generation) {
          loading.value = false
          flight = null
        }
      }
    })()
    flight = job
    return job
  }
  watch(
    () => [auth.user?.id, auth.isAuthenticated] as const,
    ([actor, authenticated], [previousActor, previouslyAuthenticated]) => {
      if (actor === previousActor && authenticated === previouslyAuthenticated) return
      clear()
      // Tokens become available before /auth/me, both on login and on refresh.
      // Reload after identity hydration instead of leaving an invalidated read idle.
      if (actor && authenticated) void load()
    },
    { flush: 'sync' },
  )
  return {
    ready,
    loading,
    error,
    trainingEnabled,
    growthGuideMode,
    attachmentsEnabled,
    assessmentInProgress,
    load,
    clear,
  }
})
