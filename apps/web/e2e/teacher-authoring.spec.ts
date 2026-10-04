import { expect, test, type Page, type TestInfo } from '@playwright/test'
import type { ContentRecord, CreateItemRequest } from '../src/services/contentApi'
import type { ContentAssignment } from '../src/services/authoringApi'
import { assistantFeatures } from './shell-fixture'

/** Synthetic route fixtures only: no real accounts, question bank data, or API/DB writes. */
const teacherId = 'd0000000-0000-4000-8000-000000000001'
const adminId = 'd0000000-0000-4000-8000-000000000002'
const organizationId = 'd0000000-0000-4000-8000-000000000003'
const itemId = 'd1000000-0000-4000-8000-000000000001'
const successorId = 'd1000000-0000-4000-8000-000000000002'
const logicalId = 'd1000000-0000-4000-8000-000000000003'
const fixedDate = '2026-09-15T06:00:00Z'
type Write = { method: string; path: string; body: unknown; key?: string }

async function syntheticAuthoring(page: Page, role: 'teacher' | 'admin') {
  const writes: Write[] = [],
    reads: string[] = [],
    unmatched: string[] = [],
    pageErrors: string[] = []
  const original: ContentRecord = {
    id: itemId,
    logical_id: logicalId,
    version: 1,
    publication_status: 'published',
    created_at: fixedDate,
    updated_at: fixedDate,
    approved_at: fixedDate,
    approved_by: adminId,
    stem: '合成指派题：如何验证 AI 给出的研究结论？',
    dimension_code: 'evaluation',
    item_type: 'objective',
    difficulty: 0.2,
    configuration: {
      options: ['核对原始出处', '直接采用'],
      fixture_note: '合成数据，非正式题目',
      metadata: { tags: ['来源核验'], scenarios: ['higher_education'], content_tier: 'basic' },
    },
    answer_key: { correct_option: '核对原始出处' },
    rubric_version_id: null,
  }
  const items = [original]
  const assignments: ContentAssignment[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.addInitScript(() =>
    sessionStorage.setItem(
      'zhijian-auth-session',
      JSON.stringify({
        accessToken: 'synthetic-authoring-access',
        refreshToken: 'synthetic-authoring-refresh',
      }),
    ),
  )
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname.replace('/api/v1', '')
    const method = request.method(),
      body: unknown = request.postData() ? request.postDataJSON() : null
    if (method === 'GET') reads.push(path)
    else writes.push({ method, path, body, key: request.headers()['idempotency-key'] })
    let response: unknown,
      status = 200
    if (path === '/health') response = { status: 'ok' }
    else if (path === '/workspace/features') response = assistantFeatures
    else if (path === '/auth/me')
      response = {
        id: role === 'teacher' ? teacherId : adminId,
        username: `synthetic-${role}`,
        email: null,
        display_name: role === 'teacher' ? '合成指派教师' : '合成系统管理员',
        is_active: true,
      }
    else if (path === '/workspace/access')
      response = {
        organizations: [
          {
            id: organizationId,
            name: '合成出题验收组织',
            role: 'learner',
            capabilities: ['pilot_participate'],
          },
        ],
        global_capabilities: role === 'teacher' ? ['content_author'] : ['content', 'system', 'cat'],
      }
    else if (path === '/teacher/items/details' && method === 'GET' && role === 'teacher') {
      const filter = url.searchParams.get('publication_status')
      const matching = items.filter((item) => !filter || item.publication_status === filter)
      response = { items: matching, total: matching.length, limit: 20, offset: 0 }
    } else if (
      path === `/teacher/items/${itemId}/versions` &&
      method === 'POST' &&
      role === 'teacher'
    ) {
      const input = body as Omit<CreateItemRequest, 'logical_id'>
      const successor: ContentRecord = {
        ...original,
        ...input,
        id: successorId,
        version: 2,
        publication_status: 'draft',
        approved_at: null,
        approved_by: null,
      }
      items.push(successor)
      response = successor
      status = 201
    } else if (
      path === `/teacher/items/${successorId}/submit` &&
      method === 'POST' &&
      role === 'teacher'
    ) {
      const successor = items.find((item) => item.id === successorId)!
      successor.publication_status = 'in_review'
      response = successor
    } else if (path.startsWith('/teacher/items/') && method === 'GET' && role === 'teacher') {
      const item = items.find((item) => path === `/teacher/items/${item.id}`)
      if (item) response = item
      else {
        unmatched.push(`${method} ${path}`)
        status = 404
        response = { detail: '合成指派范围外' }
      }
    } else if (path === '/admin/content/items/details' && method === 'GET' && role === 'admin')
      response = { items, total: items.length, limit: 20, offset: 0 }
    else if (path === `/admin/content/items/${itemId}` && method === 'GET' && role === 'admin')
      response = original
    else if (path === `/admin/items/${itemId}/assignments` && method === 'GET' && role === 'admin')
      response = assignments
    else if (
      path === `/admin/items/${itemId}/assignments/${teacherId}` &&
      method === 'PUT' &&
      role === 'admin'
    ) {
      const active = (body as { active: boolean }).active
      let assignment = assignments.find((item) => item.user_id === teacherId)
      if (!assignment) {
        assignment = {
          id: 'd2000000-0000-4000-8000-000000000001',
          user_id: teacherId,
          display_name: '合成指派教师',
          item_logical_id: logicalId,
          active,
          assigned_by: adminId,
          created_at: fixedDate,
          updated_at: fixedDate,
        }
        assignments.push(assignment)
      }
      assignment.active = active
      response = assignment
    } else {
      unmatched.push(`${method} ${path}`)
      status = 404
      response = { detail: '未定义的合成请求，禁止穿透真实 API' }
    }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(response) })
  })
  return { writes, reads, unmatched, pageErrors, original }
}

async function capture(page: Page, info: TestInfo, name: string) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true)
  await page.screenshot({
    path: info.outputPath(`${name}.png`),
    fullPage: true,
    animations: 'disabled',
  })
}

test('assigned teacher edits a successor, labels it and separately submits review without admin APIs', async ({
  page,
}, info) => {
  const fixture = await syntheticAuthoring(page, 'teacher')
  await page.goto('/authoring')
  await expect(page.getByRole('heading', { name: '我的出题任务', exact: true })).toBeVisible()
  await expect(page.getByTestId('author-detail')).toHaveCount(1)
  await expect(page.getByRole('link', { name: '题库与量规', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /新建题目|审核并发布/ })).toHaveCount(0)
  await page.getByTestId('author-detail').click()
  await page.getByTestId('author-edit').click()
  await page.getByTestId('item-stem').fill('合成教师修订：如何交叉验证 AI 给出的结论？')
  await page.getByTestId('item-tags').fill('来源核验, 交叉验证')
  await page.getByRole('combobox', { name: '能力维度', exact: true }).selectOption('prompting')
  await page.getByRole('spinbutton', { name: '测量难度（−4～4）', exact: true }).fill('0.8')
  await page.getByRole('button', { name: '保存为新草稿', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '已保存 v2 草稿' })).toBeVisible()
  await expect(page.getByTestId('author-submit')).toBeVisible()
  expect(fixture.writes).toHaveLength(1)
  expect(fixture.writes[0]).toMatchObject({
    method: 'POST',
    path: `/teacher/items/${itemId}/versions`,
    body: {
      stem: '合成教师修订：如何交叉验证 AI 给出的结论？',
      dimension_code: 'prompting',
      difficulty: 0.8,
      configuration: { metadata: { tags: ['来源核验', '交叉验证'] } },
    },
  })
  expect(fixture.writes[0]?.body).not.toHaveProperty('logical_id')
  expect(fixture.writes[0]?.key).toMatch(/^item-version-/)
  await page.getByTestId('author-submit').click()
  expect(fixture.writes).toHaveLength(1)
  await page.getByTestId('confirm-author-submit').click()
  await expect(page.getByRole('status').filter({ hasText: '已提交审核' })).toBeVisible()
  expect(fixture.writes[1]).toMatchObject({
    method: 'POST',
    path: `/teacher/items/${successorId}/submit`,
    body: null,
  })
  await expect(page.getByTestId('author-submit')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /发布/ })).toHaveCount(0)
  expect(
    fixture.reads
      .concat(fixture.writes.map((write) => write.path))
      .some((path) => path.startsWith('/admin/')),
  ).toBe(false)
  expect(fixture.unmatched).toEqual([])
  expect(fixture.pageErrors).toEqual([])
  await capture(page, info, 'synthetic-teacher-submitted')
})

test('administrator explicitly confirms assignment and revocation of an existing account', async ({
  page,
}, info) => {
  const fixture = await syntheticAuthoring(page, 'admin')
  await page.goto('/item-bank')
  await page.getByRole('button', { name: '查看详情', exact: true }).click()
  await page.getByTestId('assignment-user').fill(teacherId)
  await page.getByRole('button', { name: '指派维护', exact: true }).click()
  expect(fixture.writes).toHaveLength(0)
  await page.getByTestId('confirm-assignment').click()
  await expect(page.getByTestId('revoke-assignment')).toBeVisible()
  expect(fixture.writes[0]).toMatchObject({
    method: 'PUT',
    path: `/admin/items/${itemId}/assignments/${teacherId}`,
    body: { active: true },
  })
  expect(fixture.writes[0]?.key).toMatch(/^item-assignment-/)
  await page.getByTestId('revoke-assignment').click()
  expect(fixture.writes).toHaveLength(1)
  await page.getByTestId('confirm-assignment').click()
  await expect(page.getByTestId('restore-assignment')).toBeVisible()
  expect(fixture.writes[1]).toMatchObject({
    method: 'PUT',
    path: `/admin/items/${itemId}/assignments/${teacherId}`,
    body: { active: false },
  })
  expect(fixture.unmatched).toEqual([])
  expect(fixture.pageErrors).toEqual([])
  await capture(page, info, 'synthetic-admin-revoked')
})

test('390px assigned author detail and editor contain their own horizontal content', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const fixture = await syntheticAuthoring(page, 'teacher')
  await page.goto('/authoring')
  await page.getByTestId('author-detail').click()
  await expect(page.getByTestId('author-edit')).toBeVisible()
  await capture(page, info, 'synthetic-authoring-390-detail')
  await page.getByTestId('author-edit').click()
  await expect(page.getByTestId('item-stem')).toBeVisible()
  await capture(page, info, 'synthetic-authoring-390-editor')
  expect(fixture.unmatched).toEqual([])
  expect(fixture.pageErrors).toEqual([])
})
