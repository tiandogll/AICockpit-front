import { expect, test, type Page, type TestInfo } from '@playwright/test'
import type { ContentKind, ContentRecord } from '../src/services/contentApi'
import type { CohortOption, OrganizationMember } from '../src/services/adminWorkspaceApi'
import { assistantFeatures } from './shell-fixture'

/** Route-only synthetic acceptance data. These are not real accounts, outcomes or audit events. */
const organizationId = 'c0000000-0000-4000-8000-000000000001'
const actorId = 'c0000000-0000-4000-8000-000000000002'
const learnerId = 'c0000000-0000-4000-8000-000000000003'
const addedUserId = 'c0000000-0000-4000-8000-000000000004'
const cohortId = 'c0000000-0000-4000-8000-000000000005'
const newCohortId = 'c0000000-0000-4000-8000-000000000006'
const organizationName = 'AI Measure 管理界面验收合成组织'
const fixedDate = '2026-09-14T06:20:00Z'
type CapturedRequest = { method: string; path: string; body: unknown; key: string | undefined }

async function adminFixtures(page: Page, options: { noOrganization?: boolean } = {}) {
  const writes: CapturedRequest[] = []
  const reads: string[] = []
  const unmatched: string[] = []
  const pageErrors: string[] = []
  const members: OrganizationMember[] = [
    {
      membership_id: 'membership-admin',
      user_id: actorId,
      display_name: '验收管理员（合成）',
      email: 'synthetic-admin@example.test',
      role: 'org_admin',
      is_active: true,
    },
    {
      membership_id: 'membership-learner',
      user_id: learnerId,
      display_name: '验收学员（合成）',
      email: 'synthetic-learner@example.test',
      role: 'learner',
      is_active: true,
    },
  ]
  const cohorts: CohortOption[] = [
    {
      id: cohortId,
      organization_id: organizationId,
      name: '合成验收班级',
      kind: 'class',
      code: 'synthetic_class',
      is_active: true,
      member_count: 1,
    },
  ]
  const common = {
    version: 1,
    created_at: fixedDate,
    updated_at: fixedDate,
    approved_at: null,
    approved_by: null,
  }
  const content: Record<ContentKind, ContentRecord> = {
    items: {
      ...common,
      id: 'c1000000-0000-4000-8000-000000000001',
      logical_id: 'c1000000-0000-4000-8000-000000000002',
      publication_status: 'draft',
      stem: '合成题目：识别需要独立核验的 AI 结论',
      dimension_code: 'evaluation',
      item_type: 'objective',
      difficulty: 0.4,
      configuration: {
        options: ['A：检查原始来源', 'B：只相信流畅表达'],
        fixture_note: '仅用于界面验收',
      },
      answer_key: { correct_option: 'A', fixture_note: '合成答案，不来自正式题库' },
      rubric_version_id: null,
    },
    rubrics: {
      ...common,
      id: 'c2000000-0000-4000-8000-000000000001',
      logical_id: 'c2000000-0000-4000-8000-000000000002',
      publication_status: 'published',
      approved_at: fixedDate,
      approved_by: actorId,
      title: '合成量规：来源核验过程',
      criteria: {
        criteria: [{ code: 'source_check', description: '界面验收合成准则', max_score: 4 }],
      },
    },
    blueprints: {
      ...common,
      id: 'c3000000-0000-4000-8000-000000000001',
      logical_id: 'c3000000-0000-4000-8000-000000000002',
      publication_status: 'in_review',
      name: '合成蓝图：高校标准测评',
      mode: 'standard',
      scenario: 'higher_education',
      configuration: {
        dimensions: { evaluation: 2, prompting: 2 },
        min_items: 4,
        max_items: 4,
        fixture_note: '界面验收合成配置',
      },
    },
  }
  const counts = {
    answers: 4,
    dialogue_turns: 2,
    practical_events: 3,
    ai_interactions: 2,
    artifacts: 1,
    scoring_tasks: 2,
    scoring_evidence: 2,
    human_reviews: 0,
    expert_ratings: 0,
  }
  let privacyExecutionCount = 0
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.addInitScript(() =>
    sessionStorage.setItem(
      'zhijian-auth-session',
      JSON.stringify({
        accessToken: 'synthetic-admin-access',
        refreshToken: 'synthetic-admin-refresh',
      }),
    ),
  )
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname.replace('/api/v1', '')
    const method = request.method()
    const body: unknown = request.postData() ? request.postDataJSON() : null
    if (method === 'GET') reads.push(path)
    else writes.push({ method, path, body, key: request.headers()['idempotency-key'] })
    let response: unknown
    let status = 200
    if (path === '/health') response = { status: 'ok' }
    else if (path === '/workspace/features') response = assistantFeatures
    else if (path === '/auth/me')
      response = {
        id: actorId,
        email: 'synthetic-admin@example.test',
        display_name: '验收管理员（合成）',
        is_active: true,
      }
    else if (path === '/workspace/access')
      response = {
        organizations: options.noOrganization
          ? []
          : [
              {
                id: organizationId,
                name: organizationName,
                role: 'org_admin',
                capabilities: [
                  'analytics',
                  'members',
                  'governance',
                  'reviews',
                  'pilots_manage',
                  'pilot_participate',
                ],
              },
            ],
        global_capabilities: ['system', 'content', 'cat'],
      }
    else if (path === `/organizations/${organizationId}/members` && method === 'GET')
      response = members
    else if (path === `/organizations/${organizationId}/members` && method === 'POST') {
      const input = body as { user_id: string; role: OrganizationMember['role'] }
      response = {
        membership_id: 'membership-added',
        user_id: input.user_id,
        display_name: '新加入学员（合成）',
        email: 'synthetic-added@example.test',
        role: input.role,
        is_active: true,
      }
      members.push(response as OrganizationMember)
      status = 201
    } else if (
      path === `/organizations/${organizationId}/members/${learnerId}` &&
      method === 'PATCH'
    ) {
      const member = members.find((row) => row.user_id === learnerId)!
      member.role = (body as { role: OrganizationMember['role'] }).role
      response = member
    } else if (path === `/organizations/${organizationId}/cohorts` && method === 'GET')
      response = cohorts
    else if (path === `/organizations/${organizationId}/cohorts` && method === 'POST') {
      response = {
        ...(body as object),
        id: newCohortId,
        organization_id: organizationId,
        is_active: true,
        member_count: 0,
      }
      cohorts.push(response as CohortOption)
      status = 201
    } else if (
      path === `/organizations/${organizationId}/cohorts/${newCohortId}/members/${addedUserId}` &&
      method === 'PUT'
    ) {
      const cohort = cohorts.find((row) => row.id === newCohortId)!
      cohort.member_count = 1
      response = cohort
    } else if (path === '/ai/providers/health')
      response = {
        requested_provider: 'deepseek',
        active_provider: 'mock',
        configured: false,
        ready: false,
        model: 'synthetic-mock-model',
        circuit_state: 'open',
        failure_count: 2,
        retry_after_seconds: 15,
        fallback_enabled: true,
        daily_token_quota: 100000,
        tokens_used_today: 12500,
        timeout_seconds: 15,
        max_retries: 2,
      }
    else if (path === `/admin/organizations/${organizationId}/security/status`)
      response = {
        organization_id: organizationId,
        model_tokens_used_today: 1200,
        model_daily_token_quota: 25000,
        recent_audit_events: 2,
        retention_days: 90,
        minimum_group_size: 5,
      }
    else if (path === `/admin/organizations/${organizationId}/audit-events`)
      response = [
        {
          id: 'synthetic-audit',
          actor_id: actorId,
          action: 'privacy.retention_previewed',
          resource_type: 'organization',
          resource_id: organizationId,
          outcome: 'succeeded',
          request_id: 'synthetic-request',
          occurred_at: fixedDate,
          event_metadata: { private_marker: 'SYNTHETIC_METADATA_MUST_NOT_RENDER' },
        },
      ]
    else if (
      path === `/admin/organizations/${organizationId}/privacy-runs/preview` &&
      method === 'POST'
    )
      response = {
        organization_id: organizationId,
        cutoff_at: '2026-06-16T06:20:00Z',
        retention_days: 90,
        result_counts: counts,
      }
    else if (path === `/admin/organizations/${organizationId}/privacy-runs` && method === 'POST') {
      privacyExecutionCount += 1
      if (privacyExecutionCount === 1) {
        await route.fulfill({ status: 503, json: { detail: '验收合成故障：执行结果尚未确认' } })
        return
      }
      response = {
        id: 'synthetic-retention-run',
        organization_id: organizationId,
        cutoff_at: '2026-06-16T06:20:00Z',
        mode: 'execute',
        status: 'completed',
        result_counts: counts,
        failure_code: null,
        completed_at: fixedDate,
        replayed: true,
      }
    } else if (/^\/admin\/items\/[^/]+\/assignments$/.test(path) && method === 'GET') {
      response = []
    } else if (/^\/admin\/content\/(items|rubrics|blueprints)\/details$/.test(path)) {
      const kind = path.split('/')[3] as ContentKind
      const wanted = url.searchParams.get('publication_status')
      const rows = wanted && content[kind].publication_status !== wanted ? [] : [content[kind]]
      response = { items: rows, total: rows.length, limit: 20, offset: 0 }
    } else if (/^\/admin\/content\/(items|rubrics|blueprints)\/[^/]+$/.test(path))
      response = content[path.split('/')[3] as ContentKind]
    else if (
      /^\/admin\/(items|rubrics|blueprints)\/[^/]+\/status$/.test(path) &&
      method === 'PATCH'
    ) {
      const kind = path.split('/')[2] as ContentKind
      content[kind].publication_status = (
        body as { target: ContentRecord['publication_status'] }
      ).target
      response = content[kind]
    } else {
      unmatched.push(`${method} ${path}`)
      await route.fulfill({
        status: 404,
        json: { detail: 'No route fixture: real backend access is blocked' },
      })
      return
    }
    await route.fulfill({ status, json: response })
  })
  return { writes, reads, unmatched, pageErrors, content }
}

async function capture(page: Page, info: TestInfo, name: string) {
  await page.screenshot({
    path: info.outputPath(`${name}.png`),
    fullPage: true,
    animations: 'disabled',
  })
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    'The document must not scroll horizontally; wide tables should scroll internally',
  ).toBe(true)
}

for (const width of [1440, 390]) {
  test(`synthetic member management requires explicit writes at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1050 })
    const fixture = await adminFixtures(page)
    await page.goto('/members')
    await expect(page.getByRole('heading', { name: '组织成员', exact: true })).toBeVisible()
    await expect(page.getByRole('cell', { name: /验收学员（合成）/ })).toBeVisible()
    await capture(page, info, `members-${width}-synthetic`)
    await page.getByTestId(`role-${learnerId}`).selectOption('evaluator')
    expect(fixture.writes.filter((row) => row.method === 'PATCH')).toHaveLength(0)
    await page.getByTestId(`save-role-${learnerId}`).click()
    await expect(page.getByRole('status').filter({ hasText: '成员角色已保存' })).toBeVisible()
    expect(fixture.writes.find((row) => row.method === 'PATCH')?.body).toEqual({
      role: 'evaluator',
    })
    await page.getByLabel('已注册用户 ID', { exact: true }).fill(addedUserId)
    await page.getByRole('combobox', { name: '加入后的角色', exact: true }).selectOption('learner')
    await page.getByRole('button', { name: '添加成员', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: '成员已添加' })).toBeVisible()
    await expect(page.getByRole('cell', { name: /新加入学员（合成）/ })).toBeVisible()
    await page.getByLabel('分组名称', { exact: true }).fill('新建验收部门（合成）')
    await page.getByRole('combobox', { name: '类型', exact: true }).selectOption('department')
    await page.getByLabel('分组代号', { exact: true }).fill('synthetic_department')
    await page.getByRole('button', { name: '创建分组', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: '班级或部门已创建' })).toBeVisible()
    await page.getByRole('combobox', { name: '组织成员', exact: true }).selectOption(addedUserId)
    await page.getByRole('combobox', { name: '班级或部门', exact: true }).selectOption(newCohortId)
    await page.getByRole('button', { name: '加入分组', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: '成员已加入所选分组' })).toBeVisible()
    expect(fixture.writes.find((row) => row.method === 'PUT')?.key).toBeTruthy()
    await capture(page, info, `members-${width}-saved-synthetic`)
    expect(fixture.pageErrors).toEqual([])
    expect(fixture.unmatched).toEqual([])
  })

  test(`synthetic system privacy requires acknowledgment and replays one request at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1050 })
    const fixture = await adminFixtures(page)
    const executions = () => fixture.writes.filter((row) => row.path.endsWith('/privacy-runs'))
    await page.goto('/system')
    await expect(page.getByText('服务尚未就绪', { exact: true })).toBeVisible()
    await expect(page.getByText(/当前使用降级提供方/)).toBeVisible()
    await expect(page.getByText('SYNTHETIC_METADATA_MUST_NOT_RENDER')).toHaveCount(0)
    expect(executions()).toHaveLength(0)
    await capture(page, info, `system-${width}-synthetic`)
    await page.getByTestId('privacy-preview').click()
    await expect(page.getByRole('heading', { name: '请确认清理范围' })).toBeVisible()
    await expect(page.getByTestId('privacy-execute')).toBeDisabled()
    await page.getByTestId('privacy-confirm-name').fill('错误的组织名称')
    await page.getByTestId('privacy-confirm-ack').check()
    await expect(page.getByTestId('privacy-execute')).toBeDisabled()
    await page.getByTestId('privacy-confirm-name').fill(organizationName)
    await page.getByTestId('privacy-confirm-ack').uncheck()
    await expect(page.getByTestId('privacy-execute')).toBeDisabled()
    expect(executions()).toHaveLength(0)
    await capture(page, info, `privacy-${width}-confirmation-synthetic`)
    await page.getByTestId('privacy-confirm-ack').check()
    await page.getByTestId('privacy-execute').click()
    await expect(page.getByRole('alert')).toContainText('验收合成故障')
    expect(executions()).toHaveLength(1)
    const originalKey = executions()[0]!.key
    await page.reload()
    await expect(page.getByText(/存在尚未确认完成的清理请求/)).toBeVisible()
    await expect(page.getByTestId('privacy-execute')).toHaveCount(0)
    expect(executions()).toHaveLength(1)
    await page.getByTestId('privacy-preview').click()
    await page.getByTestId('privacy-confirm-name').fill(organizationName)
    await page.getByTestId('privacy-confirm-ack').check()
    await page.getByTestId('privacy-execute').click()
    await expect(page.getByRole('heading', { name: '清理已完成' })).toBeVisible()
    await expect(page.getByText('本次返回了同一清理请求的已完成结果。')).toBeVisible()
    expect(executions()).toHaveLength(2)
    expect(executions()[1]!.key).toBe(originalKey)
    expect(executions()[1]!.body).toBeNull()
    await capture(page, info, `privacy-${width}-replayed-synthetic`)
    expect(fixture.pageErrors).toEqual([])
    expect(fixture.unmatched).toEqual([])
  })

  test(`synthetic content lists and detail use real routes at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1050 })
    const fixture = await adminFixtures(page)
    await page.goto('/item-bank')
    await expect(page.getByTestId('item-bank-title')).toBeVisible()
    for (const [kind, label] of [
      ['items', '题目版本'],
      ['rubrics', '评分量规'],
      ['blueprints', '测评蓝图'],
    ] as const) {
      await page
        .getByRole('navigation', { name: '内容类型' })
        .getByRole('button', { name: label, exact: true })
        .click()
      await expect(page.getByRole('button', { name: '查看详情', exact: true })).toHaveCount(1)
      await page.getByRole('button', { name: '查看详情', exact: true }).click()
      const record = fixture.content[kind]
      await expect(
        page.getByRole('heading', {
          name: record.stem ?? record.title ?? record.name!,
          exact: true,
        }),
      ).toBeVisible()
      expect(fixture.reads).toContain(`/admin/content/${kind}/details`)
      expect(fixture.reads).toContain(`/admin/content/${kind}/${record.id}`)
      await capture(page, info, `content-${kind}-${width}-synthetic`)
    }
    expect(fixture.writes).toHaveLength(0)
    await page.getByRole('button', { name: '审核并发布', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click()
    expect(fixture.writes).toHaveLength(0)
    await page.getByRole('button', { name: '审核并发布', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '确认操作', exact: true }).click()
    await expect(page.getByRole('cell', { name: '已发布', exact: true })).toBeVisible()
    expect(fixture.writes).toEqual([
      expect.objectContaining({
        method: 'PATCH',
        path: `/admin/blueprints/${fixture.content.blueprints.id}/status`,
        body: { target: 'published' },
      }),
    ])
    expect(fixture.pageErrors).toEqual([])
    expect(fixture.unmatched).toEqual([])
  })
}

test('synthetic system administrator without organizations sends only global status requests', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const fixture = await adminFixtures(page, { noOrganization: true })
  await page.goto('/system')
  await expect(page.getByText('服务尚未就绪', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '尚未选择组织' })).toBeVisible()
  await expect(page.getByTestId('privacy-preview')).toHaveCount(0)
  expect(fixture.reads.filter((path) => path.includes('/organizations/'))).toEqual([])
  expect(fixture.writes).toEqual([])
  await capture(page, info, 'system-no-organization-390-synthetic')
  expect(fixture.pageErrors).toEqual([])
  expect(fixture.unmatched).toEqual([])
})
