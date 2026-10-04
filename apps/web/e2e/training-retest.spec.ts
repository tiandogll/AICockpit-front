import { expect, test, type Page } from '@playwright/test'
import type { TrainingPlan } from '../src/services/trainingApi'
import { assistantFeatures, shellFixture } from './shell-fixture'

const planId = 'synthetic-training-plan'
const sessionId = 'synthetic-bound-retest'
const sourceSessionId = 'synthetic-source-session'

function readyPlan(): TrainingPlan {
  return {
    id: planId,
    organization_id: 'org-1',
    source_report_id: 'synthetic-source-report',
    source_session_id: sourceSessionId,
    source_report_revision: 2,
    source_report_changed: true,
    retest_available: true,
    retest_unavailable_reason: null,
    privacy_redacted: false,
    replaces_plan_id: null,
    template_version: 'synthetic-e2e-v1',
    content_provenance: '浏览器验收合成数据 · 非真人测量结果',
    status: 'active',
    created_at: '2026-09-25T08:00:00Z',
    completed_at: null,
    dimensions: [{ code: 'evaluation', index: 35, level: 'L2', evidence_count: 3 }],
    assessment: {
      mode: 'standard',
      scenario: 'higher_education',
      blueprint_version_id: 'synthetic-blueprint',
    },
    completed_tasks: 3,
    total_tasks: 4,
    retest: null,
    comparison: null,
    tasks: (['learning', 'exercise', 'application', 'retest'] as const).map((kind, index) => ({
      id: `synthetic-task-${index + 1}`,
      sequence: index + 1,
      kind,
      title: ['学习方法', '针对性练习', '应用核验', '同方案复测'][index]!,
      status: index < 3 ? 'completed' : 'pending',
      content: { instructions: '仅供浏览器流程验收的合成任务。' },
      submission: index < 3 ? { response: '合成学习记录，不包含真实作答。' } : null,
      feedback: index < 3 ? '合成任务已完成。' : null,
      completed_at: index < 3 ? '2026-09-25T09:00:00Z' : null,
    })),
  }
}

type Write = { path: string; body: unknown; key: string | undefined }

async function installFixtures(page: Page, failFirstLink = false) {
  const state = { plan: readyPlan(), writes: [] as Write[], unexpected: [] as string[] }
  await page.addInitScript(() => {
    sessionStorage.setItem(
      'zhijian-auth-session',
      JSON.stringify({ accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh' }),
    )
  })
  // Every API request is fulfilled here: there is no fall-through to a real backend.
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname.replace('/api/v1', '')
    if (path === '/workspace/features') {
      await route.fulfill({
        json: { ...assistantFeatures, training_enabled: true, assessment_in_progress: false },
      })
      return
    }
    if (await shellFixture(route)) return
    if (path === '/auth/me') {
      await route.fulfill({
        json: {
          id: 'synthetic-learner',
          email: 'synthetic@example.test',
          display_name: '合成验收学员',
          is_active: true,
        },
      })
      return
    }
    if (path === '/workspace/reports') {
      await route.fulfill({
        json: {
          items: [
            {
              id: state.plan.source_report_id,
              session_id: sourceSessionId,
              name: '合成来源报告',
              organization_id: 'org-1',
              mode: 'standard',
              scenario: 'higher_education',
              status: 'complete',
              revision: 9,
              completed_at: '2026-09-24T08:00:00Z',
              dimensions: state.plan.dimensions,
            },
          ],
          total: 1,
          limit: 100,
          offset: 0,
        },
      })
      return
    }
    if (request.method() === 'POST') {
      state.writes.push({
        path,
        body: request.postDataJSON(),
        key: request.headers()['idempotency-key'],
      })
      if (path === `/training/${planId}/retest/start`) {
        state.plan.retest = {
          session_id: sessionId,
          status: 'active',
          paused: false,
          expired: false,
          report_id: null,
          report_is_complete: false,
          report_status: null,
        }
        await route.fulfill({ json: { plan: state.plan, replayed: false } })
        return
      }
      if (path === `/training/${planId}/retest`) {
        if (failFirstLink && state.writes.filter((write) => write.path === path).length === 1) {
          await route.fulfill({ status: 503, json: { detail: '合成关联失败，请重试' } })
          return
        }
        state.plan = {
          ...state.plan,
          status: 'completed',
          completed_tasks: 4,
          completed_at: '2026-09-26T10:00:00Z',
          tasks: state.plan.tasks.map((task) =>
            task.kind === 'retest'
              ? {
                  ...task,
                  status: 'completed',
                  submission: { session_id: sessionId },
                  completed_at: '2026-09-26T10:00:00Z',
                }
              : task,
          ),
          comparison: {
            source_report_revision: 2,
            retest_report_revision: 7,
            dimensions: [{ code: 'evaluation', before_index: 35, after_index: 47, change: 12 }],
          },
        }
        await route.fulfill({ json: { plan: state.plan, replayed: false } })
        return
      }
    }
    if (path === '/training') {
      await route.fulfill({ json: { items: [state.plan], total: 1, limit: 20, offset: 0 } })
      return
    }
    if (path === `/training/${planId}`) {
      await route.fulfill({ json: state.plan })
      return
    }
    if (path === `/sessions/${sessionId}/workspace`) {
      await route.fulfill({
        json: {
          session: {
            id: sessionId,
            organization_id: 'org-1',
            blueprint_version_id: 'synthetic-blueprint',
            mode: 'standard',
            scenario: 'higher_education',
            status: 'active',
            paused_at: null,
            activity_revision: 1,
            created_at: '2026-09-26T09:00:00Z',
            completed_at: null,
            expires_at: null,
            ended_at: null,
            ended_reason: null,
            blueprint_snapshot: { name: '合成同方案复测', configuration: {} },
            replayed: false,
          },
          server_now: '2026-09-26T09:00:00Z',
          blueprint_name: '合成同方案复测',
          min_items: 2,
          max_items: 5,
          answered_count: 0,
          dispatched_count: 1,
          flagged_count: 0,
          items: [
            {
              item_version_id: 'synthetic-item',
              sequence: 1,
              item_type: 'objective',
              dimension_code: 'evaluation',
              answered_at: null,
              flagged: false,
            },
          ],
          current_item: {
            session_id: sessionId,
            item_version_id: 'synthetic-item',
            sequence: 1,
            item_type: 'objective',
            dimension_code: 'evaluation',
            difficulty: 0,
            stem: '合成验收题：请选择核验方式。',
            configuration: { options: ['核对来源', '直接采纳'] },
          },
          type_coverage: [{ item_type: 'objective', answered_count: 0, minimum: 2 }],
          can_complete: false,
          completion_reason: 'minimum_items',
          unmet_dimensions: ['evaluation'],
          unmet_item_types: ['objective'],
        },
      })
      return
    }
    if (path === `/sessions/${sessionId}/items/synthetic-item/draft`) {
      await route.fulfill({ json: { draft: null, context_revision: 0, can_edit: true } })
      return
    }
    state.unexpected.push(`${request.method()} ${path}`)
    await route.fulfill({ status: 404, json: { detail: 'Unconfigured synthetic retest fixture' } })
  })
  return state
}

function completeBoundReport(plan: TrainingPlan, final = false) {
  plan.retest = {
    session_id: sessionId,
    status: 'completed',
    paused: false,
    expired: false,
    report_id: 'synthetic-bound-report',
    report_is_complete: final,
    report_status: final ? 'complete' : 'pending_scoring',
  }
}

test('bound retest follows its exact session, waits for final scoring and shows frozen comparison', async ({
  page,
}, info) => {
  const state = await installFixtures(page)
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.goto(`/training?plan=${planId}`)
  await expect(page.getByTestId('start-retest')).toBeEnabled()
  await page.getByTestId('start-retest').click()
  await expect(page).toHaveURL(new RegExp(`/assessment/${sessionId}$`))
  await expect(page.getByText('合成验收题：请选择核验方式。', { exact: true })).toBeVisible()
  expect(state.writes).toHaveLength(1)
  expect(state.writes[0]).toMatchObject({ path: `/training/${planId}/retest/start`, body: {} })
  expect(state.writes[0]!.key).toBeTruthy()

  completeBoundReport(state.plan)
  await page.goto(`/training?plan=${planId}`)
  await expect(page.getByText('等待评分定稿；本次复测已封存，无需重新作答。')).toBeVisible()
  await expect(page.getByTestId('bound-retest-report')).toHaveAttribute(
    'href',
    `/reports/${sessionId}`,
  )
  await expect(page.getByTestId('start-retest')).toHaveCount(0)
  await expect(page.getByTestId('manual-retest')).toHaveCount(0)
  await expect(page.getByTestId('training-comparison')).toHaveCount(0)
  expect(state.writes).toHaveLength(1)

  completeBoundReport(state.plan, true)
  await page.getByTestId('refresh-retest').click()
  const comparison = page.getByTestId('training-comparison')
  await expect(comparison).toBeVisible()
  await expect(comparison).toContainText('来源报告 · 修订 2 → 复测报告 · 修订 7')
  await expect(comparison).toContainText('35.0')
  await expect(comparison).toContainText('47.0')
  await expect(comparison).toContainText('+12.0')
  await expect(comparison).toContainText('不代表训练的因果效果')
  await expect(comparison).not.toContainText('修订 9')
  const links = state.writes.filter((write) => write.path === `/training/${planId}/retest`)
  expect(links).toHaveLength(1)
  expect(links[0]!.body).toEqual({ session_id: sessionId })
  expect(links[0]!.key).toBeTruthy()
  await page.reload()
  await expect(page.getByTestId('training-comparison')).toBeVisible()
  expect(state.writes).toHaveLength(2)
  expect(state.unexpected).toEqual([])
  expect(pageErrors).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.screenshot({ path: info.outputPath('bound-retest-comparison.png'), fullPage: true })
})

test('failed final linking retries with one stable key and never starts another assessment', async ({
  page,
}) => {
  const state = await installFixtures(page, true)
  completeBoundReport(state.plan, true)
  await page.goto(`/training?plan=${planId}`)
  await expect(page.getByText('合成关联失败，请重试')).toBeVisible()
  expect(state.writes).toHaveLength(1)
  await expect(page.getByTestId('start-retest')).toHaveCount(0)
  await page.getByTestId('retry-link-retest').click()
  await expect(page.getByTestId('training-comparison')).toBeVisible()
  expect(state.writes).toHaveLength(2)
  expect(state.writes.every((write) => write.path === `/training/${planId}/retest`)).toBe(true)
  expect(state.writes[0]!.key).toBeTruthy()
  expect(state.writes[1]!.key).toBe(state.writes[0]!.key)
  expect(state.unexpected).toEqual([])
})
