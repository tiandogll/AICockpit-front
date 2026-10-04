import { describe, expect, it } from 'vitest'
import { isStaffPath, navigationGroups } from '../domain/navigation'
import { STAFF_CAPABILITIES } from '../domain/loginPortal'
import { hasRouteAccess } from '../domain/routeAccess'

const paths = (caps: string[], portal: 'learner' | 'staff') =>
  navigationGroups((cap) => caps.includes(cap), false, portal).flatMap((group) =>
    group.items.map((item) => item.path),
  )

describe('two product portals', () => {
  it('does not put administrative tools in personal learning navigation, even for administrators', () => {
    expect(paths(STAFF_CAPABILITIES, 'learner')).toEqual([
      '/workspace',
      '/assessment',
      '/reports',
      '/training',
      '/history',
    ])
  })
  it('offers assigned teachers only their authorized modules inside the common portal', () => {
    expect(paths(['content_author', 'reviews', 'analytics', 'pilot_participate'], 'staff')).toEqual(
      ['/teaching', '/analytics', '/authoring', '/reviews'],
    )
  })
  it('keeps trial participation available without implying trial administration', () => {
    expect(paths(['pilot_participate'], 'learner')).toContain('/pilot-lab')
    expect(paths(['pilot_participate'], 'staff')).toEqual([])
    expect(isStaffPath('/pilot-lab', (cap) => cap === 'pilot_participate')).toBe(false)
    expect(isStaffPath('/pilot-lab', (cap) => cap === 'pilots_manage')).toBe(true)
  })
  it('requires a server-issued management capability, never just a staff tab', () => {
    expect(hasRouteAccess(STAFF_CAPABILITIES, () => false)).toBe(false)
    expect(hasRouteAccess(STAFF_CAPABILITIES, (cap) => cap === 'content_author')).toBe(true)
    expect(isStaffPath('/teaching', () => false)).toBe(true)
    expect(isStaffPath('/assessment/session', () => true)).toBe(false)
  })
})
