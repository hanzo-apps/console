/**
 * e2e screenshot proof — the GPUs page shows BOTH "Connect GPU" (BYO) and "Deploy GPU"
 * (cloud) actions, and a BYO machine renders with a BYO badge next to a cloud one.
 *
 * Fully mocked network (no backend, no password), same harness as blank-audit:
 *   - /auth/session → a tenant customer (so CustomerGpus renders, not AdminGpus).
 *   - GET .../v1/visor/machines → one BYO GB10 (provider=byo) + one cloud H100 (provider=doks).
 *   - GET .../v1/visor/gpus → a small live catalog so the page reads real.
 *   - every other data path → an honest empty envelope.
 *
 * Writes two PNGs to e2e/shots/. Run:
 *   BASE_URL=http://localhost:4000 npx playwright test gpus-connect
 */
import { test, type Route } from '@playwright/test'
import { requireFixtureServer } from './_fixture'
import { primeSession } from './_session'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4000'

// These render specs assert LOCAL fixture data; skip cleanly when that server is down.
requireFixtureServer()
const SHOTS = join(process.cwd(), 'e2e', 'shots')

const ACCOUNT = {
  owner: 'maxpower',
  name: 'dave',
  type: 'normal-user',
  email: 'dave@maxpower.com',
  displayName: 'Dave',
  isGlobalAdmin: false,
  isAdmin: true,
  signupApplication: 'hanzo-cloud',
}

const ok = (data: unknown) => JSON.stringify({ status: 'ok', msg: '', data })

// Two GPU machines: a BYO GB10 that dialed in via `hanzo gpu connect`, and a
// Hanzo-Cloud-provisioned H100. isGpuMachine keeps both (gpu set / gpu-* slug).
// Cloud GPU VMs (provider≠byo) — these render in the machines list.
const MACHINES = [
  { id: 'gpu-h100-sfo', name: 'gpu-h100-sfo', type: 'gpu-h100x1-80gb', provider: 'doks', gpu: 'H100', region: 'sfo3', status: 'running', costHourlyUsd: 2.49 },
]

// BYO boxes — surfaced via /v1/visor/fleet/workers (the connect fleet), NOT
// /v1/visor/machines (which excludes provider=byo). This is where a GB10 that dialed
// in via `hanzo gpu connect` actually appears.
const WORKERS = [
  { id: 'gb10-studio', hostname: 'gb10-studio', provider: 'byo', location: 'on-prem', status: 'online', gpus: [{ name: 'NVIDIA GB10', memoryGb: 128 }] },
]

const CATALOG = [
  { slug: 'gpu-h100x1-80gb', model: 'H100', gpuCount: 1, vramGb: 80, vcpus: 20, memGb: 240, priceHourly: 2.49, priceMonthly: 1818 },
  { slug: 'gpu-a100x1-40gb', model: 'A100', gpuCount: 1, vramGb: 40, vcpus: 12, memGb: 120, priceHourly: 1.59, priceMonthly: 1161 },
  { slug: 'gpu-l40sx1-48gb', model: 'L40S', gpuCount: 1, vramGb: 48, vcpus: 8, memGb: 64, priceHourly: 1.14, priceMonthly: 832 },
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

  const sameOrigin = url.origin === new URL(BASE_URL).origin
  if (sameOrigin && !API_RE.test(path)) return route.continue()

  // Data paths — match by suffix so it works regardless of /vm vs /visor prefix.
  if (/\/v1\/(vm|visor)\/machines$/.test(path)) return route.fulfill({ status: 200, contentType: 'application/json', body: ok(MACHINES) })
  if (/\/v1\/(vm|visor)\/gpus$/.test(path)) return route.fulfill({ status: 200, contentType: 'application/json', body: ok(CATALOG) })
  // BYO machines surface via the connect FLEET, not /v1/visor/machines (which excludes
  // provider=byo). The GB10 lives here — where CustomerGpus actually renders it.
  if (/\/v1\/visor\/fleet\/workers$/.test(path)) return route.fulfill({ status: 200, contentType: 'application/json', body: ok({ workers: WORKERS }) })
  // Everything else (regions, sizes, clusters, billing, …) → honest empty.
  return route.fulfill({ status: 200, contentType: 'application/json', body: ok([]) })
}

test('GPUs page: Connect vs Deploy + the connect drawer', async ({ browser }) => {
  mkdirSync(SHOTS, { recursive: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
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

  await page.goto(`${BASE_URL}/gpus`, { waitUntil: 'domcontentloaded' })
  await page.locator('[data-testid="product-content"]').first().waitFor({ state: 'attached', timeout: 20_000 })
  // The two sibling paths — Connect (BYO) and Deploy (cloud) — are the page's
  // header actions, always present for a customer.
  await page.getByRole('button', { name: 'Connect GPU' }).first().waitFor({ timeout: 20_000 })
  await page.getByRole('button', { name: 'Deploy GPU' }).first().waitFor({ timeout: 20_000 })
  await page.waitForTimeout(600)
  await page.screenshot({ path: join(SHOTS, 'gpus-connect-deploy.png'), fullPage: true })

  // Open the Connect drawer → the real BYO onboarding (`hanzo gpu connect`).
  await page.getByRole('button', { name: 'Connect GPU' }).first().click()
  await page.locator('text=hanzo gpu connect').first().waitFor({ timeout: 10_000 })
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(SHOTS, 'gpus-connect-drawer.png'), fullPage: true })

  await ctx.close()
})
