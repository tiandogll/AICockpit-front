import { shellFixture } from './shell-fixture'
import path from 'node:path'

import { expect, test, type Page, type TestInfo } from '@playwright/test'

const session = {
  id: 'session-1',
  organization_id: 'org-1',
  blueprint_version_id: 'blueprint-1',
  mode: 'standard',
  scenario: 'higher_education',
  status: 'active',
  blueprint_snapshot: {
    name: '高校AI能力标准测',
    configuration: { min_items: 18, max_items: 30 },
  },
  replayed: false,
  created_at: '2026-09-15T08:00:00Z',
  completed_at: null,
  expires_at: null,
  ended_at: null,
  ended_reason: null,
}

const item = {
  session_id: 'session-1',
  item_version_id: 'item-1',
  sequence: 7,
  item_type: 'objective',
  dimension_code: 'evaluation',
  difficulty: 0.35,
  stem: 'AI给出一组看似完整的活动数据时，哪种核验方式最可靠？',
  configuration: {
    options: [
      '直接采用，因为表达很完整',
      '追溯原始来源并用第二个独立来源交叉核验',
      '让AI再次生成相同结论',
    ],
  },
}

test('formal learner launch and runner remain usable on desktop and mobile', async ({
  page,
}, testInfo) => {
  const consoleErrors: string[] = []
  const draftWrites: { key: string | undefined; revision: number }[] = []
  let draft: {
    response: Record<string, unknown>
    revision: number
    context_revision: number
    saved_at: string
  } | null = null
  const workspace = {
    session,
    server_now: '2026-09-15T08:03:00Z',
    blueprint_name: session.blueprint_snapshot.name,
    min_items: 18,
    max_items: 30,
    answered_count: 6,
    dispatched_count: 7,
    flagged_count: 0,
    current_item: item,
    items: Array.from({ length: 7 }, (_, index) => ({
      item_version_id: index === 6 ? 'item-1' : `previous-item-${index + 1}`,
      sequence: index + 1,
      item_type: 'objective',
      dimension_code: 'evaluation',
      answered_at: index === 6 ? null : '2026-09-15T08:02:00Z',
      flagged: false,
    })),
    type_coverage: [
      { item_type: 'objective', answered_count: 6, minimum: 12 },
      { item_type: 'dialogue', answered_count: 0, minimum: 4 },
      { item_type: 'practical', answered_count: 0, minimum: 2 },
    ],
    can_complete: false,
    completion_reason: 'minimum_items',
    unmet_dimensions: ['foundations', 'prompting', 'tool_use', 'collaboration', 'ethics'],
    unmet_item_types: ['objective', 'dialogue', 'practical'],
  }
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))
  await page.route('**/api/v1/**', async (route) => {
    if (await shellFixture(route, 'learner')) return
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    let body: object
    if (pathname.endsWith('/auth/me')) {
      body = {
        id: 'user-1',
        email: 'learner@example.test',
        display_name: '林同学',
        is_active: true,
      }
    } else if (pathname.endsWith('/assessment-definitions/launch-context')) {
      body = {
        organizations: [{ id: 'org-1', name: '浙江示范高校', role: 'learner' }],
        blueprints: [
          {
            id: 'blueprint-1',
            name: '高校AI能力标准测',
            mode: 'standard',
            scenario: 'higher_education',
            min_items: 18,
            max_items: 30,
            item_type_minimums: { objective: 12, dialogue: 4, practical: 2 },
            dimension_codes: [
              'evaluation',
              'foundations',
              'prompting',
              'tool_use',
              'collaboration',
              'ethics',
            ],
          },
        ],
        active_sessions: [],
      }
    } else if (pathname.endsWith('/sessions') && request.method() === 'POST') body = session
    else if (pathname.endsWith('/sessions/session-1') && request.method() === 'GET') body = session
    else if (pathname.endsWith('/sessions/session-1/next')) body = item
    else if (pathname.endsWith('/sessions/session-1/workspace')) body = workspace
    else if (pathname.endsWith('/sessions/session-1/items/item-1/draft')) {
      if (request.method() === 'PUT') {
        const payload = request.postDataJSON()
        draftWrites.push({ key: request.headers()['idempotency-key'], revision: payload.revision })
        if (payload.revision !== (draft?.revision ?? 0)) {
          await route.fulfill({ status: 409, json: { detail: 'DRAFT_REVISION_CONFLICT' } })
          return
        }
        draft = {
          ...payload,
          revision: payload.revision + 1,
          saved_at: '2026-09-15T08:03:05Z',
        }
      }
      body = { draft, context_revision: 0, can_edit: true }
    } else {
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

  await page.goto('/login')
  await expect(page.getByRole('heading', { name: '欢迎回来', exact: true })).toBeVisible()
  await visualScreenshot(page, testInfo, 'login')

  await page.evaluate(() => {
    sessionStorage.setItem(
      'zhijian-auth-session',
      JSON.stringify({ accessToken: 'visual-access', refreshToken: 'visual-refresh' }),
    )
  })
  await page.goto('/assessment')
  await expect(page.getByTestId('assessment-title')).toHaveText('选择测评方式')
  await expect(
    page.getByText('系统从已发布题库中自适应派题，中途退出后可从原题继续。', { exact: false }),
  ).toBeVisible()
  await expect(page.locator('select').first()).toHaveValue('org-1')
  await visualScreenshot(page, testInfo, 'assessment-launcher')

  await page.getByTestId('start-assessment').click()
  await expect(page.getByRole('heading', { name: /哪种核验方式最可靠/ })).toBeVisible()
  await expect(page.getByText('第7题/最多30题', { exact: true })).toBeVisible()
  const mobileNavigation = page.getByRole('button', { name: '题目导航', exact: true })
  let navigation = page.getByRole('complementary', { name: '答题进度与证据' })
  // eslint-disable-next-line playwright/no-conditional-in-test -- Both responsive layouts assert the same progress and locked future question below.
  if (await mobileNavigation.isVisible()) {
    await mobileNavigation.click()
    navigation = page.getByRole('dialog', { name: '题目导航与能力证据' })
  }
  await expect(navigation.getByText('已完成 6 题，最多 30 题', { exact: false })).toContainText(
    '已完成 6 题，最多 30 题',
  )
  await expect(navigation.getByRole('button', { name: /第8题，尚未派发/ })).toBeDisabled()
  await page.keyboard.press('Escape')
  const answer = page.getByRole('radio', { name: '追溯原始来源并用第二个独立来源交叉核验' })
  await answer.check()
  await expect(
    page.getByTestId('assessment-session-toolbar').getByText('草稿已保存', { exact: true }),
  ).toBeVisible()
  expect(draftWrites).toHaveLength(1)
  expect(draftWrites[0]?.key).toBeTruthy()
  expect(draftWrites[0]?.revision).toBe(0)
  await expect(page.getByTestId('submit-current-answer')).toBeEnabled()
  await page.reload()
  await expect(answer).toBeChecked()
  await expect(
    page.getByTestId('assessment-session-toolbar').getByText('草稿已保存', { exact: true }),
  ).toBeVisible()
  await visualScreenshot(page, testInfo, 'objective-runner')
  expect(consoleErrors).toEqual([])
})

async function visualScreenshot(page: Page, testInfo: TestInfo, name: string) {
  const directory = process.env.VISUAL_OUTPUT_DIR
  if (!directory) return
  await page.screenshot({
    path: path.join(directory, `learner-${name}-${testInfo.project.name}.png`),
    fullPage: true,
  })
}
