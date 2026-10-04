import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'

async function accountFixtures(page: Page, conflict = false) {
  const registrations: Record<string, unknown>[] = []
  const logins: Record<string, unknown>[] = []
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname.replace('/api/v1', '')
    const user = {
      id: 'fixture-user',
      username: 'sample_learner',
      email: null,
      display_name: '注册验收样例',
      is_active: true,
    }
    if (pathname === '/auth/register') {
      registrations.push(request.postDataJSON())
      await route.fulfill(
        conflict
          ? { status: 409, json: { detail: '用户名或邮箱已被使用，请直接登录或换一个用户名。' } }
          : { status: 201, json: user },
      )
    } else if (pathname === '/auth/login') {
      logins.push(request.postDataJSON())
      await route.fulfill({
        json: {
          access_token: 'synthetic-access',
          refresh_token: 'synthetic-refresh',
          token_type: 'bearer',
        },
      })
    } else if (pathname === '/auth/me') {
      await route.fulfill({ json: user })
    } else if (pathname === '/health') {
      await route.fulfill({ json: { status: 'ok' } })
    } else if (pathname === '/workspace/access') {
      await route.fulfill({
        json: {
          organizations: [
            {
              id: 'fixture-org',
              name: '个人学习空间',
              role: 'learner',
              capabilities: ['pilot_participate'],
            },
          ],
          global_capabilities: [],
        },
      })
    } else if (pathname === '/workspace/overview') {
      await route.fulfill({
        json: {
          active_sessions: [],
          recent_reports: [],
          report_count: 0,
          service_status: { state: 'available', label: '工作台数据服务可用' },
        },
      })
    } else {
      await route.fulfill({ status: 404, json: { detail: 'Unconfigured synthetic fixture' } })
    }
  })
  return { registrations, logins }
}

async function fillRegistration(page: Page, password: string) {
  await page.getByLabel('用户名', { exact: true }).fill('sample_learner')
  await page.getByLabel('显示名称', { exact: true }).fill('注册验收样例')
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByLabel('确认密码', { exact: true }).fill(password)
}

for (const width of [1440, 390]) {
  test(`username registration without email reaches learner workspace at ${width}px`, async ({
    page,
  }, info) => {
    const calls = await accountFixtures(page)
    const password = randomUUID()
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1050 })
    await page.goto('/register')
    await fillRegistration(page, password)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true)
    await page.screenshot({ path: info.outputPath(`registration-${width}.png`), fullPage: true })
    await page.getByRole('button', { name: /注册|创建/ }).click()
    await expect(page).toHaveURL(/\/login\?/)
    await expect(page.getByText(/注册成功/)).toBeVisible()
    await expect(page.getByLabel('用户名或邮箱', { exact: true })).toHaveValue('sample_learner')
    expect(calls.registrations).toHaveLength(1)
    expect(calls.registrations[0]).toMatchObject({
      username: 'sample_learner',
      display_name: '注册验收样例',
    })
    expect(calls.registrations[0]?.email ?? null).toBeNull()
    expect(calls.registrations[0]).not.toHaveProperty('is_system_admin')
    expect(calls.registrations[0]).not.toHaveProperty('role')
    await page.getByLabel('密码', { exact: true }).fill(password)
    await page.getByRole('button', { name: '登录并继续测评' }).click()
    await expect(page).toHaveURL(/\/workspace$/)
    await expect(page.getByRole('heading', { name: /注册验收样例/ })).toBeVisible()
    expect(calls.logins[0]).toMatchObject({ identifier: 'sample_learner' })
    await expect(page.getByRole('link', { name: '成员与分组', exact: true })).toHaveCount(0)
    expect(pageErrors).toEqual([])
  })
}

test('mismatched password prevents registration and duplicate account remains recoverable', async ({
  page,
}) => {
  const calls = await accountFixtures(page, true)
  const password = randomUUID()
  await page.goto('/register')
  await fillRegistration(page, password)
  await page.getByLabel('确认密码', { exact: true }).fill(randomUUID())
  await page.getByRole('button', { name: /注册|创建/ }).click()
  await expect(page.getByRole('alert')).toContainText(/一致/)
  expect(calls.registrations).toHaveLength(0)
  await page.getByLabel('确认密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: /注册|创建/ }).click()
  await expect(page.getByRole('alert')).toContainText(/已被使用/)
  await expect(page).toHaveURL(/\/register$/)
  expect(calls.registrations).toHaveLength(1)
  expect(await page.evaluate(() => sessionStorage.getItem('zhijian-auth-session'))).toBeNull()
})

test('registration keeps an external redirect from leaving this app', async ({ page }) => {
  await accountFixtures(page)
  const password = randomUUID()
  await page.goto('/register?redirect=https%3A%2F%2Fevil.example%2F')
  await fillRegistration(page, password)
  await page.getByRole('button', { name: /注册|创建/ }).click()
  await expect(page).toHaveURL(/\/login\?/)
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '登录并继续测评' }).click()
  await expect(page).toHaveURL(/\/workspace$/)
})

test('legacy long identifiers and Unicode passwords are not truncated by the browser', async ({
  page,
}) => {
  const calls = await accountFixtures(page)
  const identifier = `${'x'.repeat(245)}@legacy.example`
  const password = '🔐'.repeat(200)
  await page.goto(`/login?account=${encodeURIComponent(identifier)}`)
  await expect(page.getByLabel('用户名或邮箱', { exact: true })).toHaveValue(identifier)
  await page.getByLabel('密码', { exact: true }).focus()
  await page.keyboard.insertText(password)
  await expect(page.getByLabel('密码', { exact: true })).toHaveValue(password)
  await page.getByRole('button', { name: '登录并继续测评' }).click()
  await expect(page).toHaveURL(/\/workspace$/)
  expect(calls.logins).toHaveLength(1)
  expect(calls.logins[0]).toEqual({ identifier, password })
})
