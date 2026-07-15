/**
 * e2e: the per-org Fleet board (feat/fleet-board).
 *
 * Fixture render against a LOCAL server with the network mocked (the
 * provider-billing / budgets-responsive pattern): `/auth/session` → a PLAIN customer
 * (not an admin — Fleet is the customer's own compute and must render without any
 * admin claim), and `/v1/fleet` → a fixture that exercises every honest path at once:
 * a fully-reporting GPU host, an online-but-SILENT laptop (the one state that asks
 * for attention), a machine that reports NO telemetry (the em-dash rule), a draining
 * cluster, and an offline box.
 *
 * Four states are proven, because all four are real:
 *   (1) the board with data      — the happy path, desktop + mobile
 *   (2) the empty fleet          — a real org with nothing linked yet
 *   (3) a 404 from /v1/fleet     — the backend is not routed on this deployment YET
 *                                  (the state this ships into until cloud deploys)
 *   (4) the unit detail          — the trend over /v1/fleet/samples
 *
 * Run: BASE_URL=http://localhost:4000 npx playwright test fleet
 */
import { test, expect, type Page, type Route } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4000'
const SHOTS = join(process.cwd(), 'e2e-shots')

/** A PLAIN customer — no admin claim. Fleet must work for them; that is the point. */
const ACCOUNT = {
  owner: 'maxpower',
  name: 'dave',
  type: 'normal-user',
  email: 'dave@maxpower.example',
  displayName: 'Dave',
  isGlobalAdmin: false,
  isAdmin: false,
  signupApplication: 'hanzo-cloud',
}

const GB = 1024 ** 3
const now = () => Math.floor(Date.now() / 1000)

/**
 * The fleet fixture — shaped EXACTLY like the documented `/v1/fleet` contract
 * (camelCase views, `omitempty` semantics: an unreported field is simply absent).
 */
const units = () => [
  {
    // Fully reporting GPU host — every meter has a real value.
    unit: 'spark-gb10',
    source: 'byo',
    kind: 'gpu',
    label: 'spark',
    host: 'spark.local',
    status: 'online',
    spec: { os: 'linux', arch: 'arm64', cpus: 20, memory: 128 * GB, gpus: [{ vendor: 'nvidia', model: 'GB10', memory: 120 * GB }] },
    metrics: { load1: 3.2, load5: 2.8, load15: 2.1, memUsed: 48 * GB, memFree: 80 * GB, gpuUtil: 0.86, at: now() - 8 },
    sessions: 12,
    running: 2,
  },
  {
    // ONLINE BUT SILENT — 11 minutes since its last heartbeat. The attention case.
    unit: 'dave-mbp',
    source: 'agent',
    kind: 'laptop',
    label: 'dave-mbp',
    host: 'dave-mbp.local',
    status: 'online',
    spec: { os: 'darwin', arch: 'arm64', cpus: 12, memory: 32 * GB, gpus: [{ vendor: 'apple', model: 'M3 Max' }] },
    metrics: { load1: 1.1, memUsed: 18 * GB, memFree: 14 * GB, at: now() - 660 },
    sessions: 3,
    running: 0,
  },
  {
    // Reports NO telemetry at all — every live cell must be an em-dash, never a 0.
    unit: 'web-1',
    source: 'visor',
    kind: 'machine',
    label: 'web-1',
    host: '10.0.0.4',
    status: 'online',
    spec: { os: 'linux', arch: 'amd64', cpus: 2, memory: 4 * GB },
    sessions: 0,
    running: 0,
  },
  {
    unit: 'prod-cluster',
    source: 'cloud',
    kind: 'cluster',
    label: 'prod-cluster',
    status: 'draining',
    spec: { os: 'linux', arch: 'amd64', cpus: 96, memory: 384 * GB },
    metrics: { load1: 12.0, memUsed: 190 * GB, memFree: 194 * GB, at: now() - 20 },
    sessions: 1,
    running: 0,
  },
  {
    unit: 'old-box',
    source: 'agent',
    kind: 'laptop',
    label: 'old-box',
    status: 'offline',
    spec: { os: 'linux', arch: 'amd64', cpus: 8, memory: 16 * GB },
    sessions: 0,
    running: 0,
  },
]

/** A descending-then-rising GPU trend, plus a row that carried NO gpu column (a gap). */
const samples = () => {
  const t0 = now() - 3600
  return Array.from({ length: 12 }, (_, i) => {
    const ts = t0 + i * 300
    const row: Record<string, unknown> = { ts, cpus: 20, memory: 128 * GB, load1: 2 + Math.sin(i) }
    // Row 5 deliberately carries no gpu_util — the chart must SKIP it, not plot 0.
    if (i !== 5) row.gpu_util = 0.4 + 0.05 * i
    row.mem_used = (40 + i) * GB
    return row
  })
}

// The proven harness set (provider-billing / budgets-responsive). Deliberately NOT
// widened to `/org/*`: the OrgGate resolves the org from the localStorage scope set
// in `open()` and tolerates the real backend's 403, whereas an empty-ok fixture for
// get-organization stalls it.
const API_RE = /\/(v1|cloud|ai|billing|commerce|telemetry|vm|superbase|admin|paas|integrations|auth\/refresh)(\/|$|\?)/

type FleetMode = 'data' | 'empty' | 'notfound'

function makeMock(mode: FleetMode) {
  return async function mock(route: Route) {
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
    if (path === '/v1/fleet/samples') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ samples: samples() }) })
    }
    if (path === '/v1/fleet') {
      if (mode === 'notfound') {
        return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Not found' }) })
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ units: mode === 'empty' ? [] : units() }),
      })
    }

    const sameOrigin = url.origin === new URL(BASE_URL).origin
    if (sameOrigin && !API_RE.test(path)) return route.continue()
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', msg: '', data: [], data2: 0 }) })
  }
}

async function open(page: Page, mode: FleetMode, path = '/fleet') {
  await page.addInitScript((org) => {
    try {
      localStorage.setItem('hanzo.console.org', org)
      localStorage.setItem('hanzo.console.org.selected', '1')
      localStorage.setItem('hz_onboarding_done:' + org, '1')
      localStorage.setItem('hz_admin_banner_dismissed', '1')
    } catch {
      /* private mode */
    }
  }, ACCOUNT.owner)
  await page.route('**/*', makeMock(mode))
  await page.goto(`${BASE_URL}${path}`, { waitUntil: 'domcontentloaded' })
  const content = page.locator('[data-testid="product-content"]').first()
  // Generous: against `next dev` the first paint of a route compiles + ships ~20
  // un-minified chunks, which is far slower than the built bundle this ships as.
  await content.waitFor({ state: 'attached', timeout: 60_000 })
  return content
}

test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }))

test.describe('the board renders real per-org compute', () => {
  test('desktop — summary, attention banner, and every unit', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await ctx.newPage()
    const content = await open(page, 'data')
    await expect(content.getByText('spark').first()).toBeVisible({ timeout: 20_000 })
    await page.waitForTimeout(600)

    // Summary: 5 units, 3 online (spark + dave-mbp + web-1; draining/offline are not).
    await expect(content.getByText('Units', { exact: true }).first()).toBeVisible()
    await expect(content.getByText('GPU util', { exact: true }).first()).toBeVisible()

    // The attention banner NAMES the online-but-silent unit.
    await expect(content.getByText(/online but no longer reporting/i).first()).toBeVisible()
    await expect(content.getByText(/dave-mbp/).first()).toBeVisible()

    // Per-unit state, asserted INSIDE each card — the filter <select> also contains
    // the words "draining"/"offline"/"byo" as hidden <option>s, so a page-wide text
    // match would prove nothing about the pills.
    const card = (label: string) => page.locator(`[aria-label^="${label}"]`).first()
    await expect(card('prod-cluster')).toContainText('Draining')
    await expect(card('old-box')).toContainText('Offline')
    // (the badge is uppercased in CSS, so the DOM text is the label's own casing)
    await expect(card('spark')).toContainText('BYO')
    await expect(card('web-1')).toContainText('Visor')

    // The fully-reporting host shows REAL live numbers.
    await expect(card('spark')).toContainText('86.0%')
    await expect(card('spark')).toContainText('linux/arm64 · 20 vCPU · 128.0 GB · 1× GB10')

    await page.screenshot({ path: join(SHOTS, 'fleet-desktop.png'), fullPage: true })
    await ctx.close()
  })

  test('a unit that reports NO telemetry renders em-dashes, never a fabricated 0', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await ctx.newPage()
    const content = await open(page, 'data')
    await expect(content.getByText('web-1').first()).toBeVisible({ timeout: 20_000 })

    // web-1's card: no metrics at all ⇒ Load/Mem/GPU are em-dashes and its heartbeat
    // age is an em-dash. Critically it must NOT read "0.00" / "0%".
    const card = page.locator('[aria-label^="web-1"]').first()
    await expect(card).toBeVisible()
    const text = (await card.innerText()).replace(/\s+/g, ' ')
    expect(text).toContain('—')
    expect(text).not.toMatch(/0\.00/)
    expect(text).not.toMatch(/\b0%/)
    await ctx.close()
  })

  test('mobile — no horizontal body scroll (mission control on a phone)', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await ctx.newPage()
    const content = await open(page, 'data')
    await expect(content.getByText('spark').first()).toBeVisible({ timeout: 20_000 })
    await page.waitForTimeout(600)

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)

    await page.screenshot({ path: join(SHOTS, 'fleet-mobile.png'), fullPage: true })
    await ctx.close()
  })
})

test.describe('honest states', () => {
  test('an empty fleet says how to link compute — it never fabricates a unit', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await ctx.newPage()
    const content = await open(page, 'empty')
    await expect(content.getByText('No compute linked yet').first()).toBeVisible({ timeout: 20_000 })
    await expect(content.getByText(/hanzo code --link/).first()).toBeVisible()
    await page.screenshot({ path: join(SHOTS, 'fleet-empty.png'), fullPage: true })
    await ctx.close()
  })

  test('a 404 from /v1/fleet is an honest not-routed card, never a crash', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await ctx.newPage()
    const content = await open(page, 'notfound')
    // The shared BackendStateCard's 404 copy + the endpoint hint.
    await expect(content.getByText(/not (available|routed)/i).first()).toBeVisible({ timeout: 20_000 })
    await expect(content.getByText('GET /v1/fleet').first()).toBeVisible()
    await page.screenshot({ path: join(SHOTS, 'fleet-notrouted.png'), fullPage: true })
    await ctx.close()
  })
})

test.describe('unit detail', () => {
  test('deep link renders the spec + the utilization trend', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await ctx.newPage()
    const content = await open(page, 'data', '/fleet/byo/spark-gb10')
    await expect(content.getByText('Spec', { exact: true }).first()).toBeVisible({ timeout: 20_000 })
    await page.waitForTimeout(900)

    await expect(content.getByText('Utilization').first()).toBeVisible()
    await expect(content.getByText('GPU utilization').first()).toBeVisible()
    await expect(content.getByText('Load average (1m)').first()).toBeVisible()
    await expect(content.getByText('12 sessions · 2 running now').first()).toBeVisible()
    // The trend drew real SVG paths (not the "no data" note).
    expect(await content.locator('svg path').count()).toBeGreaterThan(2)

    await page.screenshot({ path: join(SHOTS, 'fleet-detail.png'), fullPage: true })
    await ctx.close()
  })

  test('a deep link to an unknown unit says so instead of hanging or 404ing', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await ctx.newPage()
    const content = await open(page, 'data', '/fleet/byo/does-not-exist')
    await expect(content.getByText('Unit not found').first()).toBeVisible({ timeout: 20_000 })
    await ctx.close()
  })
})
