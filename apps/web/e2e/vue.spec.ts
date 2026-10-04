import { test, expect } from '@playwright/test'

// See here how to get started:
// https://playwright.dev/docs/intro
test('visits the app root url', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle('AI Measure · AI能力测评与成长平台')
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
  await expect(page.locator('h1')).toContainText('测出你与AI')
  await expect(page.getByRole('link', { name: /开始标准测评/ })).toBeVisible()
})
