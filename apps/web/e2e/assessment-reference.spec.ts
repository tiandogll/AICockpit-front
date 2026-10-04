import { expect, test } from '@playwright/test'
import path from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'

// Isolated, synthetic screenshot fixture. Never persisted to a real database or report.
const current = {
  session_id: 'visual-session',
  item_version_id: 'visual-dialogue',
  sequence: 12,
  item_type: 'dialogue',
  dimension_code: 'evaluation',
  difficulty: 0.5,
  stem: '请说明你如何检查AI回答中的资料来源。',
  configuration: {
    target_level: 'L3',
    dialogue_max_turns: 3,
    learner_guidance:
      '可以从来源权威性、时效性、原始证据和交叉验证方式展开。系统评价你的判断过程，而不是固定答案。',
    evidence_focus: ['是否区分原始与二手来源', '是否说明交叉验证方法', '是否识别数据口径差异'],
    reference_materials: [
      { title: '来源核验任务说明', content: '请结合实际操作，描述如何判断相互矛盾的三个来源。' },
    ],
    attachment_policy: { enabled: true, max_files: 3, max_bytes: 5242880, allow_code: false },
  },
}
const question =
  '你提到“查找其他来源进行验证”。如果三个来源的结论互相矛盾，你会依据什么标准判断哪个更可信？请结合实际操作说明。'
const answer =
  '我会先确认三个来源是否为原始材料，再比较作者或机构的专业背景、发布日期和引用依据。对于关键数字，我会追溯到原始数据集或官方发布页面，并记录不同来源间的口径差异……'
const workspace = {
  session: {
    id: 'visual-session',
    organization_id: 'org-1',
    blueprint_version_id: 'bp-visual',
    mode: 'standard',
    scenario: 'higher_education',
    status: 'active',
    created_at: '2026-09-15T05:50:00Z',
    expires_at: '2026-09-15T06:14:26Z',
    blueprint_snapshot: { configuration: { max_items: 18 } },
    replayed: false,
  },
  server_now: '2026-09-15T06:00:00Z',
  blueprint_name: 'AI能力标准测',
  min_items: 12,
  max_items: 18,
  answered_count: 11,
  dispatched_count: 12,
  flagged_count: 1,
  current_item: current,
  items: Array.from({ length: 12 }, (_, i) => ({
    item_version_id: i === 11 ? current.item_version_id : `visual-${i + 1}`,
    sequence: i + 1,
    item_type: i < 6 ? 'objective' : 'dialogue',
    dimension_code: 'evaluation',
    answered_at: i < 11 ? '2026-09-15T05:59:00Z' : null,
    flagged: i === 7,
  })),
  type_coverage: [
    { item_type: 'objective', answered_count: 6, minimum: 6 },
    { item_type: 'dialogue', answered_count: 5, minimum: 6 },
    { item_type: 'practical', answered_count: 0, minimum: 1 },
  ],
  can_complete: false,
  completion_reason: 'insufficient',
  unmet_dimensions: [],
  unmet_item_types: ['practical'],
}

test('reference dialogue composition and real controls at five viewport sizes', async ({
  page,
}, testInfo) => {
  // eslint-disable-next-line playwright/no-skipped-test -- This test itself checks all five desktop/mobile viewport sizes; don't duplicate the matrix in the emulated-device project.
  test.skip(
    testInfo.project.name !== 'chromium',
    'Desktop viewport matrix uses one deterministic browser.',
  )
  await page.addInitScript(() => {
    sessionStorage.setItem(
      'zhijian-auth-session',
      JSON.stringify({ accessToken: 'synthetic-visual-token', refreshToken: 'synthetic-refresh' }),
    )
  })
  let draft = {
    response: { content: answer, attachment_ids: [] },
    revision: 1,
    context_revision: 2,
    saved_at: '2026-09-15T06:00:00Z',
  }
  const faults: string[] = []
  page.on('pageerror', (e) => faults.push(e.message))
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url()).pathname
    let data: unknown
    if (url.endsWith('/auth/me'))
      data = {
        id: 'visual-user',
        email: 'visual@example.test',
        display_name: '林晓',
        is_active: true,
      }
    else if (url.endsWith('/workspace/access'))
      data = {
        organizations: [
          {
            id: 'org-1',
            name: '截图测试组织',
            role: 'evaluator',
            capabilities: ['analytics', 'reviews'],
          },
        ],
        global_capabilities: ['content'],
      }
    else if (url.endsWith('/health')) data = { status: 'ok' }
    else if (url.endsWith('/workspace')) data = workspace
    else if (url.endsWith('/draft')) {
      if (request.method() === 'PUT') {
        const body = request.postDataJSON()
        draft = { ...body, revision: body.revision + 1, saved_at: '2026-09-15T06:00:00Z' }
      }
      data = { draft, context_revision: 2, can_edit: true }
    } else if (url.endsWith('/flag')) {
      workspace.items[11]!.flagged = request.postDataJSON().flagged
      workspace.flagged_count = workspace.items.filter((i) => i.flagged).length
      data = { item_version_id: current.item_version_id, flagged: workspace.items[11]!.flagged }
    } else if (url.endsWith('/attachments')) data = { attachments: [] }
    else if (url.endsWith('/dialogue/visual-dialogue'))
      data = {
        exchange_id: 'visual-exchange',
        session_id: 'visual-session',
        item_version_id: current.item_version_id,
        state: 'awaiting_user',
        max_turns: 3,
        turn_count: 2,
        last_error_code: null,
        completed_at: null,
        can_submit: true,
        can_retry_generation: false,
        turns: [
          {
            id: 'turn-1',
            sequence: 1,
            user_content: '我会查找原始出处。',
            submitted_at: '2026-09-15T05:57:00Z',
            assistant_content: '如果有多个来源，你会怎样进一步验证？',
            assistant_completed_at: '2026-09-15T05:57:05Z',
            degraded: false,
          },
          {
            id: 'turn-2',
            sequence: 2,
            user_content: '我会查找其他来源进行验证。',
            submitted_at: '2026-09-15T05:59:00Z',
            assistant_content: question,
            assistant_completed_at: '2026-09-15T05:59:05Z',
            degraded: false,
          },
        ],
      }
    else {
      await route.fulfill({
        status: 404,
        json: { detail: 'Synthetic fixture has no such endpoint' },
      })
      return
    }
    await route.fulfill({ json: data })
  })
  const dir = process.env.VISUAL_OUTPUT_DIR || path.resolve('test-results/assessment-reference')
  mkdirSync(dir, { recursive: true })
  for (const [width, height] of [
    [1532, 1022],
    [1440, 1000],
    [1920, 1080],
    [1024, 900],
    [390, 844],
  ]) {
    await page.setViewportSize({ width: width!, height: height! })
    await page.goto('/assessment/visual-session')
    await expect(page.getByLabel('你的回答', { exact: true })).toHaveValue(answer)
    await expect(page.getByText('AI面试官 · 第2次追问')).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    )
    expect(overflow).toBe(false)
    await page.screenshot({ path: path.join(dir, `assessment-${width}.png`), fullPage: true })
    const regions = await page.evaluate(() =>
      Object.fromEntries(
        [
          '.measure-sidebar',
          '.measure-toolbar',
          '.exam-session-toolbar',
          '.exam-coverage',
          '.exam-main',
          '.exam-side-rail',
          '.dialogue-composer',
          '.exam-guidance',
          '.exam-answer-footer',
        ].map((selector) => {
          const el = document.querySelector(selector),
            r = el?.getBoundingClientRect()
          return [selector, r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null]
        }),
      ),
    )
    writeFileSync(path.join(dir, `geometry-${width}.json`), JSON.stringify(regions, null, 2))
  }
  await page.setViewportSize({ width: 1532, height: 1022 })
  await page.getByRole('button', { name: '查看任务资料', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '本题任务资料' })).toBeVisible()
  await page.getByRole('button', { name: '关闭任务资料' }).click()
  await page.getByRole('button', { name: '标记稍后检查', exact: true }).click()
  await expect(page.getByRole('button', { name: '已标记检查' })).toBeVisible()
  expect(faults).toEqual([])
})
