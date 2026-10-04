import { computed, ref } from 'vue'
import { useAccessStore } from '../stores/access'

/** Bridge existing pages to the server-backed shell scope without changing their API contracts. */
export function useOrganizationScope() {
  const access = useAccessStore()
  const local = ref('')
  const organizationId = computed({
    get: () => {
      if (access.error) return ''
      return access.ready || access.loading ? access.organizationId : local.value
    },
    set: (id: string) => {
      if (access.error) return
      if (access.ready) {
        if (id !== access.organizationId) void access.selectOrganization(id)
      } else local.value = id
    },
  })
  function initialOrganization(rows: Array<{ id: string }>) {
    if (access.error) return ''
    if (access.ready || access.loading)
      return rows.some((row) => row.id === access.organizationId) ? access.organizationId : ''
    return rows[0]?.id ?? ''
  }
  return { organizationId, initialOrganization }
}
