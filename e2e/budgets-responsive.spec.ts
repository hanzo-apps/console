/**
 * e2e: Budgets & limits page — mocked-network render + RESPONSIVE proof.
 *
 * Runs against a LOCAL server (BASE_URL=http://localhost:4000) with the whole network
 * mocked (same pattern as blank-audit): `/auth/session` → a global admin so the shell
 * mounts, `/v1/billing/alerts` → real-shaped budget rows (org default + project
 * warn + service over + unlimited/rate-limit-only), everything else → an empty-ok
 * envelope.
 *
 * It proves the extended Budgets page renders real content at a desktop AND a NARROW
 * (mobile) viewport, that the body never scrolls horizontally on mobile (the CTO
 * requirement), and opens the inline edit form. Screenshots at each width.
 *
 * Run: BASE_URL=http://localhost:4000 npx playwright test budgets-responsive
 */
import { test, expect, type Route, type Page } from '@playwright/test'
import { requireFixtureServer } from './_fixture'
import { primeSession } from './_session'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4000'

// These render specs assert LOCAL fixture data; skip cleanly when that server is down.
requireFixtureServer()
const SHOTS = join(process.cwd(), 'e2e-shots')

const ACCOUNT = {
  owner: 'hanzo',
  name: 'z',
  type: 'normal-user',
  email: 'z@hanzo.ai',
  displayName: 'Z Admin',
  // Super admin via the CLAIM (owner is a normal org, not the reserved `admin`).
  // `isSuperAdmin` is canonical; `isGlobalAdmin` stays for legacy-claim coverage.
  isSuperAdmin: true,
  isGlobalAdmin: true,
  isAdmin: true,
  signupApplication: 'hanzo-cloud',
}

/** Real-shaped `/v1/billing/alerts` rows — one per verdict/scope (threshold = cents). */
const BUDGETS = [
  { id: 'b1', title: 'Org monthly cap', threshold: 500000, currency: 'usd', project: '', service: '', enforce: true, softPct: 80, rateLimitRpm: 0, periodSpentCents: 312000, over: false, warn: false },
  { id: 'b2', title: 'Inference budget', threshold: 200000, currency: 'usd', project: 'acme-prod', service: 'inference', enforce: false, softPct: 75, rateLimitRpm: 600, periodSpentCents: 186000, over: false, warn: true },
  { id: 'b3', title: 'Embeddings cap', threshold: 50000, currency: 'usd', project: '', service: 'embeddings', enforce: true, softPct: 80, rateLimitRpm: 300, periodSpentCents: 51500, over: true, warn: true },
  { id: 'b4', title: 'Sandbox throttle', threshold: 0, currency: 'usd', project: 'sandbox', service: '', enforce: false, softPct: 0, rateLimitRpm: 120, periodSpentCents: 8300, over: false, warn: false },
]

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
  // The page under test — the real alerts contract.
  if (path === '/v1/billing/alerts') {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BUDGETS) })
  }

  const sameOrigin = url.origin === new URL(BASE_URL).origin
  if (sameOrigin && !API_RE.test(path)) return route.continue()
  // Any other data call → an honest empty-ok envelope so the shell is quiet.
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', msg: '', data: [], data2: 0 }) })
}

async function openBudgets(page: Page) {
  await page.addInitScript((org) => {
    try {
      localStorage.setItem('hanzo.console.org', org)
      localStorage.setItem('hz_admin_banner_dismissed', '1')
    } catch {
      /* private mode */
    }
  }, ACCOUNT.owner)
  await page.route('**/*', mock)
  await primeSession(page, ACCOUNT)
  await page.goto(`${BASE_URL}/billing/budgets`, { waitUntil: 'domcontentloaded' })
  const content = page.locator('[data-testid="product-content"]').first()
  await content.waitFor({ state: 'attached', timeout: 20_000 })
  await expect(page.locator('text=Budgets & limits').first()).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(800)
}

test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }))

test('renders the budgets & limits page at a desktop viewport', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await openBudgets(page)

  // The four budgets + verdicts + scope labels + enforcement, from the real contract.
  await expect(page.locator('text=Organization default').first()).toBeVisible()
  await expect(page.locator('text=acme-prod · inference').first()).toBeVisible()
  await expect(page.locator('text=Over cap').first()).toBeVisible()
  await expect(page.locator('text=Unlimited').first()).toBeVisible()
  await expect(page.locator('text=Hard cap').first()).toBeVisible()

  await page.screenshot({ path: join(SHOTS, 'budgets-desktop.png'), fullPage: true })

  // Prove the inline edit form opens with the new controls (scope selector +
  // Enforce toggle + rate limit). `exact: true` — a substring match would hit the
  // "Cr-EDIT-s" tab (which contains "edit"); we want the card's Edit button.
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click()
  await expect(page.getByRole('button', { name: 'Save budget' }).first()).toBeVisible()
  await expect(page.locator('text=Enforce (hard cap)').first()).toBeVisible()
  await expect(page.locator('text=Rate limit').first()).toBeVisible()
  await page.screenshot({ path: join(SHOTS, 'budgets-edit.png'), fullPage: true })
  await ctx.close()
})

test('reflows with no horizontal body scroll at a narrow (mobile) viewport', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  await openBudgets(page)

  await expect(page.locator('text=Organization default').first()).toBeVisible()

  // The CTO requirement: the body must not scroll horizontally on mobile.
  const overflow = await page.evaluate(() => {
    const el = document.documentElement
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }
  })
  expect(overflow.scrollWidth, 'no horizontal body scroll at 390px').toBeLessThanOrEqual(overflow.clientWidth + 1)

  await page.screenshot({ path: join(SHOTS, 'budgets-mobile.png'), fullPage: true })
  await ctx.close()
})
