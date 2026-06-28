import { test, expect, ACCOUNTS, trackConsoleErrors } from './fixtures'

/**
 * Auth is delegated to Hanzo IAM (OIDC). The console gates every dashboard route
 * behind a real session: an anonymous/absent session is logged-out and must be
 * bounced to /signin; a real session lands on the dashboard; sign-out clears it.
 */
test.describe('authentication', () => {
  test('an unauthenticated visitor is redirected to /signin', async ({ page, backend }) => {
    backend.account(ACCOUNTS.anonymous) // casibase auto-anon == logged-out
    await page.goto('/')
    await page.waitForURL('**/signin')
    await expect(page.getByText('Sign in to manage your cloud.')).toBeVisible()
  })

  test('the sign-in page offers IAM, GitHub, and Google (no credential fields)', async ({ page, backend }) => {
    backend.account(ACCOUNTS.anonymous)
    await page.goto('/signin')
    await expect(page.getByText('Continue with Hanzo ID')).toBeVisible()
    await expect(page.getByText('Continue with GitHub')).toBeVisible()
    await expect(page.getByText('Continue with Google')).toBeVisible()
    // Delegated auth: the console never collects a password.
    await expect(page.locator('input[type="password"]')).toHaveCount(0)
  })

  test('"Continue with Hanzo ID" starts the IAM authorize redirect with the right client', async ({ page, backend }) => {
    backend.account(ACCOUNTS.anonymous)
    // Stop the cross-origin navigation at the IAM host and assert the URL.
    await page.route(/hanzo\.id/, (route) =>
      route.fulfill({ contentType: 'text/html', body: '<html><body>IAM</body></html>' }),
    )
    await page.goto('/signin')
    await page.getByText('Continue with Hanzo ID').click()
    await page.waitForURL(/hanzo\.id\/login\/oauth\/authorize/)
    const url = page.url()
    expect(url).toContain('client_id=hanzo-cloud')
    expect(url).toContain('response_type=code')
    expect(url).toContain(encodeURIComponent('/auth/callback'))
  })

  test('GitHub button hints the github provider on the authorize redirect', async ({ page, backend }) => {
    backend.account(ACCOUNTS.anonymous)
    await page.route(/hanzo\.id/, (route) =>
      route.fulfill({ contentType: 'text/html', body: '<html><body>IAM</body></html>' }),
    )
    await page.goto('/signin')
    await page.getByText('Continue with GitHub').click()
    await page.waitForURL(/hanzo\.id/)
    expect(page.url()).toContain('provider_hint=provider-github')
  })

  test('a real session lands on the dashboard home', async ({ page, backend }) => {
    backend.account(ACCOUNTS.admin)
    await page.goto('/')
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByText(/See, enable, and manage every .* product from one place/)).toBeVisible()
  })

  test('the session persists across a reload (no bounce to signin)', async ({ page, backend }) => {
    backend.account(ACCOUNTS.admin)
    await page.goto('/')
    await expect(page.getByText(/See, enable, and manage every/)).toBeVisible()
    await page.reload()
    await expect(page).not.toHaveURL(/signin/)
    await expect(page.getByText(/See, enable, and manage every/)).toBeVisible()
  })

  test('signing out clears the session and returns to /signin', async ({ page, backend }) => {
    backend.account(ACCOUNTS.admin).envelope('signout', 'ok')
    await page.goto('/')
    await expect(page.getByText(/See, enable, and manage every/)).toBeVisible()
    // After signout the client clears the account; AuthGate bounces to /signin.
    await page.getByText('Sign out').click()
    await page.waitForURL('**/signin')
    await expect(page.getByText('Sign in to manage your cloud.')).toBeVisible()
  })

  test('the OAuth callback shows an honest error when the code is missing', async ({ page, backend }) => {
    backend.account(ACCOUNTS.anonymous)
    const errors = trackConsoleErrors(page)
    await page.goto('/auth/callback')
    await expect(page.getByText('Missing authorization code.')).toBeVisible()
    await expect(page.getByText('Back to sign in')).toBeVisible()
    expect(errors).toEqual([])
  })
})
