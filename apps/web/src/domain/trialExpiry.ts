// Browsers clamp larger setTimeout values to a near-immediate timeout. A trial
// lasts ninety days, so schedule long deadlines in bounded, rechecked pieces.
export const MAX_TRIAL_TIMER_DELAY = 2_147_483_647

export function pastTrialRetention(expiresAt: string, now = Date.now()) {
  const deadline = Date.parse(expiresAt)
  return !Number.isFinite(deadline) || now >= deadline
}

/** check must erase expired private state and return the next future deadline. */
export function createTrialExpiryGuard(check: (now: number) => number | null) {
  let timer: number | undefined
  let disposed = false
  function cancel() {
    if (timer !== undefined) window.clearTimeout(timer)
    timer = undefined
  }
  function refresh() {
    cancel()
    if (disposed) return
    const now = Date.now()
    const deadline = check(now)
    if (deadline !== null && Number.isFinite(deadline) && deadline > now) {
      timer = window.setTimeout(refresh, Math.min(deadline - now, MAX_TRIAL_TIMER_DELAY))
    }
  }
  // Background throttling, sleeping devices and restored pages may skip timers.
  window.addEventListener('focus', refresh)
  window.addEventListener('pageshow', refresh)
  document.addEventListener('visibilitychange', refresh)
  function dispose() {
    disposed = true
    cancel()
    window.removeEventListener('focus', refresh)
    window.removeEventListener('pageshow', refresh)
    document.removeEventListener('visibilitychange', refresh)
  }
  return { refresh, cancel, dispose }
}
