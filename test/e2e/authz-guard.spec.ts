import { test, expect, ACCOUNTS, landAs, baseline } from './fixtures'

/**
 * Function-level authz at the catch-all route. A non-admin who reaches an
 * admin-only URL directly (deep link, typed URL, stale tab) must get an honest
 * "Access required" — the admin module must NEVER mount (and so never fire its
 * privileged `/v1` calls). Nav hiding is cosmetic; this is the gate.
 */
const ADMIN_ROUTES = ['iam', 'kms', 'secrets', 'audit', 'clusters', 'kubernetes']

test.describe('catch-all admin guard', () => {
  for (const id of ADMIN_ROUTES) {
    test(`non-admin is denied /${id} (Access required)`, async ({ page, backend }) => {
      baseline(backend)
      await landAs(page, backend, ACCOUNTS.member)
      await page.goto(`/${id}`)
      await expect(page.getByTestId('page-content').getByText('Access required')).toBeVisible()
    })
  }

  test('admin CAN load an admin route (no guard card)', async ({ page, backend }) => {
    baseline(backend)
    await landAs(page, backend, ACCOUNTS.admin)
    await page.goto('/clusters')
    await expect(page.getByTestId('page-content')).toBeVisible()
    await expect(page.getByText('Access required')).toHaveCount(0)
  })
})
