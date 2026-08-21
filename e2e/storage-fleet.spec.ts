/**
 * e2e: admin.hanzo.ai Block Storage — the realtime DO block-storage fleet board.
 *
 * Renders `/block-storage` as a super-admin (primeSession owner:'admin') against a
 * LOCAL fixture server with the network mocked, and asserts the board is REAL + HONEST:
 * (1) the analytics datastore is highlighted with its fill (200 GiB · 7%); (2) the fleet
 * KPIs show the real volume count + monthly cost; (3) a near-full volume raises an alert;
 * (4) a volume with NO fill reported renders an honest "—", never a fabricated number;
 * (5) nothing crashes. One screenshot so the board is visible.
 *
 * Run: BASE_URL=http://localhost:4000 npx playwright test storage-fleet
 */
import { test, expect, type Route } from '@playwright/test'
import { requireFixtureServer } from './_fixture'
import { primeSession } from './_session'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4000'
requireFixtureServer()
const SHOTS = join(process.cwd(), 'e2e-shots')

/** The super-admin identity (a@hanzo.ai in the reserved `admin` org). */
const ADMIN = { owner: 'admin', name: 'a', email: 'a@hanzo.ai', displayName: 'Admin', isAdmin: true }

/** A realistic fleet snapshot — the live shape: 295 volumes, the datastore at 7%, a
 * near-full sibling, and one volume DO reports with no fill (honest "—"). */
const SNAPSHOT = {
  fleet: { count: 295, totalGiB: 13000, usedGiB: null, pct: null, monthlyUsd: 1309 },
  datastore: { name: 'datastore-data-datastore-0', mount: '/var/lib/hanzo-datastore', sizeGiB: 200, usedGiB: 13.5, pct: 7 },
  volumes: [
    { id: 'vol-1', name: 'pvc-datastore', region: 'sfo3', sizeGiB: 200, usedGiB: 13.5, pct: 7, attached: true, service: 'datastore-0' },
    { id: 'vol-2', name: 'pvc-o11y', region: 'sfo3', sizeGiB: 100, usedGiB: 91, pct: 91, attached: true, service: 'o11y' },
    { id: 'vol-3', name: 'pvc-detached', region: 'sfo3', sizeGiB: 50, usedGiB: null, pct: null, attached: false, service: null },
  ],
  alerts: [{ volume: 'o11y', pct: 91, level: 'critical' }],
}

const API_RE = /\/(v1|cloud|ai|billing|commerce|telemetry|vm|superbase|admin|integrations|auth\/refresh)(\/|$|\?)/

/** Serve the real snapshot for the storage read; honest-empty for every other API. */
async function mock(route: Route) {
  const req = route.request()
  if (req.resourceType() === 'document') return route.continue()
  const url = new URL(req.url())
  if (/\/v1\/admin\/volumes(\/|$|\?)/.test(url.pathname)) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SNAPSHOT) })
  }
  const sameOrigin = url.origin === new URL(BASE_URL).origin
  if (sameOrigin && !API_RE.test(url.pathname)) return route.continue()
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', msg: '', data: [], data2: 0 }) })
}

test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }))

test('Block Storage renders the datastore, fleet KPIs, alerts, and honest "—"', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.route('**/*', mock)
  await primeSession(page, ADMIN)
  await page.goto(`${BASE_URL}/block-storage`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500) // let the SPA hydrate + the module fetch/render

  // (1) The analytics datastore is highlighted with its real fill. Scope the text
  // assertions to the card — "analytics datastore" also appears in the header subtitle.
  const card = page.getByTestId('datastore-card')
  await expect(card, 'the datastore card is missing').toBeVisible({ timeout: 10_000 })
  await expect(card.getByText('Analytics datastore')).toBeVisible()
  await expect(card.getByText('200 GiB')).toBeVisible() // the datastore capacity (14 GiB / 200 GiB)

  // (2) Fleet KPIs — the real volume count + monthly cost (never a fabricated fill).
  await expect(page.getByText('295')).toBeVisible() // Volumes
  await expect(page.getByText('$1,309')).toBeVisible() // Fleet cost

  // (3) A near-full volume raised an alert.
  await expect(page.getByText('Near-full volumes')).toBeVisible()
  await expect(page.getByText('91%').first()).toBeVisible()

  // (4) The detached volume DO reports with no fill renders an honest "—".
  await expect(page.getByText('—').first()).toBeVisible()

  await page.screenshot({ path: join(SHOTS, 'block-storage.png'), fullPage: true })

  // (5) No crash.
  const crashed = await page.locator('text=/Something went wrong|Application error|Cannot read prop/i').first().isVisible().catch(() => false)
  expect(crashed, 'the board rendered an error boundary').toBe(false)
  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0)

  await ctx.close()
})
