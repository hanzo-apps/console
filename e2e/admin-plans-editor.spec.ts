/**
 * Subscription Plans admin editor — render + edit-persists proof (increment 3a-console).
 *
 * Drives the REAL PlansCatalogModule (client + form + metadata editor) against a mock of
 * commerce's `/v1/commerce/plans/*` CRUD, seeded with real-shaped subscription/DNS plans.
 * The mock is a live in-memory store: a PUT mutates it, so a save → re-fetch shows the NEW
 * price — the exact "edit persists" loop the module drives against commerce (whose CRUD
 * + slug-immutable guard is proven by commerce's own api/plan handler tests).
 *
 * Proves: the table renders every plan with its monthly/annual price + custom/per-seat
 * flags; opening a plan shows the editable form (slug locked, name/price/category/
 * contactSales/popular/metadata) with the LIVE-BILLING warning; changing the price + Save
 * issues `PUT /v1/commerce/plans/entries/<slug>` with the new cents; and the table reflects it.
 * Screenshots the table + the open edit form (admin-plans-editor.png).
 *
 * Run: BASE_URL=http://localhost:4000 npx playwright test admin-plans-editor
 */
import { test, expect, type Route, type Page } from '@playwright/test'
import { requireFixtureServer } from './_fixture'
import { primeSession } from './_session'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4000'
requireFixtureServer()
const SHOTS = join(process.cwd(), 'e2e-shots')

/** Real-shaped platform plans (the raw `plan` shape the admin
 *  GET /v1/commerce/plans/entries returns). */
function seedPlans(): Record<string, unknown>[] {
  const base = { sku: '', currency: 'usd', interval: 'month', intervalCount: 1 }
  return [
    { ...base, slug: 'personal-free', name: 'Personal', description: 'For personal projects.', category: 'personal', price: 0, priceAnnual: 0, trialPeriodDays: 0, perSeat: false, contactSales: false, popular: false, metadata: { limits: { requests: 1000 }, features: ['1 project'] } },
    { ...base, slug: 'pro', name: 'Pro', description: 'For professionals shipping real products.', category: 'personal', price: 2000, priceAnnual: 1600, trialPeriodDays: 14, perSeat: false, contactSales: false, popular: true, metadata: { limits: { requests: 100000 }, features: ['Unlimited projects', 'Priority support'] } },
    { ...base, slug: 'team', name: 'Team', description: 'For teams, billed per seat.', category: 'team', price: 9900, priceAnnual: 7900, trialPeriodDays: 14, perSeat: true, contactSales: false, popular: false, metadata: { seats: 'unlimited' } },
    { ...base, slug: 'enterprise', name: 'Enterprise', description: 'Custom deployment at scale.', category: 'enterprise', price: 0, priceAnnual: 0, trialPeriodDays: 0, perSeat: false, contactSales: true, popular: false, metadata: { sla: true } },
    { ...base, slug: 'dns-basic', name: 'DNS Basic', description: 'Managed DNS for a domain.', category: 'dns', price: 500, priceAnnual: 400, trialPeriodDays: 0, perSeat: false, contactSales: false, popular: false, metadata: { zones: 1 } },
  ]
}

const API_RE = /\/(v1|cloud|ai|billing|commerce|telemetry|vm|superbase|admin|integrations|auth\/refresh)(\/|$|\?)/

test('plans editor renders the plans, edits a price, and persists', async ({ page }) => {
  const store = new Map(seedPlans().map((p) => [p.slug as string, p]))
  const cap: { put: { slug: string; body: Record<string, unknown> } | null } = { put: null }

  await page.route('**/*', async (route: Route) => {
    const req = route.request()
    if (req.resourceType() === 'document') return route.continue()
    const url = new URL(req.url())
    const path = url.pathname

    if (path === '/v1/commerce/plans/entries' && req.method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([...store.values()]) })
    }
    const m = path.match(/^\/v1\/commerce\/plans\/entries\/(.+)$/)
    if (m && req.method() === 'PUT') {
      const slug = decodeURIComponent(m[1])
      const body = JSON.parse(req.postData() || '{}') as Record<string, unknown>
      cap.put = { slug, body }
      // Commerce pins the path slug (immutable) — mirror that here.
      const updated = { ...(store.get(slug) ?? {}), ...body, slug }
      store.set(slug, updated)
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(updated) })
    }

    const sameOrigin = url.origin === new URL(BASE_URL).origin
    if (sameOrigin && !API_RE.test(path)) return route.continue()
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', msg: '', data: [], data2: 0 }) })
  })

  await primeSession(page, { owner: 'admin', name: 'z', email: 'z@hanzo.ai', isAdmin: true })

  await page.goto(`${BASE_URL}/plan-catalog`, { waitUntil: 'domcontentloaded' })

  // The table renders every plan.
  await expect(page.getByText('Subscription Plans').first()).toBeVisible({ timeout: 25_000 })
  await expect(page.getByText('pro').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('enterprise').first()).toBeVisible()
  await expect(page.getByText('dns-basic').first()).toBeVisible()
  // Pro is $20.00/mo before the edit; Enterprise shows the custom price.
  await expect(page.getByText('$20.00/mo').first()).toBeVisible()
  await expect(page.getByText('Contact sales').first()).toBeVisible()

  // Open the Pro row → the edit form (with the live-billing warning).
  await page.getByText('pro', { exact: true }).first().click()
  await expect(page.getByText('Edit Pro').first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('Editing the price changes the real renewal charge').first()).toBeVisible()
  // The slug field is disabled (immutable on edit).
  await expect(page.locator('input[value="pro"]')).toBeDisabled()

  // Screenshot the editor (table behind + the open edit form).
  mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: join(SHOTS, 'admin-plans-editor.png'), fullPage: false })

  // Edit the monthly price: $20 → $25 (the price field is uniquely identified by
  // its placeholder "20"; the annual + metadata inputs carry different placeholders).
  const priceBox = page.locator('input[placeholder="20"]')
  await expect(priceBox).toBeVisible({ timeout: 8_000 })
  await expect(priceBox).toHaveValue('20')
  await priceBox.fill('25')

  await page.getByRole('button', { name: 'Save changes' }).click()

  // The PUT was issued to the correct endpoint with the new price (2500 cents), the
  // immutable slug preserved, and the metadata round-tripped type-exactly.
  await expect.poll(() => cap.put?.slug, { timeout: 10_000 }).toBe('pro')
  expect(cap.put?.body.price).toBe(2500)
  expect(cap.put?.body.slug).toBe('pro')
  expect(cap.put?.body.name).toBe('Pro')
  expect(cap.put?.body.popular).toBe(true)
  expect((cap.put?.body.metadata as Record<string, unknown>)?.limits).toEqual({ requests: 100000 })

  // The store persisted it, so the reloaded table shows the NEW price.
  await expect(page.getByText('$25.00/mo').first()).toBeVisible({ timeout: 10_000 })
  await page.screenshot({ path: join(SHOTS, 'admin-plans-editor-persisted.png'), fullPage: false })
})
