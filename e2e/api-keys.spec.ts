/**
 * e2e: the API Keys page reports what the account actually holds.
 *
 * The measured defect: `GET /v1/account/keys` answered 200 with three `pk-live-*`
 * publishable keys, and the page rendered the "create your first key" empty state —
 * because it asked only whether an `sk-` existed and dropped every other row. A true
 * statement about the secret, presented as the whole truth about the account.
 *
 * The two shapes stay visibly different here, which is the point: `sk-` resolves to
 * the USER and is session-equivalent (revealed once, then masked to a prefix), while
 * `pk-` resolves only to the ORG and authenticates nobody, so it is shown in full.
 *
 * Run: BASE_URL=http://localhost:4000 npx playwright test api-keys
 */
import { test, expect, type Page, type Route } from '@playwright/test'

import { requireFixtureServer } from './_fixture'
import { primeSession } from './_session'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4000'

requireFixtureServer()

/** The live wire shape: three publishable keys, no secret. */
const PUBLISHABLE_ONLY = {
  keys: [
    { type: 'publishable', prefix: 'pk-live-7ad', key: 'pk-live-7ad384e90719fa', createdAt: '2026-08-08T11:33:36Z' },
    { type: 'publishable', prefix: 'pk-live-e09', key: 'pk-live-e096d9c3659d99', createdAt: '2026-08-02T21:25:53Z' },
    { type: 'publishable', prefix: 'pk-live-348', key: 'pk-live-3489a31d546129', createdAt: '2026-08-06T20:36:38Z' },
  ],
}

const json = (route: Route, body: unknown) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

async function mockKeys(page: Page, body: unknown): Promise<void> {
  await page.route('**/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/v1/account/keys')) return json(route, body)
    return json(route, {})
  })
  await primeSession(page)
}

async function openKeys(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/api-keys`, { waitUntil: 'domcontentloaded' })
  // Either card proves the surface painted; with publishable keys present BOTH are on
  // the page, so take the first rather than tripping strict mode.
  await expect(
    page.getByText('Create your Cloud API key').or(page.getByText('Publishable keys')).first(),
  ).toBeVisible({ timeout: 45_000 })
}

test('publishable keys the account holds are listed, in full', async ({ page }) => {
  await mockKeys(page, PUBLISHABLE_ONLY)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await openKeys(page)

  await expect(page.getByText('Publishable keys')).toBeVisible()
  for (const k of ['pk-live-7ad384e90719fa', 'pk-live-e096d9c3659d99', 'pk-live-3489a31d546129']) {
    await expect(page.getByText(k, { exact: true })).toBeVisible()
  }
})

test('holding publishable keys does NOT claim a secret key exists', async ({ page }) => {
  await mockKeys(page, PUBLISHABLE_ONLY)
  await openKeys(page)

  // The account genuinely has no `sk-`, so the mint card is the correct render — it
  // is simply no longer the ONLY thing on the page. Merging the two shapes would make
  // a browser-safe key look session-equivalent, which is the one thing to never do.
  await expect(page.getByText('Create your Cloud API key')).toBeVisible()
})

test('an account holding nothing at all still says so', async ({ page }) => {
  await mockKeys(page, { keys: [] })
  await openKeys(page)

  await expect(page.getByText('Create your Cloud API key')).toBeVisible()
  await expect(page.getByText('Publishable keys')).toHaveCount(0)
})
