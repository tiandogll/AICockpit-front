import { shellFixture } from './shell-fixture'
import { expect, test } from '@playwright/test'

const dimensions = [
  ['foundations', 0.36, { L1: 0, L2: 1, L3: 3, L4: 1 }],
  ['prompting', 0.12, { L1: 1, L2: 1, L3: 2, L4: 1 }],
  ['tool_use', 0.58, { L1: 0, L2: 1, L3: 2, L4: 2 }],
  ['evaluation', -0.28, { L1: 1, L2: 2, L3: 2, L4: 0 }],
  ['collaboration', 0.2, { L1: 0, L2: 2, L3: 2, L4: 1 }],
  ['ethics', 0.72, { L1: 0, L2: 0, L3: 2, L4: 3 }],
] as const

test('organization observatory shows qualified aggregates and governance', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript(() => {
    sessionStorage.setItem(
      'zhijian-auth-session',
      JSON.stringify({ accessToken: 'e2e-access', refreshToken: 'e2e-refresh' }),
    )
  })
  await page.route('**/api/v1/**', async (route) => {
    if (await shellFixture(route, 'org_admin')) return
    const url = route.request().url()
    let payload: unknown
    if (url.endsWith('/auth/me')) {
      payload = {
        id: 'admin-1',
        email: 'admin@example.test',
        display_name: '组织管理员',
        is_active: true,
      }
    } else if (url.endsWith('/organizations')) {
      payload = [{ id: 'org-1', name: '浙江智造学院', slug: 'zj-ai', role: 'org_admin' }]
    } else if (url.endsWith('/organizations/org-1/cohorts')) {
      payload = [
        {
          id: 'cohort-1',
          organization_id: 'org-1',
          name: '人工智能2301',
          kind: 'class',
          code: 'ai-2301',
          is_active: true,
          member_count: 32,
        },
      ]
    } else if (url.includes('/analytics/overview')) {
      payload = {
        organization_id: 'org-1',
        organization_name: '浙江智造学院',
        cohort_id: null,
        cohort_name: null,
        measurement_count: 7,
        methodology: 'expert_prior_not_norm',
        generated_at: '2026-08-24T12:00:00Z',
        suppressed: false,
        participant_count: 5,
        minimum_group_size: 5,
        dimensions: dimensions.map(([code, mean_theta, levels]) => ({
          code,
          sample_size: 5,
          levels,
          mean_theta,
          mean_standard_error: 0.58,
          mean_evidence_count: 4.2,
        })),
        common_gaps: [
          { code: 'evaluation', mean_theta: -0.28, sample_size: 5 },
          { code: 'prompting', mean_theta: 0.12, sample_size: 5 },
          { code: 'collaboration', mean_theta: 0.2, sample_size: 5 },
        ],
      }
    } else if (url.includes('/analytics/items')) {
      payload = dimensions.slice(0, 4).map(([dimension_code], index) => ({
        item_id: `00000000-0000-0000-0000-00000000000${index}`,
        logical_id: `10000000-0000-0000-0000-00000000000${index}`,
        version: 1,
        dimension_code,
        item_type: index < 2 ? 'objective' : index === 2 ? 'dialogue' : 'practical',
        difficulty: 0.2,
        response_count: 5,
        participant_count: 5,
        objective_correct_rate: index < 2 ? 0.6 + index * 0.1 : null,
        objective_discrimination: index < 2 ? 0.42 : null,
        finalized_count: index < 2 ? 0 : 5,
        mean_final_score: index < 2 ? null : 3.2,
        human_review_rate: index < 2 ? null : 0.2,
        suppressed: false,
      }))
    } else if (url.includes('/security/status')) {
      payload = {
        organization_id: 'org-1',
        model_tokens_used_today: 62_500,
        model_daily_token_quota: 250_000,
        recent_audit_events: 12,
        retention_days: 90,
        minimum_group_size: 5,
      }
    } else if (url.includes('/audit-events')) {
      payload = [
        {
          id: 'audit-1',
          action: 'analytics.exported',
          outcome: 'succeeded',
          resource_type: 'organization',
          occurred_at: '2026-08-24T11:50:00Z',
          event_metadata: {},
        },
        {
          id: 'audit-2',
          action: 'cohort.member_added',
          outcome: 'succeeded',
          resource_type: 'cohort',
          occurred_at: '2026-08-24T10:30:00Z',
          event_metadata: {},
        },
      ]
    } else {
      await route.fallback()
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    })
  })

  await page.goto('/analytics')
  await expect(page.getByRole('heading', { name: /组织能力.*观测站/ })).toBeVisible()
  await expect(page.getByTestId('terrain-evaluation')).toContainText('结果评估')
  await expect(page.getByText('隐私门槛 k=5')).toBeVisible()
  await expect(page.getByText('25%')).toBeVisible()
  await expect(page.getByText('预览90天清理')).toBeVisible()
  await expect(page.getByRole('main')).toHaveCount(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  await page.screenshot({
    path: `test-results/organization-analytics-${testInfo.project.name}.png`,
    fullPage: true,
    animations: 'disabled',
  })
})
