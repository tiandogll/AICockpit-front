import { describe, expect, it } from 'vitest'
import { navigationGroups } from '../domain/navigation'

describe('single-platform navigation', () => {
  it('combines teacher duties into admin question management without a teacher workspace', () => {
    const groups = navigationGroups(() => true, true)
    const items = groups.flatMap((group) => group.items)
    expect(groups[0]?.title).toBe('学员中心')
    expect(items.find((item) => item.path === '/members')?.label).toBe('学员管理')
    expect(items.some((item) => item.path === '/item-bank')).toBe(true)
    expect(items.some((item) => item.path === '/reviews')).toBe(true)
    expect(items.some((item) => item.path === '/authoring')).toBe(false)
  })
  it('never exposes management entries to learners', () => {
    expect(navigationGroups(() => false, true).map((group) => group.title)).toEqual(['学员中心'])
  })
})
