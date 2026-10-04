import { expect, test } from '@playwright/test'

test('unknown public URL offers a working home link instead of an empty page', async ({ page }) => {
  await page.route('**/api/v1/health', (route) => route.fulfill({ json: { status: 'ok' } }))
  await page.goto('/missing-page/audit-only')
  await expect(page.getByRole('heading', { name: '页面不存在' })).toBeVisible()
  await page.getByRole('link', { name: '返回首页', exact: true }).click()
  await expect(page).toHaveURL(/\/about$/)
})

test('login connection failure has a useful Chinese error and stays retryable', async ({
  page,
}) => {
  await page.route('**/api/v1/health', (route) => route.fulfill({ json: { status: 'ok' } }))
  await page.route('**/api/v1/auth/login', (route) => route.abort('connectionrefused'))
  await page.goto('/login')
  await page.getByLabel('用户名或邮箱', { exact: true }).fill('synthetic-user')
  await page.getByLabel('密码', { exact: true }).fill('test-only-password')
  await page.getByRole('button', { name: '登录并继续测评', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('暂时无法连接登录服务')
  await expect(page.getByRole('button', { name: '登录并继续测评', exact: true })).toBeEnabled()
  await expect(page).toHaveURL(/\/login$/)
})
