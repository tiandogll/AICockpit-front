import { expect, test, type Page } from '@playwright/test'
import { shellFixture } from './shell-fixture'
import { writeFile } from 'node:fs/promises'

async function captureGeometry(page: Page, path: string, selectors: string[]) {
  const regions = await page.evaluate(
    (selectors) =>
      selectors.map((selector) => {
        const rect = document.querySelector(selector)!.getBoundingClientRect()
        return { selector, x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      }),
    selectors,
  )
  await writeFile(path, JSON.stringify(regions, null, 2))
}

const codes = ['foundations', 'prompting', 'tool_use', 'evaluation', 'collaboration', 'ethics']
const session = {
  id: 'reference-session',
  organization_id: 'org-1',
  status: 'completed',
  mode: 'standard',
  scenario: 'higher_education',
  completed_at: '2026-08-28T08:00:00Z',
  blueprint_snapshot: {},
  replayed: false,
}
const report = {
  id: 'reference-report',
  session_id: session.id,
  is_complete: true,
  revision: 3,
  payload: {
    assessment: { mode: 'standard', scenario: 'higher_education' },
    measurement_status: 'complete',
    summary: { answered: 18, needs_review: 0 },
    dimensions: Object.fromEntries(
      codes.map((code, index) => [
        code,
        {
          synthesis: {
            index: [76, 82, 64, 48, 73, 67][index],
            level: index === 3 ? 'L2' : 'L3',
            method_version: 'fixture-v1',
            evidence_count: 3,
          },
          objective_measurement: {
            theta: 0.4,
            standard_error: 0.18,
            evidence_count: 2,
            level: 'L3',
          },
          rubric_measurement: {
            completed: 1,
            pending: 0,
            mean_score: 3,
            mean_confidence: 0.9,
            decisions: [
              {
                decision_id: 'decision-' + index,
                score: 3,
                confidence: 0.9,
                source: 'human',
                policy_version: 'fixture-v1',
                item_type: 'dialogue',
                tasks: [
                  {
                    id: 'task-' + index,
                    role: 'primary',
                    model: 'fixture-only',
                    prompt_version: 'fixture-v1',
                    result_hash: 'fixture-hash',
                    evidence: [
                      {
                        criterion_code: 'verification',
                        score: 3,
                        confidence: 0.9,
                        quote: '先限定研究对象、时间范围和来源类型，再交叉核验。',
                        rationale: '任务拆解完整；说明来源核验过程',
                        evidence_hash: 'evidence-' + index,
                        verified: true,
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      ]),
    ),
    recommendations: [
      {
        dimension_code: 'evaluation',
        action: '你能组织提示词完成任务；下一步练习来源追溯、交叉验证和不确定性表达。',
      },
    ],
    scoring_policy_version: 'fixture-v1',
  },
}
const blueprint = {
  id: 'blueprint',
  name: '高校AI能力标准测',
  mode: 'standard',
  scenario: 'higher_education',
  min_items: 12,
  max_items: 18,
  dimension_codes: codes,
  item_type_minimums: { objective: 6, dialogue: 6, practical: 1 },
}
const items = Array.from({ length: 18 }, (_, index) => ({
  item_version_id: 'item-' + index,
  sequence: index + 1,
  item_type: index < 6 ? 'objective' : index < 12 ? 'dialogue' : 'practical',
  dimension_code: codes[index % 6],
  answered_at: '2026-08-28T08:00:00Z',
  flagged: false,
}))
async function fixture(page: Page, options: { pdfFail?: boolean; answersFail?: boolean } = {}) {
  const writes: string[] = []
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => false })
  })
  await page.addInitScript(() => {
    sessionStorage.setItem(
      'zhijian-auth-session',
      JSON.stringify({ accessToken: 'reference-fixture', refreshToken: 'reference-fixture' }),
    )
  })
  await page.route('**/api/v1/**', async (route) => {
    if (await shellFixture(route, 'evaluator')) return
    const req = route.request(),
      path = new URL(req.url()).pathname
    if (req.method() !== 'GET') writes.push(path)
    if (path.endsWith('/auth/me'))
      return route.fulfill({
        json: {
          id: 'fixture-user',
          username: 'fixture',
          email: null,
          display_name: '林晓',
          is_active: true,
        },
      })
    if (path.endsWith('/assessment-definitions/launch-context'))
      return route.fulfill({
        json: {
          organizations: [{ id: 'org-1', name: 'AI Measure测评中心', role: 'learner' }],
          blueprints: [
            blueprint,
            {
              ...blueprint,
              id: 'rapid',
              name: 'AI能力极速测',
              mode: 'rapid',
              max_items: 12,
              item_type_minimums: { objective: 6, dialogue: 0, practical: 0 },
            },
          ],
          active_sessions: [
            {
              id: 'resume-session',
              organization_id: 'org-1',
              blueprint_version_id: 'blueprint',
              blueprint_name: 'AI能力标准测',
              mode: 'standard',
              scenario: 'higher_education',
              status: 'active',
              created_at: '2026-08-28T08:00:00Z',
            },
          ],
        },
      })
    if (path.endsWith('/workspace/overview'))
      return route.fulfill({
        json: {
          active_sessions: [
            {
              id: 'resume-session',
              name: 'AI能力标准测',
              mode: 'standard',
              scenario: 'higher_education',
              answered: 11,
              max_items: 18,
              last_saved_at: '2026-08-28T06:26:00Z',
              dimension_counts: {},
            },
          ],
        },
      })
    if (path.endsWith('/reports/' + session.id)) return route.fulfill({ json: report })
    if (path.endsWith('/sessions/' + session.id)) return route.fulfill({ json: session })
    if (path.endsWith('/training'))
      return route.fulfill({ json: { items: [], total: 0, limit: 1, offset: 0 } })
    if (path.endsWith('/workspace/features'))
      return route.fulfill({
        json: {
          training_enabled: true,
          training_content_status: 'formative_preview',
          growth_guide_mode: 'local_guidance',
          attachments_enabled: false,
        },
      })
    if (path.endsWith('/export.pdf'))
      return options.pdfFail
        ? route.fulfill({ status: 503, json: { detail: 'fixture export unavailable' } })
        : route.fulfill({
            contentType: 'application/pdf',
            body: '%PDF-1.4\n% isolated download transport fixture\n%%EOF',
          })
    if (path.endsWith('/sessions/' + session.id + '/workspace'))
      return options.answersFail
        ? route.fulfill({ status: 403, json: { detail: '无权读取' } })
        : route.fulfill({ json: { session, items, answered_count: 18, max_items: 18 } })
    if (path.endsWith('/review'))
      return route.fulfill({
        json: {
          item: {
            session_id: session.id,
            item_version_id: 'item-0',
            sequence: 1,
            item_type: 'objective',
            dimension_code: 'foundations',
            difficulty: 0,
            stem: '如何核验AI回答？',
            configuration: { options: ['直接采用', '交叉核验'] },
          },
          response: { selected_option: '交叉核验' },
          dialogue_turns: [],
          draft: null,
          answered_at: '2026-08-28T08:00:00Z',
          read_only: true,
        },
      })
    if (path.endsWith('/sessions') && req.method() === 'POST')
      return route.fulfill({ status: 409, json: { detail: '测试会话创建冲突，请保持方案后重试' } })
    return route.fulfill({ status: 404, json: { detail: 'not available in isolated fixture' } })
  })
  return writes
}

test('reference launcher has independent cards, real mode changes, progress and guarded start', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1650, height: 1100 })
  const writes = await fixture(page)
  await page.goto('/assessment')
  await expect(page.getByRole('heading', { name: '选择测评方式' })).toBeVisible()
  await expect(page.getByText('已答 11 题')).toBeVisible()
  await expect(page.locator('.mode-card')).toHaveCount(4)
  await page.screenshot({ path: info.outputPath('launcher-reference.png'), fullPage: true })
  await captureGeometry(page, info.outputPath('launcher-geometry.json'), [
    '.resume-strip',
    '.mode-grid',
    '.configuration-card',
    '.launch-preview',
  ])
  const cards = await page.locator('.mode-card').evaluateAll((nodes) =>
    nodes.map((node) => {
      const r = node.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    }),
  )
  expect(cards[1]!.x).toBeGreaterThan(cards[0]!.x + cards[0]!.width + 20)
  expect(Math.abs(cards[0]!.y - cards[3]!.y)).toBeLessThan(2)
  await page.getByRole('button', { name: /01.*极速测/ }).click()
  await expect(page.getByTestId('launch-blueprint')).toHaveValue('rapid')
  await expect(page.locator('.launch-preview h2')).toHaveText('AI能力极速测')
  await page.getByRole('button', { name: /03.*专项测/ }).click()
  await expect(page.getByTestId('start-assessment')).toBeDisabled()
  await expect(page.locator('.launch-preview h2')).toContainText('暂无可开始')
  await page.getByRole('button', { name: /02.*标准测/ }).click()
  await page.getByTestId('start-assessment').click()
  await expect(page.getByRole('alert')).toContainText('测试会话创建冲突')
  expect(writes).toEqual(['/api/v1/sessions'])
})

test('report reference exposes interactive evidence, readonly answers, PDF sharing and training', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1760, height: 1174 })
  const writes = await fixture(page)
  await page.goto('/reports/' + session.id)
  await expect(page.getByRole('heading', { name: 'AI能力标准测报告' })).toBeVisible()
  await expect(page.getByRole('link', { name: '生成专项训练计划' })).toBeVisible()
  await page.screenshot({ path: info.outputPath('report-reference.png'), fullPage: true })
  await captureGeometry(page, info.outputPath('report-geometry.json'), [
    '.report-summary',
    '.profile-card',
    '.priority-card',
    '.report-evidence',
    '.learning-card',
  ])
  await page.getByRole('button', { name: '查看证据', exact: true }).first().click()
  await expect(page.getByRole('dialog', { name: '只读证据详情' })).toContainText('任务拆解完整')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '评分过程', exact: true }).click()
  await expect(page.getByText('评分策略：fixture-v1')).toBeVisible()
  await page.getByRole('button', { name: '全部回答 18', exact: true }).click()
  await expect(page.locator('.report-evidence tbody tr')).toHaveCount(6)
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  await expect(page.getByRole('navigation', { name: '回答分页' })).toContainText('2 / 3')
  await page.getByRole('button', { name: '上一页', exact: true }).click()
  await page.getByRole('button', { name: '查看原回答', exact: true }).first().click()
  await expect(page.getByRole('dialog')).toContainText('交叉核验')
  await expect(page.getByRole('dialog').locator('textarea,input')).toHaveCount(0)
  await page.getByRole('button', { name: '关闭证据详情' }).click()
  await page.getByRole('button', { name: '分享报告', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '分享报告' })).toContainText('不会自动创建公开链接')
  await page.getByRole('button', { name: '确认并准备PDF' }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载PDF后分享' }).click()
  expect((await download).suggestedFilename()).toBe('AI-Measure-report.pdf')
  await page.getByRole('button', { name: '关闭分享' }).click()
  await page.getByRole('button', { name: '查看计划生成条件' }).click()
  await expect(page.getByRole('dialog', { name: '提升建议与训练条件' })).toContainText('指数低于50')
  await page.getByRole('button', { name: '关闭提升建议' }).click()
  await page.getByRole('link', { name: '生成专项训练计划' }).click()
  await expect(page).toHaveURL(/\/training\?report=reference-report/)
  expect(writes).toEqual([])
})

test('report failures offer retry without publishing or replacing data', async ({ page }) => {
  await fixture(page, { pdfFail: true, answersFail: true })
  await page.goto('/reports/' + session.id)
  await page.getByRole('button', { name: '全部回答 18', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('无权读取')
  await page.getByRole('button', { name: '重新读取回答' }).click()
  await expect(page.getByRole('alert')).toContainText('无权读取')
  await page.getByRole('button', { name: '导出PDF', exact: true }).click()
  await expect(page.locator('.inline-error')).toHaveText('报告PDF导出失败。')
})

for (const width of [1440, 1920, 1024, 390])
  test('two reference pages remain operable at ' + width, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 1100 })
    await fixture(page)
    for (const url of ['/assessment', '/reports/' + session.id]) {
      await page.goto(url)
      await expect(page.locator('h1')).toBeVisible()
      await page.screenshot({
        path: info.outputPath((url === '/assessment' ? 'launcher-' : 'report-') + width + '.png'),
        fullPage: true,
      })
      const overflow = await page.evaluate(() =>
        Array.from(document.querySelectorAll('*'))
          .filter((el) => el.getBoundingClientRect().right > innerWidth + 1)
          .slice(0, 25)
          .map((el) => ({
            tag: el.tagName,
            cls: el.className,
            right: el.getBoundingClientRect().right,
            width: el.getBoundingClientRect().width,
          })),
      )
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        JSON.stringify(overflow),
      ).toBe(true)
    }
    await page.getByRole('button', { name: '全部回答 18', exact: true }).click()
    await page.getByRole('button', { name: '查看原回答', exact: true }).first().click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('button', { name: '关闭证据详情' }).click()
  })

test('native sharing cancellation is recoverable and never publishes a link', async ({ page }) => {
  const writes = await fixture(page)
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true })
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async () => {
        throw new DOMException('cancelled', 'AbortError')
      },
    })
  })
  await page.goto('/reports/' + session.id)
  await page.getByRole('button', { name: '分享报告', exact: true }).click()
  await page.getByRole('button', { name: '确认并准备PDF' }).click()
  await page.getByRole('button', { name: '选择接收人分享' }).click()
  await expect(page.getByRole('dialog', { name: '分享报告' })).toContainText(
    '已取消分享，文件未公开。',
  )
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '仅下载PDF' }).click()
  expect((await download).suggestedFilename()).toBe('AI-Measure-report.pdf')
  expect(writes).toEqual([])
})

test('submitted practical process and private file are accessible without editing', async ({
  page,
}) => {
  const writes = await fixture(page)
  await page.route('**/api/v1/sessions/reference-session/items/item-12/review', (route) =>
    route.fulfill({
      json: {
        item: {
          session_id: session.id,
          item_version_id: 'item-12',
          sequence: 13,
          item_type: 'practical',
          dimension_code: 'evaluation',
          stem: '核验材料',
          configuration: {},
        },
        response: { final_output: '核验后的结论', reflection: '记录来源' },
        dialogue_turns: [],
        draft: null,
        answered_at: '2026-08-28T08:00:00Z',
        read_only: true,
      },
    }),
  )
  await page.route('**/api/v1/sessions/reference-session/practical/item-12', (route) =>
    route.fulfill({
      json: {
        state: 'submitted',
        can_edit: false,
        events: [
          {
            id: 'e1',
            sequence: 1,
            event_type: 'result_verification',
            payload: { source: '公开原始材料' },
          },
        ],
        interactions: [],
        artifacts: [
          {
            id: 'file-1',
            state: 'ready',
            filename: 'verification.txt',
            byte_size: 7,
            sha256: 'fixture-hash',
          },
        ],
      },
    }),
  )
  await page.route(
    '**/api/v1/sessions/reference-session/practical/item-12/artifacts/file-1',
    (route) => route.fulfill({ contentType: 'text/plain', body: 'checked' }),
  )
  await page.goto('/reports/' + session.id)
  await page.getByRole('button', { name: '全部回答 18', exact: true }).click()
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  await page.getByRole('button', { name: '查看原回答', exact: true }).first().click()
  await expect(page.getByRole('dialog')).toContainText('实操过程与文件 · 只读')
  await page.getByText('过程事件 1 项', { exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('公开原始材料')
  await expect(page.getByRole('dialog').locator('input,textarea')).toHaveCount(0)
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载文件', exact: true }).click()
  expect((await download).suggestedFilename()).toBe('verification.txt')
  expect(writes).toEqual([])
})
