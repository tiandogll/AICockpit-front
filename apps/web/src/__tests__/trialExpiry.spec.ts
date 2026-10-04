import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTrialExpiryGuard, MAX_TRIAL_TIMER_DELAY } from '../domain/trialExpiry'

afterEach(() => vi.useRealTimers())
describe('trial retention timer', () => {
  it('chunks a ninety-day deadline within the platform timeout limit and cleans up', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-20T00:00:00Z'))
    const end = Date.now() + 90 * 24 * 60 * 60 * 1000
    const check = vi.fn((now: number) => (now >= end ? null : end))
    const guard = createTrialExpiryGuard(check)
    guard.refresh()
    expect(check).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(MAX_TRIAL_TIMER_DELAY)
    expect(check).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(90 * 24 * 60 * 60 * 1000 - MAX_TRIAL_TIMER_DELAY)
    expect(check).toHaveBeenLastCalledWith(end)
    expect(vi.getTimerCount()).toBe(0)
    guard.dispose()
    const count = check.mock.calls.length
    window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))
    expect(check).toHaveBeenCalledTimes(count)
  })
  it('rechecks immediately on focus and visibility after a suspended clock', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-20T00:00:00Z'))
    const end = Date.now() + 1000
    const check = vi.fn((now: number) => (now >= end ? null : end))
    const guard = createTrialExpiryGuard(check)
    guard.refresh()
    vi.setSystemTime(end + 1)
    window.dispatchEvent(new Event('focus'))
    expect(check).toHaveBeenLastCalledWith(end + 1)
    expect(vi.getTimerCount()).toBe(0)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(check).toHaveBeenCalledTimes(3)
    guard.dispose()
  })
})
