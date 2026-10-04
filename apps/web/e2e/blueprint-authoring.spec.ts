import { expect, test } from '@playwright/test'
const DIMENSIONS = [
  { code: 'foundations', name: '基础认知' },
  { code: 'prompting', name: '提示词工程' },
  { code: 'tool_use', name: '工具使用' },
  { code: 'evaluation', name: '结果评估' },
  { code: 'collaboration', name: '人机协同' },
  { code: 'ethics', name: '伦理合规' },
]

// Browser-only synthetic fixtures. No real account, content or organization is mutated.
test('administrator can publish a selected question pool from the visible wizard', async ({
  page,
}, info) => {
  const errors: string[] = []
  const writes: Array<{ body: Record<string, unknown>; key: string | undefined }> = []
  const items = DIMENSIONS.map((dimension, i) => ({
    id: `00000000-0000-4000-8000-00000000000${i}`,
    stem: `界面验收 · ${dimension.name}题目`,
    dimension_code: dimension.code,
    item_type: 'objective',
    version: 1,
    bank_version: 'ui-fixture',
  }))
  const org = {
    id: '10000000-0000-4000-8000-000000000001',
    name: 'AI Measure',
    slug: 'ai-measure-platform',
    member_count: 2,
    experience_only: false,
    accepts_experience: true,
  }
  const identity = {
    id: '20000000-0000-4000-8000-000000000001',
    logical_id: 'test-plan',
    version: 1,
    publication_status: 'published',
  }
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() =>
    sessionStorage.setItem(
      'zhijian-auth-session',
      JSON.stringify({ accessToken: 'synthetic', refreshToken: 'synthetic' }),
    ),
  )
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '')
    let json: unknown = {}
    if (path === '/auth/me')
      json = { id: 'admin-fixture', display_name: '界面验收管理员', is_active: true }
    else if (path === '/workspace/access')
      json = {
        single_platform_enabled: true,
        organizations: [{ ...org, role: 'org_admin', capabilities: ['members'] }],
        global_capabilities: ['system', 'content'],
      }
    else if (path === '/health') json = { status: 'ok' }
    else if (path === '/workspace/features')
      json = { growth_guide_mode: 'local', assessment_active: false }
    else if (path.endsWith('/details')) json = { items: [], total: 0, limit: 20, offset: 0 }
    else if (path.endsWith('/blueprint-authoring/items')) {
      const params = new URL(route.request().url()).searchParams
      const types = params.getAll('item_types')
      const dimensions = params.getAll('dimensions')
      const filtered = items.filter(
        (item) =>
          (!types.length || types.includes(item.item_type)) &&
          (!dimensions.length || dimensions.includes(item.dimension_code)),
      )
      json = { items: filtered, total: filtered.length }
    } else if (path.endsWith('/blueprint-authoring/organizations'))
      json = { items: [org], total: 1 }
    else if (path.endsWith('/blueprint-authoring/preview'))
      json = {
        valid: true,
        issues: [],
        candidate_count: 6,
        dimensions: Object.fromEntries(DIMENSIONS.map((d) => [d.code, 1])),
        item_types: { objective: 6 },
      }
    else if (path.endsWith('/blueprint-authoring/publish')) {
      writes.push({
        body: route.request().postDataJSON(),
        key: route.request().headers()['idempotency-key'],
      })
      json = identity
    } else if (path.includes('/content/blueprints/'))
      json = {
        ...identity,
        name: '界面验收测评方案',
        configuration: {},
        approved_at: '2026-09-22T00:00:00Z',
        created_at: '2026-09-22T00:00:00Z',
        updated_at: '2026-09-22T00:00:00Z',
      }
    else {
      await route.fulfill({ status: 503, json: { detail: '其他服务未纳入本界面夹具' } })
      return
    }
    await route.fulfill({ json })
  })
  await page.goto('/item-bank?tab=blueprints')
  await expect(page.getByRole('button', { name: '新建测评方案', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '新建测评方案', exact: true }).click()
  await page.getByLabel('测评方案名称').fill('界面验收测评方案')
  await page.screenshot({ path: info.outputPath('blueprint-step1.png'), fullPage: true })
  await page.getByRole('button', { name: '下一步', exact: true }).click()
  await expect(page.getByText('界面验收 · 基础认知题目', { exact: true })).toBeVisible()
  await expect(page.getByText('已选 0 道 · 最多可选 1000 道')).toBeVisible()
  await page.locator('.filter-dropdown summary').first().click()
  await page.getByRole('group', { name: '题型（可多选）' }).getByLabel('客观题').check()
  await page.getByRole('group', { name: '题型（可多选）' }).getByLabel('对话题').check()
  await page.locator('.filter-dropdown summary').nth(1).click()
  await page.getByRole('group', { name: '能力维度（可多选）' }).getByLabel('基础认知').check()
  await page.getByRole('group', { name: '能力维度（可多选）' }).getByLabel('结果评估').check()
  await expect(page.locator('.picker-row')).toHaveCount(2)
  await page.getByRole('button', { name: '选中本页', exact: true }).click()
  await expect(page.getByText('已选 2 道 · 最多可选 1000 道')).toBeVisible()
  await page.screenshot({ path: info.outputPath('blueprint-multiselect.png'), fullPage: true })
  await page.getByRole('button', { name: '重置筛选', exact: true }).click()
  await expect(page.locator('.picker-row')).toHaveCount(6)
  await expect(page.getByText('已选 2 道 · 最多可选 1000 道')).toBeVisible()
  await page.getByLabel('最多题数').fill('6')
  await page.getByRole('button', { name: '选中本页' }).click()
  await page.screenshot({ path: info.outputPath('blueprint-step2.png'), fullPage: true })
  await page.getByRole('button', { name: '下一步', exact: true }).click()
  await expect(page.getByText('AI Measure 平台开放范围')).toBeVisible()
  await page.locator('.picker-row input').check()
  await page.getByRole('button', { name: '下一步', exact: true }).click()
  await expect(page.getByRole('button', { name: '确认创建并发布' })).toBeDisabled()
  await page.getByRole('button', { name: '检查题池与发布条件' }).click()
  await page.getByLabel('我已核对题目与规则').check()
  await page.screenshot({ path: info.outputPath('blueprint-step4.png'), fullPage: true })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2)
  expect(overflow).toBe(false)
  await page.getByRole('button', { name: '确认创建并发布' }).click()
  await expect(page.getByText('测评方案已发布！', { exact: false })).toBeVisible()
  expect(writes).toHaveLength(1)
  expect(writes[0]?.body.item_ids).toEqual(items.map((item) => item.id))
  expect(writes[0]?.body.organization_ids).toEqual([org.id])
  expect(writes[0]?.key).toBeTruthy()
  expect(errors).toEqual([])
})
