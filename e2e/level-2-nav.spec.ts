/**
 * e2e: ONE level-2 nav, NESTED — the siblings never leave.
 *
 * Clicking into a product must reveal ITS options rather than replacing the screen,
 * and there must be exactly ONE such nav on screen — not the sidebar's level 2 AND a
 * competing tab strip in the content, which is what `/models` used to do (eight items
 * in the rail, four in the content, disagreeing on the index's own name).
 *
 * And revealing them must not COST the list. The sidebar used to DRILL: entering a
 * product replaced every other product with that one product's pages behind a "Back
 * to all products" step, so reading Models › Metrics put a navigation between you and
 * Agents. Level 2 is a BRANCH of the list now — the product's pages nest under its own
 * row, inside its category, and every sibling stays listed below. That is the
 * regression these specs exist to catch, so they assert the siblings at EVERY level:
 * in the product, and in one of its nested pages.
 *
 * These are assertions only a browser can make. They read COMPUTED style and
 * GEOMETRY, not source: a strip hidden by a `$lg` media style prop is still in the
 * DOM, so `toBeVisible()` — which resolves to `display`/`visibility`/box-size — is
 * the only honest test of "is there a second nav on screen".
 *
 * Run: BASE_URL=http://localhost:4000 npx playwright test level-2-nav
 */
import { test, expect, type Route, type Page, type Locator } from '@playwright/test'
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
  email: 'z@hanzo.ai',
  displayName: 'Z Admin',
  isAdmin: true,
}

const API_RE = /\/(v1|cloud|ai|billing|commerce|telemetry|vm|superbase|admin|paas|integrations|auth\/refresh)(\/|$|\?)/
const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

/**
 * Every backend answers 401 — this spec is about NAV, not data, and an unauthorized
 * read is the state every module already handles honestly. (A fabricated empty
 * envelope is NOT interchangeable: a module that expects an object and is handed
 * `[]` throws into its error boundary, which would make this spec a data test.)
 */
async function mock(route: Route) {
  const req = route.request()
  if (req.resourceType() === 'document') return route.continue()
  const url = new URL(req.url())
  if (url.pathname.startsWith('/auth/')) return json(route, { ok: true })
  const sameOrigin = url.origin === new URL(BASE_URL).origin
  if (sameOrigin && !API_RE.test(url.pathname)) return route.continue()
  return json(route, { error: 'Sign in to use Hanzo Cloud.' }, 401)
}

async function open(page: Page, path: string) {
  await page.route('**/*', mock)
  await primeSession(page, ACCOUNT)
  await page.goto(`${BASE_URL}${path}`, { waitUntil: 'domcontentloaded' })
  await page.locator('[data-testid="product-content"]').first().waitFor({ state: 'attached', timeout: 30_000 })
  await page.waitForTimeout(1200)
}

/** The level-2 nav rendered in the CONTENT column (`SubNav`). Located by test id,
 *  not by role: a `display: none` element leaves the accessibility tree, and this
 *  spec must be able to find it precisely when it is hidden. */
const strip = (page: Page, id: string) => page.locator(`[data-testid="subnav-${id}"]`)

/** A level-2 row/tab by its label, anywhere on screen, VISIBLE only. */
const visibleTab = (page: Page, label: string) =>
  page.getByRole('button', { name: label, exact: true }).filter({ visible: true })

/**
 * `SidebarNav` is ONE definition with SEVERAL mounts (the desktop rail and the mobile
 * drawer are both in the DOM at every viewport — that is the DRY the shell is built
 * on). The closed drawer is moved off-canvas by a CSS transform, which Playwright
 * still reports as "visible" — an off-screen element keeps its box. So a nav claim
 * here is only meaningful with GEOMETRY: `onScreen` asserts the element is painted
 * INSIDE the viewport, which the desktop rail is (x≈38) and the closed drawer is not
 * (x≈-284). Measured, not assumed.
 */
async function onScreen(page: Page, locator: Locator, what: string) {
  await expect(locator, `${what}: rendered`).toBeVisible()
  const box = await locator.boundingBox()
  expect(box, `${what}: has a painted box`).not.toBeNull()
  const width = page.viewportSize()!.width
  expect(box!.x, `${what}: painted inside the viewport, not off-canvas`).toBeGreaterThanOrEqual(0)
  expect(box!.x, `${what}: painted within the right edge`).toBeLessThan(width)
  expect(box!.height, `${what}: has real height`).toBeGreaterThan(0)
}

/** The desktop rail's copy of the nav — the mount that is actually on screen. */
const railNav = (page: Page) => page.locator('nav[aria-label="Products"]').first()

/** A SIBLING product's row in the rail — the thing drilling used to hide. */
const sibling = (page: Page, label: string) =>
  railNav(page).getByRole('button', { name: label, exact: true }).first()

/** The current product's level-2 rows, nested under its own row in the rail. */
const nested = (page: Page, id: string) => page.locator(`[data-testid="railnav-${id}"]`).first()

/** Every mount's copy — for a "this is GONE" claim, which must hold everywhere. */
const nestedAnywhere = (page: Page, id: string) => page.locator(`[data-testid="railnav-${id}"]`)

/** Two AI-category peers of Models — present for this account (neither is admin-only),
 *  and both must stay one click away from anywhere inside Models. */
const SIBLINGS = ['Agents', 'Playground'] as const

test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }))

test('desktop: the sidebar owns level 2 — the content strip is not a second nav', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await open(page, '/models')

  // The rail shows Models' own options, NESTED under its row.
  await onScreen(page, nested(page, 'models'), "Models' nested level 2")

  // ...and the product list is still there: every sibling stays one click away.
  // This is the regression — drilling replaced them all with a Back button.
  for (const label of SIBLINGS) {
    await onScreen(page, sibling(page, label), `${label} stays listed while inside Models`)
  }
  await expect(
    page.getByRole('button', { name: 'Back to all products' }),
    'no Back step: level 2 is a branch of the list, not a second screen',
  ).toHaveCount(0)

  // The index is named what the PRODUCT calls it — Models' index is the Catalog,
  // not a generic "Overview". This is the registry's `indexLabel`, read by the nav.
  await expect(visibleTab(page, 'Catalog').first()).toBeVisible()
  await expect(visibleTab(page, 'Leaderboard').first()).toBeVisible()
  await expect(visibleTab(page, 'Blend').first()).toBeVisible()

  // Exactly ONE of each — a duplicate would mean two navs painting at once.
  for (const label of ['Catalog', 'Leaderboard', 'Blend']) {
    expect(await visibleTab(page, label).count(), `${label} appears once`).toBe(1)
  }

  // The content strip is in the DOM but PAINTS NOTHING at lg+ (computed display).
  await expect(strip(page, 'models')).toBeAttached()
  await expect(strip(page, 'models')).not.toBeVisible()
  expect(await strip(page, 'models').evaluate((el) => getComputedStyle(el).display)).toBe('none')

  await page.screenshot({ path: join(SHOTS, 'level2-desktop-models.png'), fullPage: false })
  await ctx.close()
})

test('phone: the strip carries level 2 where the sidebar is a drawer', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  await open(page, '/models')

  // The rail is off-canvas, so the strip is the ONE nav — and it is the SAME list.
  await expect(strip(page, 'models')).toBeVisible()
  const labels = await strip(page, 'models').getByRole('button').allInnerTexts()
  // Routing is admin-only and this account is an ORG admin, not a global one — the
  // one nav gates it, so a customer is never offered a surface they cannot open.
  expect(labels).toEqual(['Catalog', 'Leaderboard', 'Blend', 'Settings', 'Status', 'Logs', 'Metrics'])

  // The strip wraps rather than pushing the page sideways.
  const scrolls = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  )
  expect(scrolls, 'body must not scroll horizontally').toBe(false)

  // Every tab is a real hit target — measured, not assumed.
  const boxes = await strip(page, 'models').getByRole('button').all()
  for (const b of boxes) {
    const box = await b.boundingBox()
    expect(box, 'a tab must have a painted box').not.toBeNull()
    expect(box!.height, 'a tab must be tall enough to tap').toBeGreaterThanOrEqual(28)
    expect(box!.x + box!.width, 'a tab must not paint past the right edge').toBeLessThanOrEqual(391)
  }

  await strip(page, 'models').scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(SHOTS, 'level2-mobile-models.png'), fullPage: false })
  await ctx.close()
})

test('the URL carries the level — a deep link and a reload land on the same tab', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  await open(page, '/models/blend')

  const current = async () =>
    strip(page, 'models').locator('[aria-current="page"]').first().innerText()

  expect(await current()).toBe('Blend')

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('[data-testid="product-content"]').first().waitFor({ state: 'attached', timeout: 30_000 })
  await page.waitForTimeout(1200)
  expect(await current(), 'reload keeps the level').toBe('Blend')
  expect(new URL(page.url()).pathname).toBe('/models/blend')

  await ctx.close()
})

/**
 * The whole point, at EVERY level: inside a product, and inside one of its nested
 * pages, a sibling is still listed AND still opens. Asserting on where the click
 * LANDS, not on DOM order — a row that renders but does not navigate is not "one
 * click away".
 */
test('siblings stay listed and clickable at every level', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()

  // Level: inside the PRODUCT.
  await open(page, '/models')
  await onScreen(page, nested(page, 'models'), "Models' nested level 2")
  for (const label of SIBLINGS) await onScreen(page, sibling(page, label), `${label} in the product`)

  // Level: inside one of its NESTED PAGES — the deepest the nav goes.
  await open(page, '/models/blend')
  await onScreen(page, nested(page, 'models'), "Models' nested level 2, on a nested page")
  await expect(nested(page, 'models').locator('[aria-current="page"]')).toHaveText('Blend')
  for (const label of SIBLINGS) {
    await onScreen(page, sibling(page, label), `${label} stays listed from a nested page`)
  }
  await page.screenshot({ path: join(SHOTS, 'level2-siblings-nested.png'), fullPage: false })

  // ...and it OPENS, straight from the nested page — no Back, no intermediate stop.
  await sibling(page, 'Agents').click()
  await page.waitForTimeout(900)
  expect(new URL(page.url()).pathname, 'a sibling opens directly from a nested page').toBe('/agents')

  // Arriving there, THAT product now owns level 2 and Models is the sibling.
  await onScreen(page, nested(page, 'agents'), "Agents' nested level 2")
  await onScreen(page, sibling(page, 'Models'), 'Models is now the sibling')
  await expect(nestedAnywhere(page, 'models'), 'only ONE product carries level 2').toHaveCount(0)

  await ctx.close()
})

test('back returns a level without losing pinned state', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await open(page, '/models')

  // Pin state is account-backed, not view state — it must survive a drill + back.
  const pinsBefore = await page.evaluate(() => localStorage.getItem('hanzo.preferences.cache'))

  await visibleTab(page, 'Blend').first().click()
  await page.waitForTimeout(900)
  expect(new URL(page.url()).pathname).toBe('/models/blend')

  await page.goBack({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(900)
  expect(new URL(page.url()).pathname).toBe('/models')

  // Still inside Models with the same options — Back moved the LEVEL, it did not
  // collapse the nested nav; the siblings never went anywhere.
  await onScreen(page, nested(page, 'models'), "Models' nested level 2")
  await expect(visibleTab(page, 'Catalog').first()).toBeVisible()
  await onScreen(page, sibling(page, 'Agents'), 'Agents after Back')

  expect(await page.evaluate(() => localStorage.getItem('hanzo.preferences.cache'))).toBe(pinsBefore)
  await ctx.close()
})

/**
 * Every product that used to carry its own `const TABS` — the whole conversion, in
 * one sweep. For each: the page renders, the rail drills into it, and the content
 * strip is present but PAINTS NOTHING at lg+. That is the "no second nav" invariant,
 * and it is the thing that regresses the moment someone adds a tab bar back.
 */
const CONVERTED = [
  'models', 'evals', 'ai-accounts', 'containers', 'analytics', 'finetuning', 'team',
  'automations', 'embeddings', 'tasks', 'functions', 'profile', 'router', 'settings',
  'zero-trust', 'billing', 'captable', 'crm',
] as const

test('no product paints a second level-2 nav at lg+', async ({ browser }) => {
  // 18 full page loads. Against a dev server each route compiles on demand, so this
  // one sweep costs minutes where every other test here costs seconds — a budget, not
  // a hang (it fails on the assertion, never the clock, when a nav is actually wrong).
  test.slow()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()

  for (const id of CONVERTED) {
    await open(page, `/${id}`)
    await expect(strip(page, id), `${id}: declares one level-2 nav`).toBeAttached()
    expect(
      await strip(page, id).evaluate((el) => getComputedStyle(el).display),
      `${id}: the content strip must not paint while the rail owns level 2`,
    ).toBe('none')
    await onScreen(page, nested(page, id), `${id}: the rail carries level 2, nested`)
  }

  await ctx.close()
})
