/**
 * Subsystems + Money admin boards — render + interaction proof.
 *
 * Drives the REAL modules (client + shared sort/filter/format + the shared DataTable)
 * against mocks of `/v1/admin/subsystems` and `/v1/admin/money`.
 *
 * Proves the things a status-code check cannot: that a header click genuinely REORDERS
 * rows (the first row's name changes), that typing genuinely NARROWS the table, that a
 * disabled subsystem is visibly disabled, that cents render as formatted dollars, and —
 * the honesty property the whole subsystems board rests on — that when the trace
 * warehouse is down the numeric columns read as em-dash "unknown" rather than "0",
 * with a banner saying so, while the inventory stays fully populated.
 *
 * Screenshots to e2e-shots/admin-{subsystems,subsystems-blind,money}.png.
 *
 * Run: BASE_URL=http://localhost:4000 npx playwright test admin-subsystems-money
 */
import { test, expect, type Page, type Route } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { requireFixtureServer } from './_fixture'
import { primeSession } from './_session'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4000'
requireFixtureServer()
const SHOTS = join(process.cwd(), 'e2e-shots')

const API_RE = /\/(v1|cloud|ai|billing|commerce|telemetry|vm|superbase|admin|paas|integrations|auth\/refresh)(\/|$|\?)/

// ── fixtures ──────────────────────────────────────────────────────────────────

/** Six subsystems with DELIBERATELY misaligned orderings, so a sort must really move rows. */
const SUBSYSTEMS = [
  { name: 'ai', requests: 41000, requestsPerMin: 28.5, errors: 120, errorRate: 0.29, latencyP50Ms: 42, latencyP95Ms: 910, latencyP99Ms: 2400 },
  { name: 'iam', requests: 98000, requestsPerMin: 68.1, errors: 4, errorRate: 0.004, latencyP50Ms: 3, latencyP95Ms: 18, latencyP99Ms: 44 },
  { name: 'kms', requests: 5200, requestsPerMin: 3.6, errors: 0, errorRate: 0, latencyP50Ms: 6, latencyP95Ms: 31, latencyP99Ms: 80 },
  { name: 'commerce', requests: 1200, requestsPerMin: 0.8, errors: 61, errorRate: 5.08, latencyP50Ms: 120, latencyP95Ms: 1500, latencyP99Ms: 4100 },
  { name: 'zzz-quiet', requests: 0, requestsPerMin: 0, errors: 0, errorRate: 0, latencyP50Ms: 0, latencyP95Ms: 0, latencyP99Ms: 0 },
].map((s) => ({
  ...s,
  prefixes: [`/v1/${s.name}`],
  enabled: true,
  lastErrorAt: s.errors ? '2026-07-27T09:00:00Z' : '',
  lastErrorRoute: s.errors ? `/v1/${s.name}/thing` : '',
  lastErrorStatus: s.errors ? '500' : '',
  lastErrorMessage: s.errors ? 'upstream timeout' : '',
}))

/** One subsystem that is switched OFF — the "why is this board empty" answer. */
const DISABLED = {
  name: 'ads',
  prefixes: ['/v1/ads'],
  enabled: false,
  requests: 0, requestsPerMin: 0, errors: 0, errorRate: 0,
  latencyP50Ms: 0, latencyP95Ms: 0, latencyP99Ms: 0,
  lastErrorAt: '', lastErrorRoute: '', lastErrorStatus: '', lastErrorMessage: '',
}

const ROWS = [...SUBSYSTEMS, DISABLED]

function subsystemBoard(tracesOk: boolean) {
  return {
    range: '24h',
    start: '2026-07-26T10:00:00Z',
    end: '2026-07-27T10:00:00Z',
    totals: { subsystems: 6, enabled: 5, disabled: 1, reporting: 4, requests: 145400, errors: 185, errorRate: 0.13 },
    rows: tracesOk ? ROWS : ROWS.map((r) => ({ ...r, requests: 0, requestsPerMin: 0, errors: 0, errorRate: 0, latencyP50Ms: 0, latencyP95Ms: 0, latencyP99Ms: 0 })),
    sources: [
      { name: 'mount-index', ok: true, rows: 6, error: '', at: '2026-07-27T10:00:00Z' },
      { name: 'traces', ok: tracesOk, rows: tracesOk ? 5 : 0, error: tracesOk ? '' : 'trace warehouse not connected', at: '2026-07-27T10:00:00Z' },
    ],
  }
}

const MONEY = {
  revenue: { realizedCents: 1284050, mrrCents: 249900, arrCents: 2998800, arpuCents: 64202, customers: 42, paying: 20 },
  credits: { grantedCents: 500000, grantedTrialCents: 150000, grantedPrepaidCents: 350000, consumedCents: 1284050, outstandingCents: 873400, grants: 17 },
  infrastructure: {
    period: '2026-07',
    vendorCogsCents: 412000, doMonthToDateCents: 176300, doCreditRemainingCents: 2600000, doAvgDailyBurnCents: 6530,
    treasuryReserveCents: 95000, vendors: [],
  },
  margin: { grossCents: 695750, grossPct: 54.2, profitable: true, runwayDays: 398 },
  byOrg: [
    { org: 'acme', display: 'Acme Corp', plan: 'Team', spendCents: 640000, balanceCents: 210000, mrrCents: 99900, grantedCents: 300000, grants: 4 },
    { org: 'globex', display: 'Globex', plan: 'Pro', spendCents: 412050, balanceCents: 480000, mrrCents: 99900, grantedCents: 0, grants: 0 },
    { org: 'initech', display: 'Initech', plan: 'Free', spendCents: 232000, balanceCents: 183400, mrrCents: 50100, grantedCents: 200000, grants: 13 },
  ],
  generatedAt: '2026-07-27T10:00:00Z',
  sources: [{ name: 'revenue:iam', ok: true, rows: 42, error: '', at: '2026-07-27T10:00:00Z' }],
}

// ── harness ───────────────────────────────────────────────────────────────────

const envelope = (data: unknown) => ({ status: 'ok', msg: '', data })

async function mockAdmin(page: Page, opts: { tracesOk?: boolean } = {}) {
  await page.route('**/*', async (route: Route) => {
    const req = route.request()
    if (req.resourceType() === 'document') return route.continue()
    const url = new URL(req.url())
    const path = url.pathname

    if (path === '/v1/admin/subsystems' && req.method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(envelope(subsystemBoard(opts.tracesOk ?? true))) })
    }
    if (path === '/v1/admin/money' && req.method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(envelope(MONEY)) })
    }

    const sameOrigin = url.origin === new URL(BASE_URL).origin
    if (sameOrigin && !API_RE.test(path)) return route.continue()
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', msg: '', data: [], data2: 0 }) })
  })
  await primeSession(page, { owner: 'admin', name: 'z', email: 'z@hanzo.ai', isAdmin: true })
}

/**
 * The first DATA row. `.hz-row` is the row class DataTable puts on body rows only —
 * the header carries role="row", so a role-based selector would silently return the
 * column headings and every sort assertion would pass against unchanging text.
 */
function dataRows(page: Page) {
  return page.locator('.hz-row')
}

async function firstRow(page: Page): Promise<string> {
  return (await dataRows(page).first().textContent()) ?? ''
}

// ── specs ─────────────────────────────────────────────────────────────────────

test('subsystems board renders the inventory, sorts, and filters', async ({ page }) => {
  mkdirSync(SHOTS, { recursive: true })
  await mockAdmin(page)

  await page.goto(`${BASE_URL}/subsystems`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByText('Subsystems').first()).toBeVisible({ timeout: 30_000 })

  // KPI band: 6 mounted, 5 on, 1 off, 4 actually serving traffic.
  await expect(page.getByText('Reporting').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('145,400').first()).toBeVisible()

  // Every subsystem has a row, including the silent one and the disabled one.
  for (const name of ['ai', 'iam', 'kms', 'commerce', 'zzz-quiet', 'ads']) {
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible()
  }
  // The disabled one says so — that is the answer to "why is this board empty".
  await expect(page.getByText('disabled', { exact: true }).first()).toBeVisible()

  await page.screenshot({ path: join(SHOTS, 'admin-subsystems.png'), fullPage: true })

  // SORT: default is requests desc → iam (98k) leads. Clicking Subsystem sorts by name.
  const beforeSort = await firstRow(page)
  expect(beforeSort).toContain('iam')

  await page.getByRole('columnheader', { name: 'Sort by Subsystem' }).click()
  await expect.poll(async () => await firstRow(page), { timeout: 10_000 }).not.toBe(beforeSort)
  expect(await firstRow(page)).toContain('ads') // name asc

  // FILTER: typing narrows the table live, with no Apply button.
  await page.getByPlaceholder('Search subsystems, routes, errors…').fill('kms')
  await expect.poll(async () => await dataRows(page).count(), { timeout: 10_000 }).toBe(1)
  expect(await firstRow(page)).toContain('kms')
})

test('with the trace warehouse down the board says unknown, not zero', async ({ page }) => {
  mkdirSync(SHOTS, { recursive: true })
  await mockAdmin(page, { tracesOk: false })

  await page.goto(`${BASE_URL}/subsystems`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByText('Subsystems').first()).toBeVisible({ timeout: 30_000 })

  // The banner states it plainly.
  await expect(page.getByText(/Trace warehouse unavailable/)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/unknown \(not zero\)/)).toBeVisible()

  // The INVENTORY is still fully populated — that half needs no warehouse.
  for (const name of ['ai', 'iam', 'kms', 'ads']) {
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible()
  }
  // And the numeric columns read as em-dash rather than a fabricated 0.
  await expect(page.getByText('—').first()).toBeVisible()

  await page.screenshot({ path: join(SHOTS, 'admin-subsystems-blind.png'), fullPage: true })
})

test('money board consolidates revenue, credits, infra cost — and sorts by customer', async ({ page }) => {
  mkdirSync(SHOTS, { recursive: true })
  await mockAdmin(page)

  await page.goto(`${BASE_URL}/fleet-money`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByText('Money').first()).toBeVisible({ timeout: 30_000 })

  // Cents render as formatted dollars — the money contract, end to end.
  await expect(page.getByText('$12,840.50').first()).toBeVisible({ timeout: 15_000 }) // realized revenue
  await expect(page.getByText('$2,499.00').first()).toBeVisible() // MRR
  await expect(page.getByText('$29,988.00').first()).toBeVisible() // ARR = 12 x MRR
  await expect(page.getByText('$8,734.00').first()).toBeVisible() // outstanding credit

  // Granted vs consumed, split by bucket.
  await expect(page.getByText('$5,000.00').first()).toBeVisible() // granted
  await expect(page.getByText('$3,500.00').first()).toBeVisible() // prepaid
  await expect(page.getByText('$1,500.00').first()).toBeVisible() // trial

  // Infrastructure cost.
  await expect(page.getByText('$4,120.00').first()).toBeVisible() // vendor COGS
  await expect(page.getByText('$1,763.00').first()).toBeVisible() // DO month-to-date
  await expect(page.getByText('$26,000.00').first()).toBeVisible() // DO credit left

  await page.screenshot({ path: join(SHOTS, 'admin-money.png'), fullPage: true })

  // SORT: default is spend desc → Acme ($6,400) leads. Outstanding is a different
  // ordering entirely (Initech $1,834 < Acme $2,100 < Globex $4,800), so both
  // directions prove the click really reorders rather than coincidentally agreeing.
  expect(await firstRow(page)).toContain('Acme')
  const outstanding = page.getByRole('columnheader', { name: 'Sort by Outstanding' })
  await outstanding.click() // a new key starts ascending → smallest first
  await expect.poll(async () => await firstRow(page), { timeout: 10_000 }).toContain('Initech')
  await outstanding.click() // same key flips → largest first
  await expect.poll(async () => await firstRow(page), { timeout: 10_000 }).toContain('Globex')

  // FILTER narrows live.
  await page.getByPlaceholder('Search customers…').fill('initech')
  await expect.poll(async () => await dataRows(page).count(), { timeout: 10_000 }).toBe(1)
  expect(await firstRow(page)).toContain('Initech')
})
