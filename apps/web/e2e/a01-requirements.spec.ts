import { expect, test, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { shellFixture } from './shell-fixture'

// Browser-only synthetic fixtures. They are not real learner measurements.
async function authenticated(page: Page) {
  await page.addInitScript(() =>
    sessionStorage.setItem(
      'zhijian-auth-session',
      JSON.stringify({
        accessToken: 'a01-synthetic-browser',
        refreshToken: 'a01-synthetic-refresh',
      }),
    ),
  )
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/auth/me'))
      return route.fulfill({
        json: {
          id: 'synthetic-user',
          display_name: '合成验收用户',
          email: null,
          is_active: true,
        },
      })
    if (path.endsWith('/workspace/access'))
      return route.fulfill({
        json: {
          organizations: [
            { id: 'synthetic-org', name: '隔离浏览器验收', role: 'learner', capabilities: [] },
          ],
          global_capabilities: ['content'],
        },
      })
    if (path.endsWith('/health')) return route.fulfill({ json: { status: 'ok' } })
    return route.fulfill({ json: { items: [], total: 0, limit: 20, offset: 0 } })
  })
}

test('administrator creates a labeled draft without publishing', async ({ page }, info) => {
  await authenticated(page)
  const writes: Record<string, unknown>[] = []
  const identity = {
    id: 'draft-item',
    logical_id: 'logical-item',
    version: 1,
    publication_status: 'draft',
  }
  await page.route('**/api/v1/admin/items', async (route) => {
    writes.push(route.request().postDataJSON())
    await route.fulfill({ status: 201, json: identity })
  })
  await page.route('**/api/v1/admin/content/items/draft-item', async (route) =>
    route.fulfill({
      json: {
        ...identity,
        stem: '合成验收题：面对无来源的AI结论应如何核验？',
        dimension_code: 'evaluation',
        item_type: 'objective',
        difficulty: 0,
        configuration: {},
        answer_key: {},
      },
    }),
  )
  await page.goto('/item-bank')
  await page.getByTestId('new-item').click()
  await page.getByTestId('item-stem').fill('合成验收题：面对无来源的AI结论应如何核验？')
  await page.getByTestId('item-tags').fill('来源核验, 证据')
  await page.getByTestId('item-options').fill('核对独立原始来源\n直接相信')
  await page.getByTestId('item-answer').selectOption('核对独立原始来源')
  await page.getByRole('button', { name: '保存为新草稿' }).click()
  await expect(page.getByText(/已保存 v1 草稿/)).toBeVisible()
  expect(writes).toHaveLength(1)
  expect(writes[0]?.configuration).toMatchObject({
    metadata: {
      tags: ['来源核验', '证据'],
      content_tier: 'basic',
      scenarios: ['general'],
    },
  })
  await page.screenshot({ path: info.outputPath('item-draft.png'), fullPage: true })
})

test('history draws only within the selected comparable group', async ({ page }, info) => {
  await authenticated(page)
  const group = {
    dimension_code: 'evaluation',
    construct: 'objective',
    method_version: 'rasch-v1',
    scoring_policy_version: null,
    blueprint_version: 1,
    blueprint_version_id: 'synthetic-blueprint',
    mode: 'standard',
    scenario: 'higher_education',
    points: [
      {
        report_id: 'r1',
        session_id: 's1',
        completed_at: '2026-08-01T08:00:00Z',
        index: 51,
        level: 'L2',
        evidence_count: 3,
        revision: 1,
      },
      {
        report_id: 'r2',
        session_id: 's2',
        completed_at: '2026-09-01T08:00:00Z',
        index: 68,
        level: 'L3',
        evidence_count: 3,
        revision: 1,
      },
    ],
  }
  await page.route('**/api/v1/workspace/trends?**', async (route) =>
    route.fulfill({
      json: {
        groups: [
          group,
          {
            ...group,
            blueprint_version: 2,
            blueprint_version_id: 'second-version',
            points: [group.points[1]],
          },
        ],
        total: 3,
        limit: 100,
        offset: 0,
      },
    }),
  )
  await page.goto('/history')
  await expect(page.getByRole('heading', { name: '个人成长趋势' })).toBeVisible()
  await expect(page.getByTestId('trend-point')).toHaveCount(2)
  await expect(page.getByTestId('trend-line')).toHaveCount(1)
  await page.getByTestId('trend-group').selectOption('1')
  await expect(page.getByTestId('trend-point')).toHaveCount(1)
  await expect(page.getByTestId('trend-line')).toHaveCount(0)
  await expect(page.getByText(/只有一次有效记录/)).toBeVisible()
  await page.screenshot({ path: info.outputPath('comparable-trend.png'), fullPage: true })
})

test('learner image stimulus is actually loaded from the bundled asset', async ({ page }, info) => {
  await authenticated(page)
  const stimulus = {
    session_id: 'synthetic-session',
    item_version_id: 'stimulus-item',
    sequence: 1,
    item_type: 'objective',
    dimension_code: 'evaluation',
    difficulty: 0.8,
    stem: '请检查图中标题是否得到数据支持。此图仅为合成测试材料。',
    configuration: {
      options: ['不支持', '支持'],
      media: {
        images: [
          {
            src: '/assessment-media/evidence-chart.svg',
            alt: '培训前70分、培训后77分的待核验柱状图',
          },
        ],
      },
    },
  }
  const session = {
    id: 'synthetic-session',
    organization_id: 'synthetic-org',
    blueprint_version_id: 'synthetic-blueprint',
    status: 'active',
    mode: 'standard',
    scenario: 'higher_education',
    created_at: '2026-09-15T08:00:00Z',
    completed_at: null,
    expires_at: null,
    ended_at: null,
    ended_reason: null,
    blueprint_snapshot: {
      name: '图像题合成验收',
      configuration: { min_items: 12, max_items: 18 },
    },
  }
  await page.route('**/api/v1/sessions/synthetic-session', async (route) =>
    route.fulfill({ json: session }),
  )
  await page.route('**/api/v1/sessions/synthetic-session/workspace', async (route) =>
    route.fulfill({
      json: {
        session,
        server_now: '2026-09-15T08:00:01Z',
        blueprint_name: session.blueprint_snapshot.name,
        min_items: 12,
        max_items: 18,
        answered_count: 0,
        dispatched_count: 1,
        flagged_count: 0,
        current_item: stimulus,
        items: [
          {
            item_version_id: stimulus.item_version_id,
            sequence: 1,
            item_type: 'objective',
            dimension_code: 'evaluation',
            answered_at: null,
            flagged: false,
          },
        ],
        type_coverage: [
          { item_type: 'objective', answered_count: 0, minimum: 6 },
          { item_type: 'dialogue', answered_count: 0, minimum: 4 },
          { item_type: 'practical', answered_count: 0, minimum: 2 },
        ],
        can_complete: false,
        completion_reason: 'minimum_items',
        unmet_dimensions: ['evaluation'],
        unmet_item_types: ['objective', 'dialogue', 'practical'],
      },
    }),
  )
  await page.route('**/api/v1/sessions/synthetic-session/next', async (route) =>
    route.fulfill({ json: stimulus }),
  )
  await page.route(
    '**/api/v1/sessions/synthetic-session/items/stimulus-item/draft',
    async (route) => route.fulfill({ json: { draft: null, context_revision: 0, can_edit: true } }),
  )
  await page.goto('/assessment/synthetic-session')
  const image = page.getByRole('img', { name: '培训前70分、培训后77分的待核验柱状图' })
  await expect(image).toBeVisible()
  await expect(image).toHaveJSProperty('naturalWidth', 840)
  await expect(page.getByRole('button', { name: '提交回答并继续' })).toBeVisible()
  await page.screenshot({ path: info.outputPath('image-stimulus.png'), fullPage: true })
})

test('evaluator reads frozen practical materials and downloads the authorized image', async ({
  page,
}, info) => {
  await authenticated(page)
  // A one-pixel synthetic PNG, never a participant's private artifact.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=',
    'base64',
  )
  const artifact = {
    id: 'artifact-1',
    filename: 'synthetic.png',
    media_type: 'image/png',
    byte_size: png.length,
    sha256: createHash('sha256').update(png).digest('hex'),
  }
  let resolved = false
  let fileAuthorization = ''
  await page.route('**/api/v1/**', async (route) => {
    if (await shellFixture(route, 'evaluator')) return
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/auth/me'))
      return route.fulfill({
        json: { id: 'reviewer', display_name: '合成复核员', is_active: true },
      })
    if (path.endsWith('/launch-context'))
      return route.fulfill({
        json: {
          organizations: [{ id: 'org-1', name: '合成复核组织', role: 'evaluator' }],
          active_sessions: [],
          blueprints: [],
        },
      })
    if (path.endsWith('/admin/reviews'))
      return route.fulfill({
        json: resolved
          ? []
          : [
              {
                decision_id: 'decision-1',
                session_id: 'session-1',
                item_type: 'practical',
                dimension_code: 'evaluation',
                provisional_score: null,
                review_reasons: ['image_not_visually_read'],
              },
            ],
      })
    if (path.endsWith('/decision-1/materials'))
      return route.fulfill({
        json: {
          events: [
            {
              source_id: 'event-1',
              sequence: 1,
              event_type: 'result_verification',
              payload: { method: '人工核对合成图片' },
              occurred_at: '2026-09-15T01:00:00Z',
            },
          ],
          interactions: [],
          next_event_after: null,
          next_interaction_after: null,
          artifact,
        },
      })
    if (path.endsWith('/artifacts/artifact-1')) {
      fileAuthorization = route.request().headers()['authorization'] ?? ''
      return route.fulfill({
        contentType: 'image/png',
        headers: {
          'X-Artifact-SHA256': artifact.sha256,
          'Access-Control-Expose-Headers': 'X-Artifact-SHA256',
        },
        body: png,
      })
    }
    if (path.endsWith('/decision-1/resolve')) {
      resolved = true
      return route.fulfill({ json: { review_id: 'review-1', state: 'completed', final_score: 3 } })
    }
    if (path.endsWith('/decision-1'))
      return route.fulfill({
        json: {
          decision_id: 'decision-1',
          state: 'needs_review',
          provisional_score: null,
          final_score: null,
          confidence: null,
          final_source: null,
          review_reasons: ['image_not_visually_read'],
          answer: { final_output: '这是合成的核验结论。' },
          item: {
            id: 'item-1',
            stem: '检查图片产物及核验过程（合成验收）',
            item_type: 'practical',
            dimension_code: 'evaluation',
          },
          rubric: {
            id: 'rubric-1',
            version: 1,
            title: '核验量规',
            criteria: {
              criteria: [{ code: 'verification', levels: { '0': '无证据', '4': '完整且可复核' } }],
            },
          },
          tasks: [],
        },
      })
    return route.fulfill({ status: 404, json: { detail: 'not mocked' } })
  })
  await page.goto('/reviews')
  await expect(page.getByText('封存过程材料已全部读取')).toBeVisible()
  await expect(page.getByText('人工核对合成图片')).toBeVisible()
  await page.getByText('查看冻结评分量规与 0–4 分行为锚点').click()
  await expect(page.getByText('完整且可复核', { exact: false })).toBeVisible()
  await page.getByTestId('review-artifact-load').click()
  const image = page.getByRole('img', { name: '学员提交的产物：synthetic.png' })
  await expect(image).toHaveJSProperty('naturalWidth', 1)
  expect(fileAuthorization).toContain('Bearer ')
  const downloaded = page.waitForEvent('download')
  await page.getByRole('link', { name: '下载 synthetic.png' }).click()
  expect((await downloaded).suggestedFilename()).toBe('synthetic.png')
  await page.screenshot({ path: info.outputPath('practical-review.png'), fullPage: true })
  await page.getByTestId('review-score').fill('3')
  await page.getByTestId('review-rationale').fill('依据冻结量规核对过程与实际图片。')
  await page.getByTestId('review-evidence').fill('event-1，synthetic.png；仅合成验收。')
  await page.getByTestId('resolve-review').click()
  await expect(page.getByText('最终评分已封存')).toBeVisible()
  await expect(image).toHaveCount(0)
})
