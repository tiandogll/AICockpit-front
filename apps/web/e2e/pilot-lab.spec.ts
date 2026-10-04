import { shellFixture } from './shell-fixture'
import { expect, test } from '@playwright/test'

test('pilot lab exposes evidence gaps and immutable metric trace', async ({ page }, testInfo) => {
  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  page.on('pageerror', (error) => browserErrors.push(error.message))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript(() => {
    sessionStorage.setItem(
      'zhijian-auth-session',
      JSON.stringify({ accessToken: 'pilot-e2e', refreshToken: 'pilot-refresh' }),
    )
  })
  await page.route('**/api/v1/**', async (route) => {
    if (await shellFixture(route, 'org_admin')) return
    const url = new URL(route.request().url())
    let body: unknown
    if (url.pathname.endsWith('/auth/me')) {
      body = {
        id: 'admin-1',
        email: 'admin@example.test',
        display_name: '试测管理员',
        is_active: true,
      }
    } else if (url.pathname.endsWith('/organizations')) {
      body = [{ id: 'org-1', name: '浙江智造学院', slug: 'zj', role: 'org_admin' }]
    } else if (url.pathname.endsWith('/assessment-definitions/launch-context')) {
      body = { organizations: [], blueprints: [], active_sessions: [] }
    } else if (url.pathname.endsWith('/admin/pilots')) {
      body = [campaign]
    } else if (url.pathname.endsWith('/admin/pilots/campaign-1')) {
      body = overview
    } else if (url.pathname.endsWith('/candidate-answers')) {
      body = []
    } else if (url.pathname.endsWith('/experts')) {
      body = []
    } else if (url.pathname.endsWith('/expert/pilot-assignments')) {
      body = []
    } else {
      await route.fulfill({ status: 404, body: '{"detail":"not mocked"}' })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })
  })

  await page.goto('/pilot-lab')
  await expect(page.getByRole('heading', { name: /真实试测.*实验台/ })).toBeVisible()
  await expect(page.getByText('尚有 2 项门禁未通过')).toBeVisible()
  await expect(page.getByTestId('gate-completed_participants')).toContainText('38')
  await expect(page.getByText('0.780')).toBeVisible()
  await expect(page.getByTestId('metric-question-reduction')).toHaveText('34%')
  await expect(page.getByTestId('freeze-campaign')).toBeDisabled()
  await page.screenshot({
    path: `test-results/pilot-lab-${testInfo.project.name}.png`,
    fullPage: true,
    animations: 'disabled',
  })
  expect(browserErrors).toEqual([])
})

const campaign = {
  id: 'campaign-1',
  organization_id: 'org-1',
  name: 'A01高校真实首轮',
  scenario: 'higher_education',
  data_origin: 'real',
  status: 'analyzing',
  target_participants: 50,
  target_open_answers: 60,
  required_experts: 3,
  preregistration: {},
  version_bundle: { blueprint: 'standard-v1' },
  freeze_hash: null,
  frozen_at: null,
  created_at: '2026-08-25T08:00:00Z',
}

const overview = {
  campaign,
  participant_count: 42,
  completed_participant_count: 38,
  withdrawn_participant_count: 2,
  assigned_answer_count: 55,
  submitted_rating_count: 138,
  expert_count: 3,
  gold_standard_count: 46,
  efficiency_observation_count: 35,
  latest_metric_run: {
    id: 'run-1',
    campaign_id: 'campaign-1',
    data_origin: 'real',
    dataset_hash: 'a'.repeat(64),
    algorithm_version: 'pilot-validation-v1',
    seed: 20260825,
    parameters: { bootstrap_iterations: 2000 },
    exclusions: { withdrawn_participants: 2 },
    results: {
      score_validation: {
        sample_size: 46,
        linear_weighted_kappa: 0.78,
        adjacent_agreement: 0.93,
        mae: 0.31,
      },
      cat_efficiency: {
        sample_size: 35,
        question_reduction: 0.34,
        level_agreement: 0.88,
      },
      notice: 'initial pilot validation; not a formal norm',
    },
    completed_at: '2026-08-25T09:00:00Z',
  },
  gates: [
    {
      code: 'completed_participants',
      label: '完成试测用户',
      passed: false,
      current: 38,
      target: 50,
    },
    {
      code: 'gold_standards',
      label: '三专家金标准',
      passed: false,
      current: 46,
      target: 60,
    },
    {
      code: 'linear_weighted_kappa',
      label: '加权Kappa',
      passed: true,
      current: 0.78,
      target: 0.75,
    },
    {
      code: 'question_reduction',
      label: 'CAT题量缩减',
      passed: true,
      current: 0.34,
      target: 0.3,
    },
  ],
}
