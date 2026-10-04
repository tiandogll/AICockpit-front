import { shellFixture } from './shell-fixture'
import path from 'node:path'

import { expect, test, type Page, type TestInfo } from '@playwright/test'

const user = {
  id: 'evaluator-1',
  email: 'evaluator@example.test',
  display_name: '周评估员',
  is_active: true,
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem(
      'zhijian-auth-session',
      JSON.stringify({ accessToken: 'visual-access', refreshToken: 'visual-refresh' }),
    )
  })
})

test('trusted personal report exposes status, evidence and traceability', async ({
  page,
}, testInfo) => {
  const errors = collectBrowserErrors(page)
  await page.route('**/api/v1/**', async (route) => {
    if (await shellFixture(route, 'evaluator')) return
    const pathname = new URL(route.request().url()).pathname
    const body = pathname.endsWith('/auth/me')
      ? user
      : pathname.endsWith('/reports/session-1')
        ? report
        : pathname.endsWith('/sessions/session-1')
          ? {
              id: 'session-1',
              organization_id: 'org-1',
              status: 'completed',
              completed_at: '2026-08-28T08:00:00Z',
            }
          : { detail: 'not mocked' }
    await route.fulfill({
      status: 'detail' in body ? 404 : 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })
  })

  await page.goto('/reports/session-1')
  await expect(page.getByRole('heading', { name: 'AI能力标准测报告' })).toBeVisible()
  await expect(page.getByText('等待人工复核')).toBeVisible()
  await expect(page.getByText(/报告版本 R3/)).toBeVisible()
  await expect(page.getByTestId('dimension-evaluation')).toContainText('结果评估')
  await screenshot(page, testInfo, 'report')
  expect(errors).toEqual([])
})

test('report automatically settles without scoring writes or disabled training requests', async ({
  page,
}) => {
  const errors = collectBrowserErrors(page)
  let reads = 0
  const writes: string[] = []
  const trainingReads: string[] = []
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    if (request.method() !== 'GET') writes.push(pathname)
    if (pathname.includes('/training')) trainingReads.push(pathname)
    if (await shellFixture(route, 'evaluator')) return
    if (pathname.endsWith('/auth/me')) return route.fulfill({ json: user })
    if (pathname.endsWith('/sessions/session-1'))
      return route.fulfill({
        json: { id: 'session-1', organization_id: 'org-1', status: 'completed' },
      })
    if (pathname.endsWith('/reports/session-1')) {
      reads += 1
      const final = reads > 1
      return route.fulfill({
        json: {
          ...report,
          is_complete: final,
          revision: final ? 4 : 3,
          payload: {
            ...report.payload,
            measurement_status: final ? 'complete' : 'pending_scoring',
            summary: { ...report.payload.summary, pending_scoring: final ? 0 : 1, needs_review: 0 },
          },
          processing: {
            state: final ? 'complete' : 'pending',
            automatic_scoring_enabled: true,
            failed_answers: 0,
            pending_answers: final ? 0 : 1,
            review_answers: 0,
          },
        },
      })
    }
    return route.fulfill({ status: 404, json: { detail: 'not mocked' } })
  })
  await page.goto('/reports/session-1')
  await expect(page.getByText('评分处理中', { exact: true })).toBeVisible()
  await expect(page.getByText('可信评分完成', { exact: true })).toBeVisible({ timeout: 12000 })
  await expect(page.getByText(/报告版本 R4/)).toBeVisible()
  await expect(
    page.getByLabel('推荐学习路径').getByText('训练服务当前未启用，可先阅读报告建议。'),
  ).toBeVisible()
  expect(reads).toBe(2)
  expect(writes).toEqual([])
  expect(trainingReads).toEqual([])
  expect(errors).toEqual([])
})

test('evaluator can inspect and seal a review dossier', async ({ page }, testInfo) => {
  const errors = collectBrowserErrors(page)
  let resolved = false
  await page.route('**/api/v1/**', async (route) => {
    if (await shellFixture(route, 'evaluator')) return
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    let body: object
    if (pathname.endsWith('/auth/me')) body = user
    else if (pathname.endsWith('/assessment-definitions/launch-context')) body = launchContext
    else if (pathname.endsWith('/admin/reviews') && request.method() === 'GET') {
      body = resolved ? [] : [reviewQueueItem]
    } else if (pathname.endsWith('/admin/reviews/decision-1/resolve')) {
      resolved = true
      body = {
        review_id: 'review-1',
        decision_id: 'decision-1',
        state: 'completed',
        final_score: 3.5,
        final_source: 'human',
      }
    } else if (pathname.endsWith('/admin/reviews/decision-1')) body = reviewDetail
    else {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: '{"detail":"not mocked"}',
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })
  })

  await page.goto('/reviews')
  await expect(page.getByRole('heading', { name: '评分复核工作台' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '如何核验AI结论?' })).toBeVisible()
  await screenshot(page, testInfo, 'review-dossier')
  await page.getByTestId('review-score').fill('3.5')
  await page.getByTestId('review-rationale').fill('人工核对后确认达到完整闭环。')
  await page.getByTestId('review-evidence').fill('回答明确提出核对来源。')
  await page.getByTestId('resolve-review').click()
  await expect(page.getByText('最终评分已封存')).toBeVisible()
  await expect(page.getByRole('heading', { name: '当前组织暂无待复核评分' })).toBeVisible()
  expect(errors).toEqual([])
})

const report = {
  id: 'report-1',
  session_id: 'session-1',
  is_complete: false,
  revision: 3,
  payload: {
    assessment: { mode: 'standard', scenario: 'higher_education' },
    summary: { answered: 18, pending_scoring: 1, needs_review: 1, scored_open_answers: 2 },
    measurement_status: 'needs_review',
    measurement_note: '证据综合使用专家先验客观测量与版本化量规裁决，不是正式常模。',
    dimensions: {
      evaluation: {
        objective_measurement: { theta: 0.4, standard_error: 0.5, evidence_count: 2, level: 'L3' },
        rubric_measurement: {
          mean_score: 3.5,
          mean_confidence: 0.86,
          completed: 1,
          pending: 1,
          decisions: [{ decision_id: 'decision-1', score: 3.5, source: 'human', tasks: [] }],
        },
        synthesis: {
          index: 73.4,
          level: 'L4',
          method_version: 'evidence-synthesis-v1',
          evidence_count: 3,
        },
      },
    },
    recommendations: [{ dimension_code: 'evaluation', action: '建立来源、计算和反例核验清单。' }],
    strengths: ['evaluation'],
    scoring_policy_version: 'dual-evidence-v1',
  },
}

const launchContext = {
  organizations: [{ id: 'org-1', name: '浙江示范高校', role: 'evaluator' }],
  blueprints: [],
  active_sessions: [],
}
const reviewQueueItem = {
  decision_id: 'decision-1',
  session_id: 'session-1',
  item_type: 'dialogue',
  dimension_code: 'evaluation',
  provisional_score: 2.5,
  confidence: 0.72,
  review_reasons: ['safety_flag'],
  updated_at: '2026-08-24T08:00:00Z',
}
const reviewDetail = {
  decision_id: 'decision-1',
  state: 'needs_review',
  provisional_score: 2.5,
  final_score: null,
  confidence: 0.72,
  final_source: null,
  review_reasons: ['safety_flag'],
  answer: { transcript: [{ role: 'user', content: '我会核对来源。' }] },
  item: {
    id: 'item-1',
    stem: '如何核验AI结论?',
    item_type: 'dialogue',
    dimension_code: 'evaluation',
  },
  rubric: { id: 'rubric-1', version: 1, title: '结果核验量规', criteria: { criteria: [] } },
  tasks: [
    {
      id: 'task-1',
      role: 'primary',
      state: 'completed',
      model: 'model-a',
      prompt_version: 'scoring-primary-v1',
      score: 3,
      confidence: 0.8,
      result_hash: 'a'.repeat(64),
      evidence: [
        {
          criterion_code: 'verification',
          score: 3,
          confidence: 0.8,
          quote: '核对来源',
          rationale: '对应量规',
          evidence_hash: 'b'.repeat(64),
          verified: true,
        },
      ],
    },
  ],
}

function collectBrowserErrors(page: Page) {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  return errors
}

async function screenshot(page: Page, testInfo: TestInfo, name: string) {
  const directory = process.env.VISUAL_OUTPUT_DIR
  if (!directory) return
  await page.screenshot({
    path: path.join(directory, `trusted-${name}-${testInfo.project.name}.png`),
    fullPage: true,
  })
}
