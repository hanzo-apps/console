/**
 * e2e: an address that resolves to nothing SAYS so, and a deep link survives the
 * org picker.
 *
 * Both are things only a browser can show, because both are about what a person
 * concludes from a screen. The console had no 404: every unknown address rendered
 * the home board with the unknown words in the breadcrumb. Measured on
 * console.hanzo.ai, that hid a three-hop failure — the Tracker nav item leaves the
 * console (the cloud binary answers `/tracker` at that host with its own SPA), that
 * SPA redirects to `/login`, and `/login` came back as the dashboard. No error
 * anywhere, so the honest reading of the screen was "Tracker opens the dashboard".
 *
 * The picker case is the same shape one level up: open a bookmarked `/models` with
 * no org entered and the picker renders AT `/models`; entering an org used to
 * navigate to `/`, so a shared link lost its destination at the moment it was used.
 *
 * Run: BASE_URL=http://localhost:4111 npx playwright test not-found
 */
import { test, expect, type Route, type Page } from '@playwright/test'
import { requireFixtureServer } from './_fixture'
import { primeSession } from './_session'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4000'

requireFixtureServer()

const API_RE = /\/(v1|cloud|ai|billing|commerce|telemetry|vm|superbase|admin|paas|integrations|auth\/refresh)(\/|$|\?)/

/** Every backend answers 401 — these specs are about ROUTING, not data, and an
 *  unauthorized read is a state every module already handles honestly. */
async function mock(route: Route) {
  const req = route.request()
  if (req.resourceType() === 'document') return route.continue()
  const url = new URL(req.url())
  if (url.pathname.startsWith('/auth/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
  const sameOrigin = url.origin === new URL(BASE_URL).origin
  if (sameOrigin && !API_RE.test(url.pathname)) return route.continue()
  return route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"Sign in to use Hanzo Cloud."}' })
}

async function open(page: Page, path: string) {
  await page.route('**/*', mock)
  await primeSession(page)
  await page.goto(`${BASE_URL}${path}`, { waitUntil: 'domcontentloaded' })
  // The shell mounts client-side (Tamagui/RNW), and a cold dev server compiles the
  // route on first hit — so wait for the mounted shell, never a fixed sleep.
  await expect(page.locator('body')).toContainText(/Overview/i, { timeout: 30_000 })
}

test('an unknown address says so, and names itself', async ({ page }) => {
  await open(page, '/this-route-does-not-exist')
  await expect(page.locator('body')).toContainText(/No such page/i, { timeout: 30_000 })
  // The address is the evidence: a word you did not type is a wrong link, not a typo.
  await expect(page.locator('body')).toContainText('/this-route-does-not-exist')
  // …and the shell survives (the `open` helper already waited for it), so there is a
  // way back — a 404 that drops the nav is a dead end.
})

test('/login — a sibling app\'s redirect — no longer reads as the dashboard', async ({ page }) => {
  await open(page, '/login')
  await expect(page.locator('body')).toContainText(/No such page/i, { timeout: 30_000 })
})

test('a real product still renders (the control this fix must not break)', async ({ page }) => {
  await open(page, '/models')
  await expect(page.locator('body')).toContainText(/Catalog/i, { timeout: 30_000 })
  await expect(page.locator('body')).not.toContainText(/No such page/i)
})

test('entering an org from the picker keeps the address that was asked for', async ({ page }) => {
  await page.route('**/*', mock)
  await primeSession(page)
  // De-select ONCE: primeSession re-seeds on every document, and the whole question
  // is what happens on the load AFTER entering.
  await page.addInitScript(() => {
    try {
      if (!sessionStorage.getItem('_deselected')) {
        sessionStorage.setItem('_deselected', '1')
        localStorage.removeItem('hanzo.console.org.selected')
      }
    } catch {
      /* private mode */
    }
  })
  await page.goto(`${BASE_URL}/models`, { waitUntil: 'domcontentloaded' })
  const card = page.locator('[role="button"][aria-label^="Open "]').first()
  await card.waitFor({ state: 'visible', timeout: 30_000 })
  await card.click()
  await page.waitForURL((u) => u.pathname === '/models', { timeout: 30_000 })
  expect(new URL(page.url()).pathname).toBe('/models')
})
