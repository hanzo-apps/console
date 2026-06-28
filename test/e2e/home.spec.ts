import { test, expect, ACCOUNTS, landAs, trackConsoleErrors } from './fixtures'

/**
 * The dashboard home is the unified catalog: every Hanzo product grouped by the
 * ten canonical categories, with honest enablement badges. It renders entirely
 * from the catalog registry, so this guards the rendered surface end-to-end.
 */
test.describe('catalog home', () => {
  test('renders all ten category sections', async ({ page, backend }) => {
    await landAs(page, backend, ACCOUNTS.admin)
    const content = page.getByTestId('page-content')
    for (const c of ['AI', 'Compute', 'Data', 'Network', 'Security', 'Dev', 'Deploy', 'Observe', 'Web3', 'Apps']) {
      await expect(content.getByText(c, { exact: true }).first()).toBeVisible()
    }
  })

  test('renders product cards with their Google-Cloud equivalents', async ({ page, backend }) => {
    await landAs(page, backend, ACCOUNTS.admin)
    const content = page.getByTestId('page-content')
    await expect(content.getByText('Model Garden')).toBeVisible() // Models gcp subtitle
    await expect(content.getByText('Secret Manager')).toBeVisible() // Secrets gcp subtitle
    await expect(content.getByText('Memorystore')).toBeVisible() // KV gcp subtitle
  })

  test('shows the three honest enablement badges', async ({ page, backend }) => {
    await landAs(page, backend, ACCOUNTS.admin)
    const content = page.getByTestId('page-content')
    await expect(content.getByText('Enabled').first()).toBeVisible()
    await expect(content.getByText('External').first()).toBeVisible()
    await expect(content.getByText('Soon').first()).toBeVisible()
  })

  test('learn-more opens the product discover interstitial', async ({ page, backend }) => {
    await landAs(page, backend, ACCOUNTS.admin)
    await page.getByLabel('Learn about Models').click()
    await page.waitForURL('**/discover/models')
    const content = page.getByTestId('page-content')
    await expect(content.getByText('Docs & guides')).toBeVisible()
    await expect(content.getByText('Open source gets paid')).toBeVisible()
  })

  test('renders with a clean browser console', async ({ page, backend }) => {
    const errors = trackConsoleErrors(page)
    await landAs(page, backend, ACCOUNTS.admin)
    await expect(page.getByTestId('page-content').getByText('Compute', { exact: true }).first()).toBeVisible()
    expect(errors).toEqual([])
  })
})
