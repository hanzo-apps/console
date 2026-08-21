/**
 * e2e: GPUs page — connected-fleet render + RESPONSIVE proof (phone + tablet).
 *
 * Runs against a LOCAL server (BASE_URL=http://localhost:4000) with the whole network
 * mocked (same pattern as budgets-responsive): `/auth/session` → a NON-admin customer so
 * the customer GPUs surface (CustomerGpus) mounts, `/v1/visor/fleet/workers` → the
 * home-lab fleet (dbc / evo / spark, the exact byoWorker shape), and every other data
 * call → an honest empty-ok envelope. It proves the "Connected machines" section renders
 * the real fleet with live heartbeat, that the body never scrolls horizontally on a
 * phone (390) OR a tablet (768), and screenshots each width.
 *
 * Run: BASE_URL=http://localhost:4000 npx playwright test gpus-responsive
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

// A NON-admin customer (owner is a normal org, not the reserved `admin`) → the customer
// GPUs surface, which reads /v1/visor/fleet/workers. (An admin would see the platform
// fleet board instead.)
const ACCOUNT = {
  owner: 'hanzo',
  name: 'a',
  type: 'normal-user',
  email: 'a@hanzo.ai',
  displayName: 'A',
  isSuperAdmin: false,
  isGlobalAdmin: false,
  isAdmin: false,
  signupApplication: 'hanzo-cloud',
}

/** The org's connect fleet, exactly as `GET /v1/visor/fleet/workers` reports it. */
const WORKERS = [
  { id: 'dbc', hostname: 'dbc', provider: 'byo', location: 'on-prem', status: 'online', os: 'darwin', version: '1.4.0', lastHeartbeat: new Date().toISOString(), gpus: [{ name: 'Apple M3 Max', memoryTotal: '131072 MiB' }], capabilities: ['studio.render'] },
  { id: 'evo', hostname: 'evo', provider: 'byo', location: 'on-prem', status: 'online', os: 'linux', version: '1.4.0', lastHeartbeat: new Date().toISOString(), gpus: [{ name: 'NVIDIA RTX 4090', memoryTotal: '131072 MiB' }], capabilities: ['engine.serve'], engine: { url: 'http://evo:8080', apis: ['openai'], models: ['zen5'], status: 'ready' } },
  { id: 'spark', hostname: 'spark', provider: 'byo', location: 'on-prem', status: 'offline', os: 'linux', version: '1.4.0', lastHeartbeat: new Date(Date.now() - 10 * 60_000).toISOString(), gpus: [{ name: 'NVIDIA GB10', memoryTotal: '131072 MiB' }], capabilities: [] },
]

const API_RE = /\/(v1|cloud|ai|billing|commerce|telemetry|vm|superbase|admin|integrations|auth\/refresh)(\/|$|\?)/

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
  // The page under test — the real connect-fleet contract.
  if (path === '/v1/visor/fleet/workers') {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ workers: WORKERS }) })
  }
  // Wallet chip balance (sidebar) — a real {balance,holds,available} shape.
  if (path === '/v1/billing/balance') {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ balance: 4200, holds: 0, available: 4200 }) })
  }

  const sameOrigin = url.origin === new URL(BASE_URL).origin
  if (sameOrigin && !API_RE.test(path)) return route.continue()
  // Any other data call → an honest empty-ok envelope so the shell is quiet.
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', msg: '', data: [], data2: 0 }) })
}

async function openGpus(page: Page) {
  await page.addInitScript((org) => {
    try {
      localStorage.setItem('hanzo.console.org', org)
      localStorage.setItem('hanzo.console.org.selected', '1')
      localStorage.setItem('hz_admin_banner_dismissed', '1')
      // Skip the first-run onboarding wizard (its local completion guard), so the
      // GPUs surface mounts instead of the takeover.
      localStorage.setItem(`hz_onboarding_done:${org}`, '1')
    } catch {
      /* private mode */
    }
  }, ACCOUNT.owner)
  await page.route('**/*', mock)
  await primeSession(page, ACCOUNT)
  await page.goto(`${BASE_URL}/gpus`, { waitUntil: 'domcontentloaded' })
  const content = page.locator('[data-testid="product-content"]').first()
  await content.waitFor({ state: 'attached', timeout: 20_000 })
  await expect(page.locator('text=Connected machines').first()).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(600)
}

/** The body must never scroll horizontally (the mobile requirement). */
async function assertNoHorizontalScroll(page: Page, label: string) {
  const overflow = await page.evaluate(() => {
    const el = document.documentElement
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }
  })
  expect(overflow.scrollWidth, `no horizontal body scroll at ${label}`).toBeLessThanOrEqual(overflow.clientWidth + 1)
}

test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }))

test('renders the connected fleet with heartbeat at a desktop viewport', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await openGpus(page)

  // The three home-lab boxes + their online/offline state, from the real contract.
  await expect(page.locator('text=dbc').first()).toBeVisible()
  await expect(page.locator('text=evo').first()).toBeVisible()
  await expect(page.locator('text=spark').first()).toBeVisible()
  await expect(page.locator('text=NVIDIA GB10').first()).toBeVisible()
  await expect(page.locator('text=Online').first()).toBeVisible()
  await expect(page.locator('text=Offline').first()).toBeVisible()

  await page.screenshot({ path: join(SHOTS, 'gpus-fleet-desktop.png'), fullPage: true })
  await ctx.close()
})

test('reflows with no horizontal body scroll on a phone (390x844)', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  await openGpus(page)

  await expect(page.locator('text=Connected machines').first()).toBeVisible()
  await assertNoHorizontalScroll(page, '390px')

  await page.screenshot({ path: join(SHOTS, 'gpus-fleet-mobile.png'), fullPage: true })
  await ctx.close()
})

test('reflows with no horizontal body scroll on a tablet (768x1024)', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 768, height: 1024 } })
  const page = await ctx.newPage()
  await openGpus(page)

  await expect(page.locator('text=Connected machines').first()).toBeVisible()
  await assertNoHorizontalScroll(page, '768px')

  await page.screenshot({ path: join(SHOTS, 'gpus-fleet-tablet.png'), fullPage: true })
  await ctx.close()
})
