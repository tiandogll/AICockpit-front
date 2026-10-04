import { describe, expect, it } from 'vitest'
import { loginRouteName, staffDestination, safeRedirect } from '../domain/loginPortal'

const learner = {
  id: 'personal',
  name: '个人空间',
  role: 'learner',
  capabilities: ['pilot_participate'],
}
const teacher = {
  id: 'school',
  name: '学校',
  role: 'evaluator',
  capabilities: ['pilot_participate', 'analytics', 'reviews'],
}
const context = {
  ready: true,
  error: '',
  organizationId: 'personal',
  globalCapabilities: [] as string[],
  organizations: [learner, teacher],
}

describe('login portal selection', () => {
  it('requires platform administrator rights in single-platform mode, never an old teacher assignment', () => {
    expect(
      staffDestination({
        ...context,
        singlePlatform: true,
        globalCapabilities: ['content_author'],
      }),
    ).toBeNull()
    expect(
      staffDestination(
        { ...context, singlePlatform: true, globalCapabilities: ['system', 'content'] },
        '/authoring',
      ),
    ).toEqual({
      path: '/item-bank',
      organizationId: 'personal',
    })
  })
  it('sends assigned authors to the shared teaching portal without giving them the global item bank', () => {
    const author = { ...context, organizations: [learner], globalCapabilities: ['content_author'] }
    expect(staffDestination(author)).toEqual({ path: '/teaching', organizationId: 'personal' })
    expect(staffDestination(author, '/item-bank')).toEqual({
      path: '/teaching',
      organizationId: 'personal',
    })
  })
  it('uses the staff entrance only for capability-restricted deep links', () => {
    expect(loginRouteName(['content'])).toBe('staff-login')
    expect(loginRouteName(['system', 'governance'])).toBe('staff-login')
    expect(loginRouteName(undefined)).toBe('login')
    expect(loginRouteName([])).toBe('login')
  })
  it('does not treat a username or a role label as a staff capability', () => {
    expect(
      staffDestination({ ...context, organizations: [{ ...learner, role: 'system_admin' }] }),
    ).toBeNull()
  })
  it('selects an actually authorized organization without granting its learner organization access', () => {
    expect(staffDestination(context)).toEqual({ path: '/teaching', organizationId: 'school' })
    expect(context.organizationId).toBe('personal')
  })
  it('prefers the current authorized organization and preserves an allowed management deep link', () => {
    const secondTeacher = { ...teacher, id: 'second-school' }
    expect(
      staffDestination(
        { ...context, organizationId: secondTeacher.id, organizations: [teacher, secondTeacher] },
        '/reviews?status=needs_review',
      ),
    ).toEqual({ path: '/reviews?status=needs_review', organizationId: 'second-school' })
  })
  it('lands all staff in one portal without confusing org admin with content rights', () => {
    expect(
      staffDestination({ ...context, globalCapabilities: ['content', 'cat', 'system'] }),
    ).toEqual({ path: '/teaching', organizationId: 'school' })
    expect(
      staffDestination(
        {
          ...context,
          organizations: [
            { ...learner, role: 'org_admin', capabilities: ['members', 'governance'] },
          ],
        },
        '/item-bank',
      ),
    ).toEqual({ path: '/teaching', organizationId: 'personal' })
  })
  it.each([{ ready: false }, { error: '权限读取失败' }])(
    'fails closed on incomplete access %j',
    (patch) => {
      expect(staffDestination({ ...context, ...patch })).toBeNull()
    },
  )
  it('keeps organization teaching tools available for an author with a personal learner space', () => {
    expect(staffDestination({ ...context, globalCapabilities: ['content_author'] })).toEqual({
      path: '/teaching',
      organizationId: 'school',
    })
    expect(
      staffDestination({ ...context, globalCapabilities: ['content_author'] }, '/authoring'),
    ).toEqual({
      path: '/authoring',
      organizationId: 'personal',
    })
  })
  it.each([
    '/staff/login',
    '/staff/login?redirect=/item-bank',
    '/staff/login/',
    '/%73taff/login',
    '/staff/%6cogin',
    '//evil.test',
    '/%2f%2fevil.test',
    '/%0aevil',
    'https://evil.test',
  ])('rejects unsafe or recursive login destination %s', (path) => {
    expect(safeRedirect(path)).toBe('/workspace')
  })
})
