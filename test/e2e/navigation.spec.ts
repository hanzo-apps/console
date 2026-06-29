import { test, expect, ACCOUNTS, landAs } from './fixtures'

/**
 * The sidebar renders from the catalog: a curated Pinned section, then every
 * product by category. Each row opens the product and carries a pin toggle.
 */
test.describe('sidebar navigation', () => {
  test('renders the brand wordmark and category sections', async ({ page, backend }) => {
    await landAs(page, backend, ACCOUNTS.admin)
    const nav = page.getByTestId('nav-sidebar')
    await expect(nav.getByText('Hanzo Cloud Console')).toBeVisible()
    await expect(nav.getByText('AI', { exact: true })).toBeVisible()
    await expect(nav.getByText('Security', { exact: true })).toBeVisible()
  })

  test('first-run pins resolve to REAL products (regression: dead "billing" id)', async ({ page, backend }) => {
    // DEFAULT_PINNED was ['chat','billing'] — 'billing' is not a catalog id, so it
    // silently vanished and only Chat pinned. The fix pins ['chat','cost'].
    await landAs(page, backend, ACCOUNTS.admin)
    const pinned = page.getByTestId('pinned-section')
    await expect(pinned.getByText('Chat')).toBeVisible()
    await expect(pinned.getByText('Cost')).toBeVisible()
  })

  test('clicking a nav row opens the in-console module', async ({ page, backend }) => {
    await landAs(page, backend, ACCOUNTS.admin)
    await page.getByTestId('nav-sidebar').getByText('Providers', { exact: true }).click()
    await page.waitForURL('**/providers')
    await expect(page.getByTestId('page-content').getByText('Providers', { exact: true })).toBeVisible()
    await expect(page.getByText('No providers yet. Click Add to create one.')).toBeVisible()
  })

  test('pinning a product adds it to the Pinned section', async ({ page, backend }) => {
    await landAs(page, backend, ACCOUNTS.admin)
    const nav = page.getByTestId('nav-sidebar')
    // Models starts unpinned -> its star says "Pin Models".
    await nav.getByLabel('Pin Models').click()
    // Optimistic update: the same row now offers to unpin, and a Pinned row exists.
    await expect(nav.getByLabel('Unpin Models').first()).toBeVisible()
    await expect(page.getByTestId('pinned-section').getByText('Models', { exact: true })).toBeVisible()
  })

  test('an external product opens in a new tab (no in-app navigation)', async ({ page, context, backend }) => {
    await landAs(page, backend, ACCOUNTS.admin)
    // Keep it hermetic: stub the external origin so no real request leaves.
    await context.route(/docs\.hanzo\.ai/, (route) =>
      route.fulfill({ contentType: 'text/html', body: '<html><body>dns docs</body></html>' }),
    )
    const popupPromise = context.waitForEvent('page')
    await page.getByTestId('nav-sidebar').getByText('DNS', { exact: true }).click()
    const popup = await popupPromise
    await popup.waitForLoadState('domcontentloaded').catch(() => {})
    expect(popup.url()).toContain('docs.hanzo.ai')
    await expect(page).toHaveURL(/\/$/) // the main page did not navigate
  })

  test('gateway opens an in-console management view, not the raw API origin', async ({ page, backend }) => {
    await landAs(page, backend, ACCOUNTS.admin)
    await page.getByTestId('nav-sidebar').getByText('Gateway', { exact: true }).click()
    await expect(page).toHaveURL(/\/gateway$/)
    await expect(page.getByTestId('page-content').getByText('Base URL', { exact: true })).toBeVisible()
  })
})
