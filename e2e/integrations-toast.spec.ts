/**
 * The OAuth return raises EXACTLY ONE toast.
 *
 * A unit test cannot see this bug. It is a render loop: the toast provider built
 * its context value fresh on every render and used it as the value, so every
 * useToast() consumer got a new identity whenever a toast was added — and the
 * integrations effect both DEPENDS on the toast api and RAISES a toast. Raising
 * one re-rendered the provider, which handed the effect a new api, which raised
 * another. Live this stacked ~15 identical "Connected slack" cards down the
 * viewport. Stripping the query params could not stop it: router.replace is
 * asynchronous, so the params are still readable on the renders in between.
 *
 * So the assertion is a COUNT after the loop has had time to run, on the real
 * rendered DOM — the only place the defect exists.
 */
import { test, expect } from '@playwright/test'
import { primeSession } from './_session'

const PROVIDERS = [
  {
    id: 'slack',
    name: 'Slack',
    description: 'Post messages and receive events in your Slack workspace.',
    category: 'Communication',
    available: true,
    connected: true,
    connection: { account: 'The Foundation', connectedAt: '2026-08-05T00:16:49Z' },
  },
]

test.describe('integrations OAuth return', () => {
  test.beforeEach(async ({ page }) => {
    // Everything else answers empty so the module mounts standalone.
    await page.route('**/v1/**', async (route) => {
      const url = route.request().url()
      if (url.includes('/v1/integrations')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PROVIDERS) })
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":[]}' })
    })
    await primeSession(page)
  })

  test('a connected= return raises exactly one toast', async ({ page }) => {
    await page.goto('/integrations?connected=slack&account=The+Foundation')

    const toasts = page.getByText('Connected slack')
    await expect(toasts.first()).toBeVisible({ timeout: 15_000 })

    // Give the loop every chance to run: the effect re-fires on each provider
    // re-render, and the pre-fix build had stacked well past a dozen by now.
    await page.waitForTimeout(3_000)
    expect(await toasts.count()).toBe(1)

    await page.screenshot({ path: 'e2e-shots/integrations-one-toast.png', fullPage: false })
  })

  test('the callback params are stripped so a reload cannot replay it', async ({ page }) => {
    await page.goto('/integrations?connected=slack&account=The+Foundation')
    await expect(page.getByText('Connected slack').first()).toBeVisible({ timeout: 15_000 })

    await expect.poll(() => new URL(page.url()).search, { timeout: 10_000 }).toBe('')
  })
})
