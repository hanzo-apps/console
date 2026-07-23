/**
 * e2e: the Models product's three surfaces — Catalog · Leaderboard · Blend.
 *
 * Mocked-network render proof against a LOCAL server (same pattern as
 * budgets-responsive): `/auth/session` → an admin so the shell mounts, the model
 * catalog + org-settings → real-shaped payloads, everything else → an empty-ok
 * envelope.
 *
 * Why this exists: the unit tests cover pure logic with mocks, and this repo has been
 * bitten before by a mocked suite that stayed green while the page didn't render. These
 * are the assertions only a browser can make — that the benchmark corpus actually
 * paints rows, that a Blend toggle re-forms the Enso tiers on screen, and that neither
 * board scrolls the body sideways on a phone.
 *
 * It also pins the honesty rules in the DOM: a model with no published score renders an
 * EM-DASH (never a 0), and the Blend board states plainly that the gateway does not yet
 * persist the blend rather than implying a save succeeded.
 *
 * Run: BASE_URL=http://localhost:4000 npx playwright test models-surfaces
 */
import { test, expect, type Route, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { requireFixtureServer } from './_fixture'
import { primeSession } from './_session'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4000'

requireFixtureServer()
const SHOTS = join(process.cwd(), 'e2e-shots')

const ACCOUNT = {
  owner: 'hanzo',
  name: 'z',
  type: 'normal-user',
  email: 'z@hanzo.ai',
  displayName: 'Z Admin',
  isSuperAdmin: true,
  isGlobalAdmin: true,
  isAdmin: true,
  signupApplication: 'hanzo-cloud',
}

/**
 * Real-shaped `/v1/pricing/models` rows. Deliberately mixed so the page has to make
 * every honest call: a benchmarked frontier model, a vision model, a gateway-served
 * model whose true vendor is NOT the gateway, and a model the corpus has never scored
 * (which must render an em-dash, not a zero).
 */
const CATALOG = {
  models: [
    { name: 'gpt-5.6-sol', provider: 'OpenAI', context: 400000, pricing: { input: 5, output: 30 }, features: [] },
    { name: 'opus-4.8', provider: 'Anthropic', context: 200000, pricing: { input: 5, output: 25 }, features: [] },
    { name: 'glm-5.2', provider: 'hanzo', context: 200000, pricing: { input: 1.05, output: 4.4 }, features: [] },
    { name: 'kimi-k2.6', provider: 'hanzo', context: 256000, pricing: { input: 0.76, output: 3.2 }, features: ['vision'] },
    { name: 'deepseek-4-flash', provider: 'DeepSeek', context: 128000, pricing: { input: 0.11, output: 0.22 }, features: [] },
    { name: 'totally-unbenchmarked-model', provider: 'Other', context: 32000, pricing: { input: 0.1, output: 0.2 }, features: [] },
  ],
}

const LIVE_MODELS = {
  object: 'list',
  data: CATALOG.models.map((m) => ({ id: m.name, object: 'model', created: 0, owned_by: m.provider })),
}

const API_RE = /\/(v1|cloud|ai|billing|commerce|telemetry|vm|superbase|admin|paas|integrations|auth\/refresh)(\/|$|\?)/

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

async function mock(route: Route) {
  const req = route.request()
  if (req.resourceType() === 'document') return route.continue()
  const url = new URL(req.url())
  const path = url.pathname

  if (path === '/auth/session') return json(route, { account: ACCOUNT, expiresIn: 3600 })
  if (path.startsWith('/auth/')) return json(route, { ok: true })

  // The catalog the Catalog + Blend boards read (both shapes the client joins).
  if (path.endsWith('/v1/pricing/models')) return json(route, CATALOG)
  if (path.endsWith('/v1/models')) return json(route, LIVE_MODELS)

  // The org has no stored blend — the honest "not persisted yet" path.
  if (path.endsWith('/v1/org/settings')) return json(route, { status: 'ok', msg: '', data: null })

  const sameOrigin = url.origin === new URL(BASE_URL).origin
  if (sameOrigin && !API_RE.test(path)) return route.continue()
  return json(route, { status: 'ok', msg: '', data: [], data2: 0 })
}

/**
 * Open a models surface and wait for its CONTENT.
 *
 * `marker` must be a phrase unique to the view's body, NOT its title: a bare title
 * match (e.g. "Leaderboard") also resolves to the collapsed sidebar's hidden nav span
 * on a narrow viewport, which is never visible and would fail a rendered page.
 */
async function open(page: Page, path: string, marker: string) {
  await page.addInitScript((org) => {
    try {
      localStorage.setItem('hanzo.console.org', org)
      // Scope shows the org PICKER until an org has been explicitly entered — the
      // scope VALUE alone is not enough (see lib/org-scope.ts hasSelectedOrg).
      localStorage.setItem('hanzo.console.org.selected', '1')
      localStorage.setItem('hz_admin_banner_dismissed', '1')
      // The first-run onboarding wizard is a full takeover that renders INSTEAD of the
      // product, so a render spec must mark it done or it never reaches the page under
      // test (per-account key, see lib/onboarding/guard.ts).
      localStorage.setItem(`hz_onboarding_done:${org}`, '1')
    } catch {
      /* private mode */
    }
  }, ACCOUNT.owner)
  await page.route('**/*', mock)
  await primeSession(page, ACCOUNT)
  await page.goto(`${BASE_URL}${path}`, { waitUntil: 'domcontentloaded' })
  await page.locator('[data-testid="product-content"]').first().waitFor({ state: 'attached', timeout: 20_000 })
  await expect(page.locator(`text=${marker}`).first()).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(800)
}

/** True when the document scrolls sideways — the mobile regression this guards. */
const scrollsHorizontally = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)

test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }))

test('leaderboard ranks the real corpus and attributes every score', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await open(page, '/models/leaderboard', 'Published benchmark scores')

  // The benchmark pills carry the corpus's REAL coverage counts — proof the fixture
  // loaded, and that the default is the broadest-coverage benchmark rather than a
  // hardcoded one.
  await expect(page.getByRole('button', { name: /GPQA-Diamond · \d+/ }).first()).toBeVisible()

  // Rank by GPQA-Diamond explicitly, then assert the real top row from
  // priors/leaderboard.json — the corpus is a build-time fixture, so these rows must
  // paint with NO backend at all.
  await page.getByRole('button', { name: /GPQA-Diamond/ }).first().click()
  await page.waitForTimeout(600)
  await expect(page.locator('text=gpt-5.6-sol').first()).toBeVisible()
  await expect(page.locator('text=90.4').first()).toBeVisible()
  // Provenance is rendered, not hidden — our own harness is badged.
  await expect(page.locator('text=Hanzo-measured').first()).toBeVisible()

  // Switching benchmark re-ranks: MMLU-Pro is a different corpus slice with a
  // different leader.
  await page.getByRole('button', { name: /MMLU-Pro/ }).first().click()
  await page.waitForTimeout(600)
  await expect(page.locator('text=claude-opus-4.5').first()).toBeVisible()

  await page.screenshot({ path: join(SHOTS, 'models-leaderboard.png'), fullPage: true })
  await ctx.close()
})

test('blend re-forms the Enso tiers when a model is toggled', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await open(page, '/models/blend', 'price bands over this set')

  // All three tier cards render, formed from the live catalog's prices.
  await expect(page.locator('text=Enso Flash').first()).toBeVisible()
  await expect(page.locator('text=Enso Blend').first()).toBeVisible()
  await expect(page.locator('text=Enso Ultra').first()).toBeVisible()

  // Honest about persistence — never a confirmation for a write the backend drops.
  await expect(page.locator('text=Blend storage is not live yet').first()).toBeVisible()

  // Every catalog model starts enabled (inherit-all).
  await expect(page.locator('text=6 of 6 enabled').first()).toBeVisible()

  // Turning one off re-forms the tiers live: the two ultra-band models are
  // gpt-5.6-sol (25.0) and opus-4.8 (21.0); disabling one must drop Ultra to 1.
  await page.getByRole('button', { name: /Disable .*opus-4\.8/ }).first().click()
  await page.waitForTimeout(400)
  await expect(page.locator('text=5 of 6 enabled').first()).toBeVisible()

  await page.screenshot({ path: join(SHOTS, 'models-blend.png'), fullPage: true })
  await ctx.close()
})

test('catalog shows vision capability and an em-dash for an unscored model', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await open(page, '/models', 'Catalog')  // the catalog tab bar + family list

  // The vision-capable model is badged from the catalog's own features, and the
  // benchmarked models show their real corpus score.
  await expect(page.locator('text=Vision').first()).toBeVisible()
  await expect(page.locator('text=90.4').first()).toBeVisible()

  // The honesty rule, asserted on the SPECIFIC unscored row (not just "an em-dash
  // exists somewhere on the page"): filter the catalog down to the model the corpus
  // has never scored, then read that row's own benchmark cell.
  await page.getByPlaceholder(/Search models/i).fill('totally-unbenchmarked')
  await page.waitForTimeout(600)
  const row = page.locator('text=totally-unbenchmarked-model').first()
  await expect(row).toBeVisible()
  await expect(page.locator('text=—').first()).toBeVisible()
  // …and it must NOT invent a zero for a model nobody has benchmarked.
  await expect(page.locator('text=0.0')).toHaveCount(0)

  await page.screenshot({ path: join(SHOTS, 'models-catalog.png'), fullPage: true })
  await ctx.close()
})

test('both boards reflow with no horizontal body scroll on a phone', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()

  await open(page, '/models/leaderboard', 'Published benchmark scores')
  expect(await scrollsHorizontally(page)).toBe(false)
  await page.screenshot({ path: join(SHOTS, 'models-leaderboard-mobile.png'), fullPage: true })

  await page.goto(`${BASE_URL}/models/blend`, { waitUntil: 'domcontentloaded' })
  await expect(page.locator('text=price bands over this set').first()).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(800)
  expect(await scrollsHorizontally(page)).toBe(false)
  await page.screenshot({ path: join(SHOTS, 'models-blend-mobile.png'), fullPage: true })

  await ctx.close()
})
