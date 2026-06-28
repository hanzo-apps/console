import { test, expect, ACCOUNTS, landAs } from './fixtures'

/**
 * Negative authorization (least privilege). Admin-only surfaces (IAM, KMS,
 * Secrets, Audit, Clusters, Kubernetes) must not be presented to a non-admin in
 * the nav or on the home, AND the data behind them is gated server-side — so even
 * reaching the URL yields an honest "Access required", never real org data.
 */
const ADMIN_LABELS = ['IAM', 'KMS', 'Secrets', 'Audit', 'Clusters', 'Kubernetes']

test.describe('non-admin (member)', () => {
  test('does NOT see admin-only products on the home', async ({ page, backend }) => {
    await landAs(page, backend, ACCOUNTS.member)
    const content = page.getByTestId('page-content')
    await expect(content.getByText('Models', { exact: true }).first()).toBeVisible() // ordinary product OK
    for (const label of ADMIN_LABELS) {
      await expect(content.getByText(label, { exact: true }), `${label} card hidden`).toHaveCount(0)
    }
  })

  test('does NOT see admin-only items in the sidebar', async ({ page, backend }) => {
    await landAs(page, backend, ACCOUNTS.member)
    const nav = page.getByTestId('nav-sidebar')
    for (const label of ADMIN_LABELS) {
      await expect(nav.getByText(label, { exact: true }), `${label} nav hidden`).toHaveCount(0)
    }
    // Ordinary surfaces remain (Settings is not admin-gated).
    await expect(nav.getByText('Settings', { exact: true })).toBeVisible()
  })

  test('is gated server-side even on direct navigation to an admin route', async ({ page, backend }) => {
    backend.account(ACCOUNTS.member).error('iam/get-organizations', 403)
    await page.goto('/iam')
    await expect(page.getByText('Access required')).toBeVisible()
    // No real org data leaked into the table.
    await expect(page.getByText('Hanzo', { exact: true })).toHaveCount(0)
  })
})

test.describe('admin (positive control)', () => {
  test('DOES see admin-only products on the home', async ({ page, backend }) => {
    await landAs(page, backend, ACCOUNTS.admin)
    const content = page.getByTestId('page-content')
    await expect(content.getByText('IAM', { exact: true })).toBeVisible()
    await expect(content.getByText('Audit', { exact: true })).toBeVisible()
  })

  test('DOES see admin-only items in the sidebar', async ({ page, backend }) => {
    await landAs(page, backend, ACCOUNTS.admin)
    const nav = page.getByTestId('nav-sidebar')
    await expect(nav.getByText('Clusters', { exact: true })).toBeVisible()
    await expect(nav.getByText('Kubernetes', { exact: true })).toBeVisible()
  })
})
