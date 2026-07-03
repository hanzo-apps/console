/**
 * e2e: the Open Edition (run-for-pay) overview renders its real, product-specific
 * content — not just "a page mounted".
 *
 * `pages.spec.ts` proves /open-edition is reachable + doesn't crash (the generic
 * sweep). THIS spec proves the run-for-pay board actually rendered the things that
 * make it the Open Edition board: the "Open Edition" heading, the run-for-pay
 * framing, the "cost + 25%" margin caption on the Spend KPI, and the spend/tokens
 * KPI labels — all sourced from the config in
 * src/components/products/overview/living/registry.ts (id `open-edition`), which
 * reads the REAL commerce usage ledger scoped to the open-edition product tag.
 *
 * These are content assertions on the live surface, not a stub: if the config is
 * unwired, the route unrouted, or the board silently swapped for another usage
 * view, a specific assertion fails.
 *
 * Credentials (env, never in repo):
 *   HANZO_EMAIL     default z@hanzo.ai (global admin — sees every product)
 *   HANZO_PASSWORD  required (skips when unset)
 *   BASE_URL        default https://console.hanzo.ai
 *
 * Run:  HANZO_PASSWORD=xxx pnpm e2e open-edition.spec.ts
 */
import { test, expect, type Page } from '@playwright/test'

const EMAIL = process.env.HANZO_EMAIL ?? 'z@hanzo.ai'
const PASSWORD = process.env.HANZO_PASSWORD ?? ''
const BASE_URL = process.env.BASE_URL ?? 'https://console.hanzo.ai'

async function signIn(page: Page) {
  await page.goto(`${BASE_URL}/signin`)
  await page.waitForSelector('input[placeholder="Email"]', { timeout: 20_000 })
  await page.fill('input[placeholder="Email"]', EMAIL)
  await page.fill('input[placeholder="Password"]', PASSWORD)
  await page.click('button:has-text("Sign in")')
  const base = new URL(BASE_URL).origin
  await page.waitForURL((url) => url.origin === base && url.pathname === '/', { timeout: 30_000 })
  await page.waitForLoadState('domcontentloaded')
}

test.describe('Open Edition — run-for-pay overview renders real content', () => {
  test.skip(!PASSWORD, 'HANZO_PASSWORD not set — skipping authenticated Open Edition visual gate')

  let ctx: import('@playwright/test').BrowserContext
  let page: Page

  test.beforeAll(async ({ browser }) => {
    ctx = await browser.newContext()
    page = await ctx.newPage()
    await signIn(page)
  })

  test.afterAll(async () => {
    await ctx?.close()
  })

  test('the /open-edition board mounts, is reachable, and does not crash', async () => {
    const errors: string[] = []
    const onErr = (e: Error) => errors.push(String(e))
    page.on('pageerror', onErr)

    const res = await page.goto(`${BASE_URL}/open-edition`, { waitUntil: 'domcontentloaded' })
    expect(res?.status() ?? 0, '/open-edition HTTP').toBeLessThan(500)

    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
    await expect(page.locator('text=/Application error|Unhandled Runtime Error/i')).toHaveCount(0)

    const bodyText = (await page.locator('body').innerText().catch(() => '')) || ''
    expect(bodyText.trim().length, '/open-edition rendered content').toBeGreaterThan(0)

    page.off('pageerror', onErr)
    if (errors.length) console.log(`⚠ /open-edition pageerror: ${errors.join(' | ').slice(0, 200)}`)
  })

  test('renders the Open Edition run-for-pay header + the cost+25% Spend KPI', async () => {
    await page.goto(`${BASE_URL}/open-edition`, { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})

    // The product heading — this is the Open Edition board, not a generic usage view.
    await expect(page.getByText('Open Edition', { exact: false }).first()).toBeVisible({ timeout: 20_000 })

    // The run-for-pay framing from the config subtitle (`Run open-source workloads
    // for pay …`). Matches on the distinctive phrase so it can't pass on another board.
    await expect(page.getByText(/run open-source workloads for pay/i).first()).toBeVisible()

    // The load-bearing pricing detail: the Spend KPI carries the "cost + 25% margin"
    // caption (the served revenue R = cost + resell margin). This is the visible
    // proof the 25% run-for-pay model is surfaced, not just tokens.
    await expect(page.getByText(/cost \+ 25% margin/i).first()).toBeVisible()

    // The run-for-pay KPI labels the config declares (spend billed, tokens run).
    await expect(page.getByText(/spend billed/i).first()).toBeVisible()
    await expect(page.getByText(/tokens run/i).first()).toBeVisible()
  })

  test('captures a full-page screenshot of the Open Edition board', async () => {
    await page.goto(`${BASE_URL}/open-edition`, { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
    // Wait for the heading so the shot is of the rendered board, not a spinner frame.
    await expect(page.getByText('Open Edition', { exact: false }).first()).toBeVisible({ timeout: 20_000 })
    await page.screenshot({ path: 'e2e/screenshots/open-edition.png', fullPage: true })
  })
})
