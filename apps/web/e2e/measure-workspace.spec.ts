import { expect, test, type Page } from '@playwright/test'

const codes = ['foundations', 'prompting', 'tool_use', 'evaluation', 'collaboration', 'ethics']
const dimensions = codes.map((code, i) => ({
  code,
  index: [71, 82, 64, 38, 73, 67][i],
  level: i === 3 ? 'L2' : 'L3',
  evidence_count: 3,
}))
const summary = {
  id: 'report-demo',
  session_id: 'session-demo',
  name: 'AI 能力标准测 · 界面验证样例',
  mode: 'standard',
  scenario: 'higher_education',
  status: 'complete',
  completed_at: '2026-09-13T08:26:00Z',
  revision: 2,
  dimensions,
}
const overview = {
  active_sessions: [
    {
      id: 'active-demo',
      name: 'AI 能力标准测 · 高校学习场景',
      mode: 'standard',
      scenario: 'higher_education',
      answered: 11,
      max_items: 18,
      dimension_counts: Object.fromEntries(
        codes.map((code, i) => [code, i < 2 ? 3 : i === 2 ? 2 : 1]),
      ),
      last_saved_at: '2026-09-14T06:26:00Z',
    },
  ],
  recent_reports: [summary],
  report_count: 1,
  service_status: { state: 'available', label: '工作台数据服务可用' },
}
const report = {
  id: summary.id,
  session_id: summary.session_id,
  is_complete: true,
  revision: 2,
  payload: {
    assessment: { mode: 'standard', scenario: 'higher_education' },
    measurement_status: 'complete',
    measurement_note: '界面验证使用的合成示例，不代表真实用户成绩或实验结果。',
    summary: { answered: 18, needs_review: 0 },
    dimensions: Object.fromEntries(
      dimensions.map((row) => [
        row.code,
        {
          synthesis: row,
          objective_measurement: {
            theta: 0.4,
            standard_error: 0.5,
            evidence_count: 3,
            level: row.level,
          },
          rubric_measurement: { completed: 0, pending: 0, decisions: [] },
        },
      ]),
    ),
    recommendations: [
      { dimension_code: 'evaluation', action: '练习追溯原始来源，形成独立来源交叉核验清单。' },
    ],
  },
}

async function fixtures(page: Page, admin = false) {
  await page.addInitScript(() =>
    sessionStorage.setItem(
      'zhijian-auth-session',
      JSON.stringify({ accessToken: 'fixture-access', refreshToken: 'fixture-refresh' }),
    ),
  )
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname.replace('/api/v1', '')
    let body: unknown
    if (path === '/auth/me')
      body = {
        id: 'learner-demo',
        email: 'fixture@example.test',
        display_name: '林晓（界面样例）',
        is_active: true,
      }
    else if (path === '/workspace/access')
      body = {
        organizations: [
          {
            id: 'org-demo',
            name: 'AI Measure 界面验证组织',
            role: admin ? 'org_admin' : 'learner',
            capabilities: admin ? ['analytics', 'members', 'governance', 'reviews'] : [],
          },
        ],
        global_capabilities: [],
      }
    else if (path === '/health') body = { status: 'ok' }
    else if (path === '/workspace/features')
      body = {
        training_enabled: false,
        training_content_status: 'formative_preview',
        growth_guide_mode: 'deepseek',
        attachments_enabled: false,
      }
    else if (path === '/workspace/overview') body = overview
    else if (path === '/workspace/reports')
      body = { items: [summary], total: 1, limit: 20, offset: 0 }
    else if (path === '/workspace/history')
      body = {
        items: [
          {
            ...overview.active_sessions[0],
            session_id: 'active-demo',
            status: 'active',
            created_at: '2026-09-14T06:10:00Z',
            completed_at: null,
            report_id: null,
            report_status: null,
          },
        ],
        total: 1,
        limit: 20,
        offset: 0,
      }
    else if (path === '/workspace/trends') body = { groups: [], total: 0, limit: 20, offset: 0 }
    else if (path === '/reports/session-demo') body = report
    else if (path === '/sessions/session-demo/workspace')
      body = {
        session: {
          id: 'session-demo',
          organization_id: 'org-demo',
          blueprint_version_id: 'bp-demo',
          mode: 'standard',
          scenario: 'higher_education',
          status: 'active',
          created_at: '2026-09-15T06:00:00Z',
          expires_at: null,
          blueprint_snapshot: {},
          replayed: false,
        },
        server_now: '2026-09-15T06:10:00Z',
        blueprint_name: 'AI能力标准测',
        min_items: 1,
        max_items: 18,
        answered_count: 0,
        dispatched_count: 1,
        flagged_count: 0,
        current_item: {
          session_id: 'session-demo',
          item_version_id: 'item-demo',
          sequence: 1,
          item_type: 'practical',
          dimension_code: 'evaluation',
          difficulty: 0,
          stem: '使用 AI 形成一份活动方案，并核验关键事实。',
          configuration: {},
        },
        items: [
          {
            item_version_id: 'item-demo',
            sequence: 1,
            item_type: 'practical',
            dimension_code: 'evaluation',
            answered_at: null,
            flagged: false,
          },
        ],
        type_coverage: [
          { item_type: 'objective', answered_count: 0, minimum: 6 },
          { item_type: 'dialogue', answered_count: 0, minimum: 3 },
          { item_type: 'practical', answered_count: 0, minimum: 1 },
        ],
        can_complete: false,
        completion_reason: 'unanswered',
        unmet_dimensions: [],
        unmet_item_types: ['practical'],
      }
    else if (path === '/sessions/session-demo/items/item-demo/draft')
      body = { draft: null, context_revision: 0, can_edit: true }
    else if (path === '/sessions/session-demo/practical/item-demo')
      body = {
        workspace_id: 'workspace-demo',
        session_id: 'session-demo',
        item_version_id: 'item-demo',
        state: 'active',
        task_type: 'text',
        stem: '使用 AI 形成一份活动方案，并核验关键事实。',
        max_ai_interactions: 3,
        event_count: 1,
        interaction_count: 0,
        artifact_count: 0,
        submitted_at: null,
        can_edit: true,
        replayed: false,
        events: [
          {
            id: 'event-demo',
            sequence: 1,
            event_type: 'task_decomposition',
            payload: { steps: ['明确目标与信息来源'] },
            occurred_at: '2026-09-14T06:26:00Z',
          },
        ],
        interactions: [],
        artifacts: [],
      }
    else if (path === '/training') {
      await route.fulfill({ status: 503, json: { detail: 'Training is not enabled' } })
      return
    } else {
      await route.fulfill({ status: 404, json: { detail: 'Unconfigured test fixture' } })
      return
    }
    await route.fulfill({ status: 200, json: body })
  })
}

test('sidebar preserves white wordmark, supplied logo and original navigation palette', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await fixtures(page)
  await page.goto('/workspace')
  await expect(page.locator('.measure-brand:visible > span')).toHaveCSS(
    'color',
    'rgb(255, 255, 255)',
  )
  await expect(page.locator('.measure-brand:visible > span')).toHaveText('AI Measure')
  const wordmark = page.locator('.measure-brand:visible > span')
  await expect(wordmark).toHaveCSS('font-family', /Outfit/)
  await expect(wordmark).toHaveCSS('font-weight', '600')
  expect(
    await page.evaluate(async () => {
      await document.fonts.ready
      const faces = Array.from(document.fonts)
      return faces.some((face) => face.family.includes('Outfit') && face.status === 'loaded')
    }),
  ).toBe(true)
  const wordmarkBox = await wordmark.boundingBox()
  const brandBox = await page.locator('.measure-brand:visible').boundingBox()
  expect(wordmarkBox!.x + wordmarkBox!.width).toBeLessThanOrEqual(brandBox!.x + brandBox!.width - 8)
  await expect(page.locator('.measure-brand:visible .brand-mark image')).toHaveAttribute(
    'href',
    /ai-measure-logo\.png/,
  )
  await expect(page.locator('nav[aria-label="主导航"]:visible a.selected')).toHaveCSS(
    'color',
    'rgb(32, 140, 156)',
  )
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '打开导航' }).click()
  await expect(page.locator('.measure-brand:visible > span')).toHaveCSS(
    'color',
    'rgb(255, 255, 255)',
  )
  await expect(page.locator('.measure-brand:visible > span')).toHaveCSS('font-family', /Outfit/)
})

for (const width of [1440, 1920, 1024, 390]) {
  test(`workspace and report remain navigable at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 1050 })
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await fixtures(page)
    await page.goto('/workspace')
    await expect(page.getByRole('heading', { name: /林晓/ })).toBeVisible()
    await expect(page.getByText('已保存 11 题')).toBeVisible()
    await expect(page.locator('progress')).toHaveCount(0)
    await expect(page.getByRole('link', { name: '组织分析', exact: true })).toHaveCount(0)
    await page.screenshot({ path: info.outputPath(`workspace-${width}.png`), fullPage: true })
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true)
    await page.goto('/reports/session-demo')
    await expect(page.getByRole('heading', { name: 'AI能力标准测报告' })).toBeVisible()
    await page.getByRole('button', { name: '评分过程', exact: true }).click()
    await expect(page.getByText('测量说明：客观能力估计与开放题量规分开呈现')).toBeVisible()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true)
    await page.screenshot({ path: info.outputPath(`report-${width}.png`), fullPage: true })
    expect(errors).toEqual([])
  })
}

test('homepage keeps its panel proportions inside the unified 1722px app frame', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1722, height: 1148 })
  await page.clock.setFixedTime(new Date('2026-09-11T06:26:00Z'))
  await fixtures(page)
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({
      json: {
        id: 'reference-learner',
        username: 'reference_learner',
        email: null,
        display_name: '林晓',
        is_active: true,
      },
    }),
  )
  await page.route('**/api/v1/workspace/access', (route) =>
    route.fulfill({
      json: {
        organizations: [
          {
            id: 'org-demo',
            name: '视觉对照合成组织',
            role: 'evaluator',
            capabilities: ['analytics', 'content', 'reviews'],
          },
        ],
        global_capabilities: [],
      },
    }),
  )
  await page.route('**/api/v1/workspace/overview*', (route) =>
    route.fulfill({
      json: {
        ...overview,
        active_sessions: overview.active_sessions.map((session) => ({
          ...session,
          last_saved_at: '2026-09-11T06:26:00Z',
        })),
        recent_reports: [
          {
            ...summary,
            name: 'AI能力标准测',
            completed_at: '2026-08-28T06:26:00Z',
            dimensions: dimensions.map((row, i) => ({
              ...row,
              index: [76, 82, 64, 58, 73, 67][i],
            })),
          },
          {
            ...summary,
            id: 'reference-special',
            session_id: 'reference-special',
            name: '提示词工程专项测',
            mode: 'specialized',
            completed_at: '2026-08-15T06:26:00Z',
          },
          {
            ...summary,
            id: 'reference-rapid',
            session_id: 'reference-rapid',
            name: 'AI能力极速测',
            mode: 'rapid',
            scenario: 'enterprise',
            completed_at: '2026-07-24T06:26:00Z',
          },
        ],
        report_count: 3,
      },
    }),
  )
  await page.goto('/workspace')
  await expect(page.getByRole('heading', { name: /下午好.*林晓/ })).toBeVisible()
  const mascot = page.locator('.assistant-robot img')
  await expect(mascot).toHaveAttribute('alt', '')
  await expect(
    page.getByRole('button', { name: '打开成长助手问答', exact: true }).filter({ visible: true }),
  ).toBeVisible()
  await expect
    .poll(() => mascot.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
    .toBe(true)
  const brand = page.locator('.measure-sidebar .brand-mark')
  await expect(brand.locator('image')).toHaveAttribute('href', /ai-measure-logo/)
  await expect(brand).toHaveCSS('overflow', 'hidden')
  await expect(page.getByText('训练服务尚未启用', { exact: true })).toBeVisible()
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise<void>((done) =>
      requestAnimationFrame(() => requestAnimationFrame(() => done())),
    )
  })
  // Capture the resolved shared scale before full-page screenshots temporarily resize
  // Chromium's layout viewport around a classic scrollbar gutter.
  const frameMetrics = await page.evaluate(() => ({
    width: document.querySelector('.measure-app')!.getBoundingClientRect().width,
    unit: parseFloat(getComputedStyle(document.querySelector('.workspace-grid')!).columnGap) / 28,
  }))
  const regions = {
    sidebar: await page.locator('.measure-sidebar').boundingBox(),
    toolbar: await page.locator('.measure-toolbar').boundingBox(),
    currentAssessment: await page.locator('.assessment-panel').boundingBox(),
    ability: await page.locator('.portrait-panel').boundingBox(),
    reports: await page.locator('.reports-panel').boundingBox(),
    training: await page.locator('.training-panel').boundingBox(),
    assistant: await page.locator('.workspace-assistant').boundingBox(),
  }
  await info.attach('synthetic-reference-region-measurements', {
    body: JSON.stringify(
      { synthetic: true, viewport: { width: 1722, height: 1148 }, regions },
      null,
      2,
    ),
    contentType: 'application/json',
  })
  await page.screenshot({ path: info.outputPath('homepage-reference-1722.png'), fullPage: true })
  const contentWidth = frameMetrics.width
  const unit = frameMetrics.unit
  expect(unit).toBeGreaterThan(0.98)
  expect(unit).toBeLessThanOrEqual(1.001)
  expect(regions.sidebar?.width).toBeCloseTo(280 * unit, 0)
  expect(regions.toolbar?.height).toBeCloseTo(82 * unit, 0)
  // Shared shell uses 32px side gutters and 28px top padding after the uniform-size change.
  // Preserve precise frame and panel geometry, not the retired page-specific outer margins.
  expect(Math.abs((regions.currentAssessment?.x ?? 0) - (280 * unit + 32))).toBeLessThan(1)
  expect(Math.abs((regions.currentAssessment?.y ?? 0) - (226 * unit + 28))).toBeLessThan(1)
  expect(
    Math.abs(
      (regions.currentAssessment?.width ?? 0) - ((contentWidth - 308 * unit - 64) * 765) / 1310,
    ),
  ).toBeLessThan(1)
  expect(Math.abs((regions.currentAssessment?.height ?? 0) - 334 * unit)).toBeLessThan(2)
  expect(
    Math.abs((regions.ability?.width ?? 0) - ((contentWidth - 308 * unit - 64) * 545) / 1310),
  ).toBeLessThan(1)
  expect(Math.abs((regions.reports?.height ?? 0) - 303 * unit)).toBeLessThan(2)
  expect(regions.assistant?.width).toBe(140)
  expect(regions.assistant?.height).toBeGreaterThan(100)
  expect(regions.assistant?.y).toBeGreaterThan(800)
  expect((regions.assistant?.y ?? 2000) + (regions.assistant?.height ?? 0)).toBeLessThan(1148)
  await expect(page.locator('[data-testid="evidence-coverage"] li')).toHaveCount(6)
  await expect(page.locator('.reports-table tbody tr')).toHaveCount(3)
  await page
    .getByRole('button', { name: '打开成长助手问答', exact: true })
    .filter({ visible: true })
    .click()
  await expect(page.getByRole('button', { name: /^上传图片/ })).toBeDisabled()
  await expect(page.getByRole('button', { name: /^上传文档/ })).toBeDisabled()
  await expect(page.getByTestId('guide-provider')).toContainText('DeepSeek')
})

for (const width of [1440, 390]) {
  const openNavigation =
    width === 390
      ? (page: Page) => page.getByRole('button', { name: '打开导航', exact: true }).click()
      : async (_page: Page) => {}
  const navigation =
    width === 390
      ? (page: Page) => page.getByRole('dialog', { name: '应用导航' })
      : (page: Page) => page.locator('.measure-sidebar')

  test(`navigation preserves the shared frame across learner pages at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await fixtures(page)
    await page.goto('/workspace')
    const toolbar = await page.locator('.measure-toolbar').boundingBox()
    const sidebar = await page.locator('.measure-sidebar').boundingBox()
    for (const label of ['能力报告', '训练计划', '历史记录', '工作台']) {
      await openNavigation(page)
      const nav = navigation(page)
      await nav.getByRole('link', { name: label, exact: true }).click()
      await expect(page.locator('.measure-toolbar .breadcrumb strong')).toHaveText(label)
      expect(await page.locator('.measure-toolbar').boundingBox()).toEqual(toolbar)
      expect(await page.locator('.measure-sidebar').boundingBox()).toEqual(sidebar)
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true)
      await expect(page.getByRole('main')).toHaveCount(1)
    }
  })

  for (const role of ['learner', 'admin']) {
    test(`floating assistant restores size, dragging and keyboard focus for ${role} at ${width}px`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 844 })
      await fixtures(page, role === 'admin')
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.goto('/workspace')
      const launcher = page.getByRole('button', { name: '打开成长助手问答', exact: true })
      await expect(launcher).toHaveCount(1)
      await expect(page.locator('.workspace-assistant')).toBeVisible()
      await expect(page.locator('.toolbar-assistant')).toHaveCount(0)
      await expect(page.locator('.assistant-robot img')).toHaveCSS(
        'width',
        width === 390 ? '90px' : '132px',
      )
      const bounds = await launcher.boundingBox()
      expect(bounds!.y).toBeGreaterThan(500)
      expect(bounds!.y + bounds!.height).toBeLessThan(844)
      expect(bounds!.x + bounds!.width).toBeLessThan(width)
      await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2)
      await page.mouse.down()
      await page.mouse.move(
        bounds!.x + bounds!.width / 2 - 50,
        bounds!.y + bounds!.height / 2 - 50,
        { steps: 8 },
      )
      await page.mouse.up()
      await expect(page.getByRole('dialog', { name: '成长助手', exact: true })).toBeHidden()
      expect((await launcher.boundingBox())!.x).toBeCloseTo(bounds!.x - 50, 0)
      await launcher.focus()
      await page.keyboard.press('ArrowRight')
      await expect.poll(async () => (await launcher.boundingBox())!.x).toBeCloseTo(bounds!.x - 26, 0)
      await launcher.click()
      await expect(page.getByRole('dialog', { name: '成长助手', exact: true })).toBeVisible()
      await expect(page.getByRole('textbox', { name: '向成长助手提问' })).toBeEnabled()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog', { name: '成长助手', exact: true })).toBeHidden()
      await expect(launcher).toBeFocused()
      expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden')
      const position = await launcher.boundingBox()
      await openNavigation(page)
      await navigation(page).getByRole('link', { name: '能力报告', exact: true }).click()
      await expect(page).toHaveURL(/\/reports$/)
      expect((await launcher.boundingBox())!.x).toBeCloseTo(position!.x, 0)
      await page.screenshot({ path: info.outputPath(`floating-robot-${role}-${width}.png`) })
    })
  }

  test(`model guide supports retry citations and clear at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1050 })
    await fixtures(page)
    let calls = 0
    await page.route('**/api/v1/workspace/guide', async (route) => {
      calls += 1
      expect(route.request().method()).toBe('POST')
      expect(route.request().postDataJSON()).toEqual({
        organization_id: 'org-demo',
        question: '怎么看我的报告？',
        provider: 'deepseek',
      })
      if (calls === 1)
        await route.fulfill({ status: 503, json: { detail: '测试模拟网络暂不可用' } })
      else
        await route.fulfill({
          json: {
            mode: 'deepseek',
            generation: {
              requested_provider: 'deepseek',
              status: 'succeeded',
              model: 'synthetic-deepseek',
              error_code: null,
              usage: null,
            },
            scope: 'personal_growth',
            paragraphs: [
              '这是一份界面验收用的合成报告摘要。缺失维度不代表零分；训练不会修改正式分数。',
            ],
            actions: [
              { label: '查看来源报告', path: '/reports/10000000-0000-4000-8000-000000000002' },
            ],
            source: {
              report_id: '10000000-0000-4000-8000-000000000003',
              session_id: '10000000-0000-4000-8000-000000000002',
              revision: 2,
              status: 'complete',
            },
          },
        })
    })
    await page.goto('/workspace')
    await page
      .getByRole('button', { name: '打开成长助手问答', exact: true })
      .filter({ visible: true })
      .click()
    await expect(page.getByRole('textbox', { name: '向成长助手提问' })).toBeEnabled()
    await page.getByRole('button', { name: '怎么看我的报告？', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('测试模拟网络暂不可用')
    await page.getByTestId('retry-guide').click()
    await expect(page.getByTestId('guide-source')).toContainText('修订 2')
    await expect(page.getByTestId('guide-turn')).toHaveCount(1)
    await expect(page.getByTestId('guide-turn')).toContainText('DeepSeek 生成 · synthetic-deepseek')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    )
    await page.evaluate(async () => {
      window.scrollTo(0, 0)
      await document.fonts.ready
      await new Promise<void>((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => done())),
      )
    })
    await page.screenshot({ path: info.outputPath(`homepage-guide-${width}.png`), fullPage: true })
    await page.getByTestId('clear-guide').click()
    await expect(page.getByTestId('guide-turn')).toHaveCount(0)
    expect(calls).toBe(2)
  })

  test(`homepage continues the exact training plan and restores progress at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1050 })
    await fixtures(page)
    const planId = '10000000-0000-4000-8000-000000000001'
    let completed = 2
    const writes: Array<{
      path: string
      key: string | undefined
      application: string
      verification: string
    }> = []
    const plan = () => ({
      id: planId,
      organization_id: 'org-demo',
      source_report_id: summary.id,
      source_session_id: summary.session_id,
      source_report_revision: 2,
      source_report_changed: false,
      retest_available: true,
      retest_unavailable_reason: null,
      privacy_redacted: false,
      replaces_plan_id: null,
      template_version: 'engineering-training-v1',
      content_provenance: '工程编写 v1 · 非专家认证 · 仅用于形成性训练',
      status: 'active',
      created_at: '2026-09-14T08:00:00Z',
      completed_at: null,
      dimensions: dimensions.filter((row) => row.code === 'evaluation'),
      assessment: {
        mode: 'standard',
        scenario: 'higher_education',
        blueprint_version_id: 'blueprint-demo',
      },
      completed_tasks: completed,
      total_tasks: 4,
      tasks: ['learning', 'exercise', 'application', 'retest'].map((kind, index) => ({
        id: `task-${index + 1}`,
        sequence: index + 1,
        kind,
        title: ['学习核验方法', '针对性练习', '应用与核验', '正式复测'][index],
        status: index < completed ? 'completed' : 'pending',
        content: { instructions: '使用合成材料记录应用与核验依据。' },
        submission:
          index < completed ? { response: '界面验收合成练习记录，不是实际试测结果。' } : null,
        feedback: index < completed ? '规则清单记录，不是专家评分。' : null,
        completed_at: index < completed ? '2026-09-15T03:00:00Z' : null,
      })),
    })
    await page.route('**/api/v1/workspace/features', (route) =>
      route.fulfill({
        json: {
          training_enabled: true,
          training_content_status: 'formative_preview',
          growth_guide_mode: 'local_guidance',
          attachments_enabled: false,
        },
      }),
    )
    await page.route('**/api/v1/training**', async (route) => {
      const url = new URL(route.request().url())
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON()
        writes.push({
          path: url.pathname,
          key: route.request().headers()['idempotency-key'],
          application: body.application,
          verification: body.verification,
        })
        completed = 3
        await route.fulfill({ json: { plan: plan(), replayed: false } })
      } else if (url.pathname === `/api/v1/training/${planId}`)
        await route.fulfill({ json: plan() })
      else await route.fulfill({ json: { items: [plan()], total: 1, limit: 20, offset: 0 } })
    })
    await page.goto('/workspace')
    await expect(page.getByText('已完成 2 / 4 项', { exact: true })).toBeVisible()
    await page.getByRole('link', { name: '继续训练', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/training\\?plan=${planId}$`))
    await expect(page.getByText(/形成性训练预览：/)).toBeVisible()
    await page
      .getByTestId('application-record')
      .fill(
        '界面测试：我先确定目标和输入边界，使用无敏感信息的合成材料完成任务，并逐步记录操作与结果。',
      )
    await page
      .getByTestId('verification-record')
      .fill(
        '界面测试：我检查独立来源与日期，复算关键数值，将尚未证实的结论单独标记并记录失败和改进。',
      )
    await page.getByTestId('submit-task').getByRole('button', { name: /保存/ }).click()
    await expect(page.getByText('训练记录已保存。', { exact: true })).toBeVisible()
    expect(writes).toHaveLength(1)
    expect(writes[0]?.path).toBe(`/api/v1/training/${planId}/tasks/task-3/submit`)
    expect(writes[0]?.key).toBeTruthy()
    expect(writes[0]?.application.length).toBeGreaterThanOrEqual(30)
    expect(writes[0]?.verification.length).toBeGreaterThanOrEqual(30)
    await page.goto('/workspace')
    await expect(page.getByText('已完成 3 / 4 项', { exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByText('已完成 3 / 4 项', { exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    )
    await page.screenshot({
      path: info.outputPath(`homepage-training-${width}.png`),
      fullPage: true,
    })
  })
}

test('mobile navigation opens and closes after choosing an entry', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await fixtures(page)
  await page.goto('/workspace')
  await page.getByRole('button', { name: '打开导航' }).click()
  await expect(page.getByRole('dialog', { name: '应用导航' })).toBeVisible()
  await page
    .getByRole('dialog', { name: '应用导航' })
    .getByRole('link', { name: '能力报告', exact: true })
    .click()
  await expect(page.getByRole('dialog', { name: '应用导航' })).toBeHidden()
  await expect(page).toHaveURL(/\/reports$/)
})

test('DeepSeek guide sends directly and never disguises a local fallback as a model answer', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 1050 })
  await fixtures(page)
  await page.route('**/api/v1/workspace/features', (route) =>
    route.fulfill({
      json: {
        training_enabled: false,
        training_content_status: 'formative_preview',
        growth_guide_mode: 'deepseek',
        attachments_enabled: false,
      },
    }),
  )
  const calls: string[] = []
  await page.route('**/api/v1/workspace/guide', async (route) => {
    const request = route.request()
    expect(request.postDataJSON().provider).toBe('deepseek')
    calls.push(request.headers()['idempotency-key'] ?? '')
    await route.fulfill({
      json: {
        mode: calls.length === 1 ? 'deepseek' : 'local_guidance',
        scope: 'personal_growth',
        source: null,
        actions: [],
        paragraphs: ['浏览器合成响应：先核验信息来源，再尝试独立交叉验证。'],
        generation:
          calls.length === 1
            ? {
                requested_provider: 'deepseek',
                status: 'succeeded',
                model: 'deepseek-flash',
                error_code: null,
                usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
              }
            : {
                requested_provider: 'deepseek',
                status: 'fallback',
                model: null,
                error_code: 'timeout',
                usage: null,
              },
      },
    })
  })
  await page.goto('/workspace')
  await page
    .getByRole('button', { name: '打开成长助手问答', exact: true })
    .filter({ visible: true })
    .click()
  await expect(page.getByTestId('guide-provider')).toContainText('DeepSeek')
  await page.getByRole('textbox', { name: '向成长助手提问' }).fill('如何核验信息？')
  await expect(page.getByRole('button', { name: '发送问题', exact: true })).toBeEnabled()
  expect(calls).toHaveLength(0)
  await expect(page.getByTestId('deepseek-consent')).toHaveCount(0)
  await page.getByRole('button', { name: '发送问题', exact: true }).click()
  await expect(page.getByTestId('guide-turn')).toHaveCount(1)
  await expect(page.getByTestId('guide-turn')).toContainText('DeepSeek 生成 · deepseek-flash')
  expect(calls[0]).toBeTruthy()
  await page.getByRole('textbox', { name: '向成长助手提问' }).fill('下一步如何练习？')
  await page.getByRole('button', { name: '发送问题', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('本次未生成回答')
  await expect(page.getByTestId('guide-turn')).toHaveCount(1)
  await expect(page.getByText(/本次接口返回用量|查看本次用量/)).toHaveCount(0)
  expect(calls[1]).not.toBe(calls[0])
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({
    path: info.outputPath('deepseek-guide-synthetic-1440.png'),
    fullPage: true,
  })
})

test('account menu remains keyboard operable after the reference restyle', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1050 })
  await fixtures(page)
  await page.route('**/api/v1/auth/logout', (route) => route.fulfill({ status: 204 }))
  await page.goto('/workspace')
  const accountMenu = page.locator('.measure-sidebar button[aria-label="账号操作"]')
  await accountMenu.focus()
  await page.keyboard.press('Enter')
  const logout = page.locator('.measure-sidebar').getByRole('button', { name: '退出登录' })
  await expect(logout).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(logout).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/login$/)
  expect(await page.evaluate(() => sessionStorage.getItem('zhijian-auth-session'))).toBeNull()
})

test('empty homepage and failed overview do not manufacture an assessment profile', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 1050 })
  await fixtures(page)
  let available = false
  await page.route('**/api/v1/workspace/overview*', (route) =>
    available
      ? route.fulfill({
          json: { ...overview, active_sessions: [], recent_reports: [], report_count: 0 },
        })
      : route.fulfill({ status: 503, json: { detail: '界面验证：工作台暂不可用' } }),
  )
  await page.goto('/workspace')
  await expect(page.getByRole('alert')).toContainText('工作台暂不可用')
  await expect(page.locator('[data-testid="radar-profile"]')).toHaveCount(0)
  available = true
  await page.getByTestId('retry-workspace').click()
  await expect(page.getByRole('heading', { name: '暂无能力报告' })).toBeVisible()
  await expect(page.locator('.reports-table tbody tr')).toHaveCount(1)
  await expect(page.locator('.reports-table tbody tr')).toContainText('暂无能力报告')
  await expect(page.locator('.reports-table tbody a')).toHaveCount(0)
  await expect(page.locator('[data-testid="radar-profile"]')).toHaveCount(0)
  await page
    .getByRole('button', { name: '打开成长助手问答', exact: true })
    .filter({ visible: true })
    .click()
  await expect(page.getByRole('button', { name: '上传图片' })).toBeDisabled()
  await page.getByRole('button', { name: '关闭成长助手问答' }).click()
  await page.screenshot({ path: info.outputPath('workspace-empty-1440.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  const emptyReports = page.locator('.reports-scroll')
  const emptyCopy = emptyReports.locator('.empty-copy')
  const panelBounds = await emptyReports.boundingBox()
  const copyBounds = await emptyCopy.boundingBox()
  expect(copyBounds!.x + copyBounds!.width).toBeLessThanOrEqual(
    panelBounds!.x + panelBounds!.width + 1,
  )
})

test('organization switch refreshes homepage data and removes the previous role entries', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1050 })
  await fixtures(page)
  await page.route('**/api/v1/workspace/access', (route) =>
    route.fulfill({
      json: {
        organizations: [
          {
            id: 'org-first',
            name: '组织一（合成）',
            role: 'org_admin',
            capabilities: ['analytics'],
          },
          { id: 'org-second', name: '组织二（合成）', role: 'learner', capabilities: [] },
        ],
        global_capabilities: [],
      },
    }),
  )
  await page.route('**/api/v1/workspace/overview*', (route) => {
    const second =
      new URL(route.request().url()).searchParams.get('organization_id') === 'org-second'
    return route.fulfill({
      json: {
        ...overview,
        active_sessions: [
          {
            ...overview.active_sessions[0],
            id: second ? 'second-session' : 'first-session',
            name: second ? '第二组织专属测评' : '第一组织专属测评',
          },
        ],
      },
    })
  })
  await page.goto('/workspace')
  await expect(page.getByRole('heading', { name: '第一组织专属测评' })).toBeVisible()
  await expect(page.getByRole('link', { name: '组织分析', exact: true })).toBeVisible()
  await page.getByRole('combobox', { name: '当前组织' }).selectOption('org-second')
  await expect(page.getByRole('heading', { name: '第二组织专属测评' })).toBeVisible()
  await expect(page.getByText('第一组织专属测评')).toHaveCount(0)
  await expect(page.getByRole('link', { name: '组织分析', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '搜索功能与帮助' }).click()
  await page.getByRole('textbox', { name: '功能名称' }).fill('组织分析')
  await expect(page.getByText('没有匹配入口，请换个关键词。')).toBeVisible()
})

test('role guard and permitted-entry search fail closed', async ({ page }) => {
  await fixtures(page)
  await page.goto('/reviews')
  await expect(page).toHaveURL(/access-denied$/)
  await page.getByRole('button', { name: '搜索功能与帮助' }).click()
  await page.getByRole('textbox', { name: '功能名称' }).fill('评分复核')
  await expect(page.getByText('没有匹配入口，请换个关键词。')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.goto('/training')
  await expect(page.getByRole('heading', { name: '训练服务尚未启用' })).toBeVisible()
})

for (const width of [1440, 390]) {
  test(`formal practical preserves work areas at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 1050 })
    await fixtures(page)
    await page.goto('/assessment/session-demo/practical/item-demo')
    await expect(page.getByTestId('assessment-session-toolbar')).toBeVisible()
    await expect(
      page.getByRole('heading', { name: '使用 AI 形成一份活动方案，并核验关键事实。' }),
    ).toBeVisible()
    await expect(page.locator('.dossier')).toBeVisible()
    await expect(page.locator('.ai-lab')).toBeVisible()
    await expect(page.locator('.proof-rail')).toBeVisible()
    await expect(page.getByText('访问令牌', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('combobox', { name: '当前组织' })).toHaveCount(0)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true)
    await page.screenshot({ path: info.outputPath(`practical-${width}.png`), fullPage: true })
  })
}
