import { expect, test, type Page } from '@playwright/test'

async function portalFixture(page: Page, canManage: boolean) {
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '')
    let json: unknown = {}
    if (path === '/auth/login')
      json = {
        access_token: 'synthetic-only-access',
        refresh_token: 'synthetic-only-refresh',
        token_type: 'bearer',
      }
    else if (path === '/auth/me')
      json = {
        id: 'synthetic-portal-user',
        email: null,
        username: 'portal_user',
        display_name: '入口验收账号（合成）',
        is_active: true,
      }
    else if (path === '/workspace/access')
      json = {
        organizations: [],
        global_capabilities: canManage ? ['content', 'system', 'cat'] : [],
      }
    else if (path === '/health') json = { status: 'ok' }
    else if (path.includes('/details')) json = { items: [], total: 0, offset: 0, limit: 20 }
    await route.fulfill({ json })
  })
}

test('management deep links select staff login and administrators land at the requested tool', async ({
  page,
}, info) => {
  await portalFixture(page, true)
  await page.goto('/item-bank')
  await expect(page).toHaveURL(/\/staff\/login\?redirect=/)
  await expect(page.getByTestId('staff-login-tab')).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('heading', { name: '欢迎回来', exact: true })).toBeVisible()
  await page.getByLabel('用户名或邮箱', { exact: true }).fill('portal_user')
  await page.getByLabel('密码', { exact: true }).fill('synthetic-login-only')
  await page.screenshot({ path: info.outputPath('staff-login-synthetic.png'), fullPage: true })
  await page.getByRole('button', { name: '登录教学／管理工作区', exact: true }).click()
  await expect(page).toHaveURL(/\/item-bank$/)
  await expect(page.getByRole('heading', { name: '题库与量规', exact: true })).toBeVisible()
})

test('a learner cannot gain staff access by selecting the management portal', async ({ page }) => {
  await portalFixture(page, false)
  await page.goto('/login')
  await page.getByTestId('staff-login-tab').click()
  await page.getByLabel('用户名或邮箱', { exact: true }).fill('portal_user')
  await page.getByLabel('密码', { exact: true }).fill('synthetic-login-only')
  await page.getByRole('button', { name: '登录教学／管理工作区', exact: true }).click()
  await expect(page.getByTestId('return-student')).toBeVisible()
  await expect(page).toHaveURL(/\/staff\/login/)
  await expect(page.getByRole('status')).toContainText('当前账号尚未获得教师或管理权限')
})
