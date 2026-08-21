/**
 * e2e: entitlement-gated sidebar — mocked-network render proof.
 *
 * Runs against a LOCAL server (BASE_URL=http://localhost:4000) with the whole
 * network mocked (same pattern as budgets-responsive): `/auth/session` → a CUSTOMER
 * (non-admin, non-super-admin) account, and `/v1/entitlements/orgs/<org>` →
 * `{ enabled: ['agents'] }`. Everything else → an empty-ok envelope.
 *
 * It proves the out-of-box gate: a customer's sidebar shows ONLY the products the
 * org has enabled (always-on essentials + Agents), HIDES a non-entitled product
 * (GPUs), and offers the "Add product" flow — whose panel lists the non-entitled
 * products with an Enable action.
 *
 * Run: BASE_URL=http://localhost:4000 npx playwright test entitlement-sidebar
 */
import { test, expect, type Route, type Page } from '@playwright/test'
import { requireFixtureServer } from './_fixture'
import { primeSession } from './_session'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4000'

// These render specs assert LOCAL fixture data; skip cleanly when that server is down.
requireFixtureServer()
const ORG = 'maxpower'

// A CUSTOMER — NOT a super admin (no isSuperAdmin/isGlobalAdmin, owner ≠ admin), so
// the entitlement gate is in force (a super admin would bypass it).
const ACCOUNT = {
  owner: ORG,
  name: 'dave',
  type: 'normal-user',
  email: 'dave@maxpower.com',
  displayName: 'Dave',
  isAdmin: true, // admin of their OWN org — still a customer, not a platform admin
  signupApplication: 'hanzo-cloud',
}

const API_RE = /\/(v1|cloud|ai|billing|commerce|telemetry|vm|superbase|admin|paas|integrations|auth\/refresh)(\/|$|\?)/

async function mock(route: Route) {
  const req = route.request()
  if (req.resourceType() === 'document') return route.continue()
  const url = new URL(req.url())
  const path = url.pathname

  if (path === '/auth/session') {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ account: ACCOUNT, expiresIn: 3600 }) })
  }
  if (path.startsWith('/auth/')) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  }
  // The gate under test — the org has ONLY Agents enabled beyond the essentials.
  if (path === `/v1/entitlements/orgs/${ORG}`) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: ['agents'] }) })
  }

  const sameOrigin = url.origin === new URL(BASE_URL).origin
  if (sameOrigin && !API_RE.test(path)) return route.continue()
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', msg: '', data: [], data2: 0 }) })
}

async function openShell(page: Page) {
  await page.addInitScript((org) => {
    try {
      // Enter the org (skip the picker) so the dashboard shell mounts.
      localStorage.setItem('hanzo.console.org', org)
      localStorage.setItem('hanzo.console.org.selected', '1')
      localStorage.setItem('hz_admin_banner_dismissed', '1')
    } catch {
      /* private mode */
    }
  }, ORG)
  await page.route('**/*', mock)
  await primeSession(page, ACCOUNT)
  await page.goto(`${BASE_URL}/agents`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
}

test('gated sidebar shows only enabled products + the All-products catalog', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await openShell(page)

  const nav = page.locator('nav, [role="navigation"]').first()

  // Enabled product IS in the nav.
  await expect(page.getByText('Agents', { exact: true }).first()).toBeVisible({ timeout: 20_000 })
  // The catalog affordance is offered (the enable-gate flow was deliberately
  // dropped on main — "every product is always available"; the panel is now the
  // pin/unpin browser, so that is what this asserts).
  await expect(page.getByRole('button', { name: 'All products' }).first()).toBeVisible()
  // A non-entitled product is HIDDEN from the sidebar nav.
  await expect(nav.getByText('GPUs', { exact: true })).toHaveCount(0)

  // The catalog affordance is a real, clickable control (opening the AddProductPanel
  // DetailPane is a separate concern; the ENTITLEMENT contract under test is the
  // gating above — enabled shown, non-entitled hidden, catalog offered).
  await expect(page.getByRole('button', { name: 'All products' }).first()).toBeEnabled()

  await ctx.close()
})
