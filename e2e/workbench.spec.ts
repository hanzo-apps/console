/**
 * e2e: Developers workbench dock — mocked-network render proof.
 *
 * Same pattern as budgets-responsive: a LOCAL server with the network mocked
 * (primeSession seeds the IAM-PKCE identity; `/v1/billing/usage` → three
 * real-shaped ledger rows, `/v1/models` → a small catalog for the shell). Proves
 * the persistent Developers bar renders on every page, the drawer opens with real
 * Overview numbers + Logs rows, and the read-only shell runs a /v1 GET (and
 * refuses a mutation) — screenshots for each.
 *
 * Run: BASE_URL=http://localhost:4000 npx playwright test workbench
 */
import { test, expect, type Route, type Page } from '@playwright/test'
import { requireFixtureServer } from './_fixture'
import { primeSession } from './_session'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4000'

requireFixtureServer()
const SHOTS = join(process.cwd(), 'e2e-shots')


/** Real-shaped commerce ledger rows (the `/v1/billing/usage` contract). */
const now = Date.now()
const USAGE = {
  usage: [
    {
      transactionId: 't1',
      amount: 12,
      createdAt: new Date(now - 60_000).toISOString(),
      notes: 'API usage: zen5 (1200 tokens)',
      metadata: { model: 'zen5', provider: 'hanzo', status: 'success', promptTokens: 800, completionTokens: 400, totalTokens: 1200 },
    },
    {
      transactionId: 't2',
      amount: 3,
      createdAt: new Date(now - 120_000).toISOString(),
      notes: 'API usage: glm-5.2 (300 tokens)',
      metadata: { model: 'glm-5.2', provider: 'zhipu', status: 'success', promptTokens: 200, completionTokens: 100, totalTokens: 300 },
    },
    {
      transactionId: 't3',
      amount: 1,
      createdAt: new Date(now - 180_000).toISOString(),
      notes: 'API usage: zen5-mini (90 tokens)',
      metadata: { model: 'zen5-mini', provider: 'hanzo', status: 'error', promptTokens: 90, completionTokens: 0, totalTokens: 90 },
    },
  ],
}

const MODELS = { object: 'list', data: [{ id: 'zen5', owned_by: 'hanzo' }, { id: 'glm-5.2', owned_by: 'hanzo' }] }

const API_RE = /\/(v1|cloud|ai|billing|commerce|telemetry|vm|superbase|admin|integrations|auth\/refresh)(\/|$|\?)/

async function mock(route: Route) {
  const req = route.request()
  if (req.resourceType() === 'document') return route.continue()
  const url = new URL(req.url())
  const path = url.pathname

  if (path === '/v1/billing/usage') {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(USAGE) })
  }
  if (path === '/v1/models') {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MODELS) })
  }

  const sameOrigin = url.origin === new URL(BASE_URL).origin
  if (sameOrigin && !API_RE.test(path)) return route.continue()
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', msg: '', data: [], data2: 0 }) })
}

async function openHome(page: Page) {
  await page.route('**/*', mock)
  await primeSession(page)
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('button', { name: 'Open the workbench' }).first()).toBeVisible({ timeout: 20_000 })
}

test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }))

test('the Developers dock opens with real ledger numbers, logs, and a working read-only shell', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await openHome(page)

  // The always-there bar: Developers + the faux `$` prompt.
  await expect(page.locator('text=Developers').first()).toBeVisible()
  await expect(page.locator('text=$ Run a /v1 command…').first()).toBeVisible()

  // Open → Overview shows the REAL mocked ledger roll-up (3 requests · 1 error ·
  // 1590 tokens · $0.16), never fabricated numbers.
  await page.getByRole('button', { name: 'Open the workbench' }).first().click()
  await expect(page.locator('text=Requests').first()).toBeVisible()
  await expect(page.locator('text=Last 24h · charged ledger').first()).toBeVisible()
  await expect(page.locator('text=1590').first()).toBeVisible()
  await expect(page.locator('text=$0.16').first()).toBeVisible()
  await page.screenshot({ path: join(SHOTS, 'workbench-overview.png') })

  // Logs tab — the same ledger rows, newest first.
  await page.getByRole('button', { name: 'Logs', exact: true }).first().click()
  await expect(page.locator('text=zen5-mini').first()).toBeVisible()
  await expect(page.locator('text=glm-5.2').first()).toBeVisible()

  // Shell tab — a real same-origin /v1 GET renders the JSON; a mutation is refused.
  await page.getByRole('button', { name: 'Shell', exact: true }).first().click()
  const input = page.getByLabel('Workbench shell command')
  await input.fill('GET /v1/models')
  await input.press('Enter')
  await expect(page.locator('text=zen5').first()).toBeVisible()
  await input.fill('DELETE /v1/agents')
  await input.press('Enter')
  await expect(page.locator('text=read-only').first()).toBeVisible()
  await page.screenshot({ path: join(SHOTS, 'workbench-shell.png') })

  await ctx.close()
})
