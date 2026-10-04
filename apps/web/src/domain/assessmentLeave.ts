// A single active formal workspace owns this guard. No answers are stored here.
let guard: (() => Promise<boolean>) | null = null
export function registerAssessmentLeave(callback: () => Promise<boolean>) {
  guard = callback
  return () => {
    if (guard === callback) guard = null
  }
}
export async function requestAssessmentLeave() {
  return guard ? guard() : true
}
