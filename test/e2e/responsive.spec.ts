import { test, expect, ACCOUNTS, landAs } from './fixtures'

/** The console must render on desktop and mobile viewports. */
test.describe('responsive layout', () => {
  test('desktop renders the sidebar + content', async ({ page, backend }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await landAs(page, backend, ACCOUNTS.admin)
    await expect(page.getByTestId('nav-sidebar')).toBeVisible()
    await expect(page.getByTestId('page-content')).toBeVisible()
  })

  test('mobile renders the catalog home', async ({ page, backend }) => {
    await page.setViewportSize({ width: 390, height: 844 }) // iPhone-ish
    await landAs(page, backend, ACCOUNTS.admin)
    await expect(page.getByTestId('page-content').getByText('Compute', { exact: true }).first()).toBeVisible()
  })

  test('mobile renders the sign-in card', async ({ page, backend }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    backend.account(ACCOUNTS.anonymous)
    await page.goto('/signin')
    await expect(page.getByText('Continue with Hanzo ID')).toBeVisible()
    await expect(page.getByText('Sign in to manage your cloud.')).toBeVisible()
  })
})
