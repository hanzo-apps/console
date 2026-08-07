/**
 * e2e: Agents › Runs — mocked-network render proof of the run → trace drill-down.
 *
 * Same pattern as workbench/budgets-responsive: a LOCAL server with the network
 * mocked (primeSession seeds the IAM-PKCE identity; `/v1/agents/runs` returns two
 * real-shaped RunView rows — one WITH a `traceId`, one WITHOUT).
 *
 * It proves the thing unit tests can't: that the surface RENDERS, that the traced
 * run actually navigates to the existing `/o11y/<traceId>` waterfall, and that the
 * run with no trace shows an honest "no trace recorded" instead of a dead link.
 *
 * Run: BASE_URL=http://localhost:4010 npx playwright test agent-runs
 */
import { test, expect, type Page, type Route } from '@playwright/test'
import { requireFixtureServer } from './_fixture'
import { primeSession } from './_session'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4010'

requireFixtureServer(BASE_URL)
const SHOTS = join(process.cwd(), 'e2e-shots')

const now = Date.now()

/** Two runs in the exact RunView shape — the second omits every `omitempty` field. */
const RUNS = {
  runs: [
    {
      id: 'run_traced',
      status: 'ok',
      model: 'zen5',
      input: 'summarize the incident',
      output: 'three services degraded',
      durationMs: 1840,
      createdAt: new Date(now - 60_000).toISOString(),
      agent: 'triage',
      actor: 'z@hanzo.ai',
      traceId: 'trace_91b2',
      promptTokens: 1204,
      completionTokens: 318,
      toolCalls: 3,
    },
    {
      // Recorded before tracing existed: no traceId, no token counts, no tool calls.
      id: 'run_untraced',
      status: 'error',
      model: 'zen5-mini',
      input: 'check the queue',
      error: 'tool timeout after 30s',
      durationMs: 420,
      createdAt: new Date(now - 600_000).toISOString(),
      agent: 'sweeper',
      actor: 'cron',
    },
  ],
}

const API_RE = /\/(v1|cloud|ai|billing|commerce|telemetry|vm|superbase|admin|paas|integrations|auth\/refresh)(\/|$|\?)/

/** Every `/v1/agents/runs` URL the page requested — the status-filter passthrough proof. */
const runsUrls: string[] = []

async function mock(route: Route) {
  const req = route.request()
  if (req.resourceType() === 'document') return route.continue()
  const url = new URL(req.url())

  if (url.pathname === '/v1/agents/runs') {
    runsUrls.push(url.search)
    const want = url.searchParams.get('status')
    const runs = want ? RUNS.runs.filter((r) => r.status === want) : RUNS.runs
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ runs }) })
  }

  const sameOrigin = url.origin === new URL(BASE_URL).origin
  if (sameOrigin && !API_RE.test(url.pathname)) return route.continue()
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', msg: '', data: [], data2: 0 }) })
}

async function openRuns(page: Page) {
  await page.route('**/*', mock)
  await primeSession(page)
  await page.goto(`${BASE_URL}/agents/runs`, { waitUntil: 'domcontentloaded' })
  await expect(page.locator('text=triage').first()).toBeVisible({ timeout: 30_000 })
}

test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }))

test('the feed lists runs and only a run WITH a trace offers the trace link', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await openRuns(page)

  // Both runs render, with their real recorded values.
  await expect(page.locator('text=sweeper').first()).toBeVisible()
  await expect(page.locator('text=1,204 / 318').first()).toBeVisible()
  await expect(page.locator('text=1.84s').first()).toBeVisible()

  // Exactly ONE trace affordance — the traced run. The other says so honestly.
  await expect(page.getByRole('button', { name: 'Trace', exact: true })).toHaveCount(1)
  await expect(page.locator('text=No trace').first()).toBeVisible()

  // …and it is actually ON SCREEN. The table's natural min-width is the sum of its
  // column widths; an over-wide set pushed the trace link — the whole point of this
  // surface — off the right edge behind the table's own horizontal scroll. A
  // visibility check does NOT catch that (a clipped element still has a box), so
  // measure the scroller: at 1440 the table must not need to scroll sideways at all.
  const overflow = await page.evaluate(() => {
    // Walk up from a header cell to the nearest horizontal scroller — the wrapper
    // DataTable puts its `min-width` table inside.
    let el = document.querySelector('[role="columnheader"]')?.parentElement ?? null
    while (el && getComputedStyle(el).overflowX !== 'auto') el = el.parentElement
    return el ? { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth } : null
  })
  expect(overflow).not.toBeNull()
  expect(overflow!.scrollWidth).toBeLessThanOrEqual(overflow!.clientWidth)
  await page.screenshot({ path: join(SHOTS, 'agent-runs-list.png') })

  // The link closes the gap: it lands on the EXISTING trace waterfall.
  await page.getByRole('button', { name: 'Trace', exact: true }).click()
  await expect(page).toHaveURL(/\/o11y\/trace_91b2$/)

  await ctx.close()
})

test('a run with no traceId renders an honest no-trace detail, never a dead link', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await openRuns(page)

  await page.getByLabel('Open run run_untraced').click()
  await expect(page).toHaveURL(/\/agents\/runs\/run_untraced$/)

  // Every recorded field is shown; the failure is shown as a failure.
  await expect(page.locator('text=tool timeout after 30s').first()).toBeVisible()
  await expect(page.locator('text=No trace recorded').first()).toBeVisible()
  // No link is offered, because there is nothing to open.
  await expect(page.getByRole('button', { name: 'View trace' })).toHaveCount(0)
  await page.screenshot({ path: join(SHOTS, 'agent-runs-no-trace.png') })

  // The traced run's detail DOES offer it, and it lands on the waterfall.
  await page.goto(`${BASE_URL}/agents/runs/run_traced`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('button', { name: 'View trace' })).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('text=summarize the incident').first()).toBeVisible()
  await page.screenshot({ path: join(SHOTS, 'agent-runs-detail.png') })
  await page.getByRole('button', { name: 'View trace' }).click()
  await expect(page).toHaveURL(/\/o11y\/trace_91b2$/)

  await ctx.close()
})

test('the status filter is served by the backend, not faked in the browser', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  runsUrls.length = 0
  await openRuns(page)

  await page.getByRole('button', { name: 'Error', exact: true }).click()
  // The row that isn't an error is gone because the BACKEND was asked for errors.
  await expect(page.locator('text=triage')).toHaveCount(0)
  await expect(page.locator('text=sweeper').first()).toBeVisible()
  expect(runsUrls.some((s) => s.includes('status=error'))).toBe(true)

  await ctx.close()
})
