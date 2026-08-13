import { test, expect } from '@playwright/test'
import { primeSession } from './_session'

/**
 * The EMBED shape, which is the one that ships: cloud serves the root page's
 * index.html for every deep link, so the root page must resolve the live path and
 * hand it to ProductRoute. A dev server never exercises this — it has a real
 * catch-all route — so a dev-server test passes while production renders the home
 * board at /billing. Run this against a built `out/` served with an index fallback.
 */
const PRODUCTS = ['billing', 'models', 'agents', 'playground', 'functions']

for (const p of PRODUCTS) {
  test(`embed deep link /${p} renders its product, not the home board`, async ({ page }) => {
    await primeSession(page)
    await page.route('**/v1/**', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '{"data":[]}' }),
    )
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto(`/${p}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3500)
    // "Token volume" is written by the home board and by nothing else.
    const board = await page.getByText('Token volume', { exact: true }).count()
    expect(board, `/${p} rendered the HOME board instead of its product`).toBe(0)
  })
}

test('the root still renders the home board', async ({ page }) => {
  await primeSession(page)
  await page.route('**/v1/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"data":[]}' }),
  )
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.getByText('Token volume', { exact: true })).toBeVisible({ timeout: 30_000 })
})
