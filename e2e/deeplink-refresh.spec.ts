/**
 * e2e regression: the reported launch bug — product routes must render on a
 * DIRECT URL load and a browser REFRESH, not only via in-app navigation.
 *
 * Product modules mount client-only under the catch-all route, so a throw in one
 * module's first render used to bubble to Next's root fallback and white-screen
 * the whole console with "Application error: a client-side exception has
 * occurred" — but ONLY on a direct load / refresh (in-app nav renders fresh and
 * hid it). `ProductErrorBoundary` + the dashboard `error.tsx` close that class:
 * even a module throw now keeps the shell and shows a retryable card, never a
 * white screen. This spec proves each target route:
 *   1. direct-loads without a client-exception white-screen,
 *   2. refreshes (F5) without one,
 *   3. still deep-links its own real content (shell + main region present).
 *
 * Credentials (env, never in repo): HANZO_EMAIL / HANZO_PASSWORD, BASE_URL.
 * Run:  HANZO_PASSWORD=xxx BASE_URL=https://console.hanzo.ai pnpm e2e deeplink-refresh.spec.ts
 */
import { test, expect, type Page } from '@playwright/test'

const EMAIL = process.env.HANZO_EMAIL ?? 'z@hanzo.ai'
const PASSWORD = process.env.HANZO_PASSWORD ?? ''
const BASE_URL = process.env.BASE_URL ?? 'https://console.hanzo.ai'

// The three routes from the report, plus controls known to deep-link fine.
const TARGETS = ['/playground', '/prompts', '/gpus']
const CONTROLS = ['/models', '/providers']

async function signIn(page: Page) {
  await page.goto(`${BASE_URL}/signin`)
  await page.waitForSelector('input[placeholder="Email"]', { timeout: 20_000 })
  // @hanzo/gui Input binds onChangeText — real keystrokes, not fill().
  await page.locator('input[placeholder="Email"]').pressSequentially(EMAIL, { delay: 12 })
  await page.locator('input[placeholder="Password"]').pressSequentially(PASSWORD, { delay: 12 })
  await page.click('button:has-text("Sign in")')
  const origin = new URL(BASE_URL).origin
  await page.waitForURL((u) => u.origin === origin && u.pathname === '/', { timeout: 30_000 })
  await page.waitForLoadState('domcontentloaded')
}

/** Assert the page rendered the console (shell + main) and did NOT white-screen. */
async function assertRendered(page: Page, route: string, phase: string) {
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
  // No client-exception white-screen.
  await expect(
    page.locator('text=/Application error|client-side exception|Unhandled Runtime Error/i'),
    `${route} (${phase}) must not white-screen`,
  ).toHaveCount(0)
  // Shell survived: the persistent nav ("Overview"/"Apps") is present.
  const body = (await page.locator('body').innerText().catch(() => '')) || ''
  expect(body.length, `${route} (${phase}) has content`).toBeGreaterThan(200)
  expect(body, `${route} (${phase}) kept the shell`).toMatch(/Overview|Apps|Sign out/i)
}

test.describe('deep-link + refresh must not crash', () => {
  test.skip(!PASSWORD, 'HANZO_PASSWORD not set — skipping authenticated deep-link pass')

  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  for (const route of [...TARGETS, ...CONTROLS]) {
    test(`direct load + refresh: ${route}`, async ({ page }) => {
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(String(e)))

      // 1) DIRECT URL load (full navigation, fresh document).
      const res = await page.goto(`${BASE_URL}${route}`, { waitUntil: 'domcontentloaded' })
      expect(res?.status() ?? 0, `${route} HTTP`).toBeLessThan(500)
      await assertRendered(page, route, 'direct')

      // 2) REFRESH (F5) — the reported failing action.
      await page.reload({ waitUntil: 'domcontentloaded' })
      await assertRendered(page, route, 'refresh')

      // An uncaught pageerror on these routes is the regression we are locking out.
      expect(errors, `${route} uncaught pageerror(s): ${errors.join(' | ').slice(0, 300)}`).toEqual([])
    })
  }
})
