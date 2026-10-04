export function hasRouteAccess(capabilities: unknown, can: (capability: string) => boolean) {
  return (
    !Array.isArray(capabilities) ||
    capabilities.length === 0 ||
    capabilities.some((value) => typeof value === 'string' && can(value))
  )
}
