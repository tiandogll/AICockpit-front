import type { Route } from '@playwright/test'
export const assistantFeatures = {
  training_enabled: false,
  training_content_status: 'formative_preview',
  growth_guide_mode: 'deepseek',
  attachments_enabled: false,
  assessment_active: false,
}
/** Synthetic shell metadata; business fixtures in each test remain authoritative. */
export async function shellFixture(
  route: Route,
  role: 'learner' | 'evaluator' | 'org_admin' = 'learner',
) {
  const path = new URL(route.request().url()).pathname
  if (path.endsWith('/health')) {
    await route.fulfill({ json: { status: 'ok' } })
    return true
  }
  if (path.endsWith('/workspace/features')) {
    await route.fulfill({ json: assistantFeatures })
    return true
  }
  if (!path.endsWith('/workspace/access')) return false
  const capabilities =
    role === 'org_admin'
      ? ['analytics', 'members', 'governance', 'reviews', 'pilots_manage', 'pilot_participate']
      : role === 'evaluator'
        ? ['analytics', 'reviews', 'pilot_participate']
        : ['pilot_participate']
  await route.fulfill({
    json: {
      organizations: [{ id: 'org-1', name: '界面测试组织', role, capabilities }],
      global_capabilities: [],
    },
  })
  return true
}
