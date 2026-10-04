import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { requireJson } from '../services/apiClient'
import { useAuthStore } from './auth'

export type AccessOrganization = {
  id: string
  name: string
  role: string
  capabilities: string[]
  can_participate_assessment?: boolean
}
export type AccessContext = { organizations: AccessOrganization[]; global_capabilities: string[]; single_platform_enabled?: boolean }

export const useAccessStore = defineStore('access', () => {
  const auth = useAuthStore()
  const organizations = ref<AccessOrganization[]>([])
  const globalCapabilities = ref<string[]>([])
  const organizationId = ref('')
  const singlePlatform = ref(false)
  const ready = ref(false)
  const loading = ref(false)
  const error = ref('')
  const organization = computed(() =>
    organizations.value.find((row) => row.id === organizationId.value),
  )
  let generation = 0
  let flight: Promise<void> | null = null

  function clear() {
    generation += 1
    organizations.value = []
    globalCapabilities.value = []
    organizationId.value = ''
    singlePlatform.value = false
    ready.value = false
    loading.value = false
    error.value = ''
    flight = null
  }
  function can(capability: string) {
    return (
      ready.value &&
      (globalCapabilities.value.includes(capability) ||
        Boolean(organization.value?.capabilities.includes(capability)))
    )
  }
  async function load(force = false) {
    // A token exists before /auth/me finishes. Do not publish organization scope
    // for an unknown identity while the login form is still awaiting completion.
    if (!auth.isAuthenticated || !auth.user?.id) {
      clear()
      return
    }
    if (flight && !force) return flight
    if (ready.value && !force) return
    const ticket = ++generation
    const actor = auth.user?.id
    ready.value = false
    loading.value = true
    error.value = ''
    const job = (async () => {
      try {
        const response = await auth.request('/workspace/access')
        const data = await requireJson<AccessContext>(response, '无法读取访问权限，请重试。')
        if (ticket !== generation || actor !== auth.user?.id || !auth.isAuthenticated) return
        organizations.value = data.organizations
        globalCapabilities.value = data.global_capabilities
        singlePlatform.value = data.single_platform_enabled === true
        if (!data.organizations.some((row) => row.id === organizationId.value))
          organizationId.value = data.organizations[0]?.id ?? ''
        ready.value = true
      } catch (caught) {
        if (ticket !== generation) return
        organizations.value = []
        globalCapabilities.value = []
        organizationId.value = ''
        singlePlatform.value = false
        error.value = caught instanceof Error ? caught.message : '权限读取失败。'
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
  async function selectOrganization(id: string) {
    if (singlePlatform.value && id !== organizationId.value) return
    if (!organizations.value.some((row) => row.id === id)) return
    organizationId.value = id
    await load(true)
  }
  watch(
    () => auth.user?.id,
    (next, previous) => {
      if (next !== previous) clear()
    },
    { flush: 'sync' },
  )
  watch(
    () => auth.isAuthenticated,
    (value) => {
      if (!value) clear()
    },
    { flush: 'sync' },
  )
  return {
    organizations,
    globalCapabilities,
    organizationId,
    singlePlatform,
    organization,
    ready,
    loading,
    error,
    can,
    load,
    clear,
    selectOrganization,
  }
})
