import { test, expect, ACCOUNTS } from './fixtures'

/**
 * OIDC callback hardening (client-side). The callback must surface an IdP error,
 * and — critically — reject a `state` it never issued (login-CSRF / code injection)
 * BEFORE exchanging the code. Both are pure client behavior, so they're hermetic.
 */
test.describe('OIDC callback', () => {
  test('surfaces an IdP error and offers a retry', async ({ page, backend }) => {
    backend.account(ACCOUNTS.anonymous)
    await page.goto('/auth/callback?error=access_denied&error_description=You%20declined')
    await expect(page.getByText('You declined')).toBeVisible()
    await expect(page.getByText('Back to sign in')).toBeVisible()
  })

  test('rejects a forged state (none was stored) before any code exchange', async ({ page, backend }) => {
    backend.account(ACCOUNTS.anonymous)
    await page.goto('/auth/callback?code=attacker_code&state=forged_state')
    await expect(page.getByText(/could not be verified|state mismatch/i)).toBeVisible()
    // It never lands on the dashboard (no session minted from a forged callback).
    await expect(page).not.toHaveURL(/\/$/)
  })
})
