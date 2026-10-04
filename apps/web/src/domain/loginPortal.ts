import type { AccessOrganization } from '../stores/access'

type StaffAccess = {
  ready: boolean
  error: string
  organizationId: string
  organizations: AccessOrganization[]
  globalCapabilities: string[]
  singlePlatform?: boolean
}
export const STAFF_CAPABILITIES = [
  'content',
  'content_author',
  'analytics',
  'reviews',
  'members',
  'system',
  'governance',
  'pilots_manage',
  'cat',
]
const managementRoutes = [
  { path: '/teaching', capabilities: STAFF_CAPABILITIES },
  { path: '/item-bank', capabilities: ['content'] },
  { path: '/authoring', capabilities: ['content_author'] },
  { path: '/analytics', capabilities: ['analytics'] },
  { path: '/reviews', capabilities: ['reviews'] },
  { path: '/members', capabilities: ['members'] },
  { path: '/system', capabilities: ['system', 'governance'] },
  { path: '/pilot-lab', capabilities: ['pilots_manage'] },
  { path: '/cat-lab', capabilities: ['cat'] },
  { path: '/workbench', capabilities: ['system'] },
]

export function safeRedirect(value: string | undefined) {
  if (
    !value ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    [...value].some((character) => character.charCodeAt(0) <= 0x20)
  )
    return '/workspace'
  try {
    const path = decodeURIComponent(new URL(value, 'https://local.invalid').pathname)
    if (
      path.startsWith('//') ||
      path.includes('\\') ||
      [...path].some((character) => character.charCodeAt(0) <= 0x20) ||
      /^\/(?:login|register|staff\/login)\/*$/i.test(path)
    )
      return '/workspace'
  } catch {
    return '/workspace'
  }
  return value
}

export function loginRouteName(capabilities: unknown) {
  return Array.isArray(capabilities) && capabilities.some((value) => typeof value === 'string')
    ? 'staff-login'
    : 'login'
}

export function staffDestination(
  access: StaffAccess,
  requested?: string,
): { path: string; organizationId: string } | null {
  if (!access.ready || access.error) return null
  if (access.singlePlatform && !access.globalCapabilities.includes('system')) return null
  const organizations = [...access.organizations].sort(
    (a, b) => Number(b.id === access.organizationId) - Number(a.id === access.organizationId),
  )
  const forRoute = (route: (typeof managementRoutes)[number], path = route.path) => {
    if (route.path === '/teaching') {
      const organization = organizations.find((entry) =>
        STAFF_CAPABILITIES.some((capability) => entry.capabilities.includes(capability)),
      )
      if (organization) return { path, organizationId: organization.id }
    }
    if (access.singlePlatform && route.path === '/authoring')
      return access.globalCapabilities.includes('content')
        ? { path: '/item-bank', organizationId: access.organizationId }
        : null
    if (route.capabilities.some((capability) => access.globalCapabilities.includes(capability)))
      return { path, organizationId: access.organizationId }
    const organization = organizations.find((entry) =>
      route.capabilities.some((capability) => entry.capabilities.includes(capability)),
    )
    return organization ? { path, organizationId: organization.id } : null
  }
  const safe = safeRedirect(requested)
  const requestedRoute = managementRoutes.find(
    (route) => route.path === new URL(safe, 'https://local.invalid').pathname,
  )
  if (requestedRoute) {
    const destination = forRoute(requestedRoute, safe)
    if (destination) return destination
  }
  for (const route of managementRoutes) {
    const destination = forRoute(route)
    if (destination) return destination
  }
  return null
}
