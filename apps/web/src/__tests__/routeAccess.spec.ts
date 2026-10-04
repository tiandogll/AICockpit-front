import { describe, expect, it } from 'vitest'
import { hasRouteAccess } from '../domain/routeAccess'
import { navigationGroups } from '../domain/navigation'
describe('route capability gate', () => {
  it('shows assigned author tasks independently from the global content bank', () => {
    const paths = navigationGroups((cap) => cap === 'content_author').flatMap((group) =>
      group.items.map((item) => item.path),
    )
    expect(paths).toContain('/authoring')
    expect(paths).not.toContain('/item-bank')
    expect(
      navigationGroups(() => false).flatMap((group) => group.items.map((item) => item.path)),
    ).not.toContain('/authoring')
  })
  it('allows personal pages, but denies a restricted route without a server capability', () => {
    expect(hasRouteAccess(undefined, () => false)).toBe(true)
    expect(hasRouteAccess(['system'], () => false)).toBe(false)
    expect(hasRouteAccess(['system', 'governance'], (value) => value === 'governance')).toBe(true)
  })
})
