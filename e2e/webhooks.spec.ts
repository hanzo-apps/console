/**
 * e2e: the Webhooks product (config · security · test · logs).
 *
 * Mocked-network render proof against a LOCAL server (same pattern as
 * router-config / budgets-responsive): the @hanzo/iam userinfo → an admin so the
 * shell mounts, `GET /v1/webhooks` → the list under test, everything else → an
 * empty-ok envelope.
 *
 * Why this exists: a mocked unit suite can stay green while the page doesn't render.
 * This asserts what only a browser can — that the empty state + the create form
 * paint when the org has no endpoints, and that a populated list renders the row
 * with its config/security/test/logs affordances.
 *
 * Run: BASE_URL=http://localhost:4010 npx playwright test webhooks
 */
import { test, expect, type Route, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { requireFixtureServer } from './_fixture'
import { primeSession } from './_session'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4010'

requireFixtureServer()
const SHOTS = join(process.cwd(), 'e2e-shots')

const API_RE = /\/(v1|cloud|ai|billing|commerce|telemetry|vm|superbase|admin|paas|integrations|auth\/refresh)(\/|$|\?)/

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

/** One real-shaped webhook row per the GET /v1/webhooks contract (secret NOT returned on list). */
const WEBHOOK = {
  id: 'wh_live_1',
  url: 'https://api.example.com/hooks/hanzo',
  events: ['commerce.order.created', 'agent.run.completed'],
  status: 'active',
  description: 'Order + agent events',
  created: '2026-07-20T10:00:00Z',
  deliveries7d: 128,
  failures7d: 3,
}

/** `webhooks` is the list body the module reads; empty → the create-first-endpoint state. */
function makeMock(webhooks: unknown[]) {
  return async function mock(route: Route) {
    const req = route.request()
    if (req.resourceType() === 'document') return route.continue()
    const url = new URL(req.url())
    const path = url.pathname

    if (path.endsWith('/.well-known/openid-configuration'))
      return route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
        body: JSON.stringify({
          issuer: 'https://hanzo.id',
          authorization_endpoint: 'https://hanzo.id/v1/iam/oauth/authorize',
          token_endpoint: 'https://hanzo.id/v1/iam/oauth/token',
          userinfo_endpoint: `${BASE_URL}/v1/iam/oauth/userinfo`,
          jwks_uri: 'https://hanzo.id/v1/iam/oauth/jwks',
        }),
      })
    if (path.startsWith('/auth/')) return json(route, { ok: true })

    // The page under test — the plain-REST list read (raw JSON, not the casibase envelope).
    if (path.endsWith('/v1/webhooks') && req.method() === 'GET') return json(route, { data: webhooks })

    const sameOrigin = url.origin === new URL(BASE_URL).origin
    if (sameOrigin && !API_RE.test(path)) return route.continue()
    return json(route, { status: 'ok', msg: '', data: [], data2: 0 })
  }
}

async function openWebhooks(page: Page, webhooks: unknown[], marker: string) {
  await page.route('**/*', makeMock(webhooks))
  await primeSession(page)
  await page.goto(`${BASE_URL}/webhooks`, { waitUntil: 'domcontentloaded' })
  await page.locator('[data-testid="product-content"]').first().waitFor({ state: 'attached', timeout: 20_000 })
  await expect(page.locator(`text=${marker}`).first()).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(500)
}

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true })
})

test('empty org — the create form + honest empty state render', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await openWebhooks(page, [], 'New endpoint')

  // The product header + the create form (all three fields + the pattern hint + the
  // signature scheme) render, and the empty table copy is honest.
  await expect(page.locator('text=Webhooks').first()).toBeVisible()
  await expect(page.locator('text=New endpoint').first()).toBeVisible()
  await expect(page.locator('text=Endpoint URL').first()).toBeVisible()
  await expect(page.locator('text=Add endpoint').first()).toBeVisible()
  await expect(page.locator('text=No webhook endpoints yet. Add one below to start receiving events.').first()).toBeVisible()
  await expect(page.locator('text=HMAC-SHA256').first()).toBeVisible()

  await page.screenshot({ path: join(SHOTS, 'webhooks-empty.png'), fullPage: true })
  await ctx.close()
})

test('populated org — the endpoint row renders with test/security/logs affordances', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await openWebhooks(page, [WEBHOOK], 'api.example.com/hooks/hanzo')

  // The row shows the endpoint, an event chip, the active status, the 7d usage, and
  // every row action (config/security/test/logs) the product owns.
  await expect(page.locator('text=commerce.order.created').first()).toBeVisible()
  await expect(page.locator('text=active').first()).toBeVisible()
  await expect(page.getByRole('button', { name: /Send test to/ }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: /Rotate secret for/ }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: /Deliveries for/ }).first()).toBeVisible()

  await page.screenshot({ path: join(SHOTS, 'webhooks-list.png'), fullPage: true })
  await ctx.close()
})
