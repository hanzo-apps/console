/**
 * Playground layout: the Response panel sits UNDER the surface tabs — above
 * the composer — at every width. Render-proven on the local dev server with a
 * fully mocked network (no gateway, no billing, no catalog): what is asserted
 * is GEOMETRY, which mocks cannot fake.
 *
 * Run: BASE_URL=http://localhost:4000 npx playwright test playground-responsive
 */
import { test, expect, type Route } from '@playwright/test'
import { requireFixtureServer } from './_fixture'
import { primeSession } from './_session'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4000'

// The module shell resolves the product registry from the local fixture server,
// like every other module render spec; skip cleanly when it is down.
requireFixtureServer()
const SHOTS = join(process.cwd(), 'e2e-shots')

const WIDTHS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 834, height: 1112 },
  { name: 'laptop', width: 1440, height: 900 },
  { name: 'desktop', width: 1920, height: 1080 },
]

// Minimal honest bodies for everything the page asks the backend.
const mock = async (route: Route) => {
  const url = route.request().url()
  const json = (body: unknown) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  if (url.includes('/pricing/models')) return json({ models: [] })
  if (url.includes('/v1/models'))
    return json({ object: 'list', data: [{ id: 'zen5-flash', owned_by: 'Hanzo' }] })
  if (url.includes('/billing/subscriptions')) return json({ subscriptions: [] })
  if (url.includes(':4000') || url.startsWith(BASE_URL)) return route.continue()
  return json({})
}

for (const vp of WIDTHS) {
  test(`response renders under the tabs at ${vp.name} (${vp.width}px)`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await page.route('**/*', mock)
    await primeSession(page)
    await page.goto(`${BASE_URL}/ai/playground`, { waitUntil: 'domcontentloaded' })

    // The three landmarks: the surface tabs, the Response panel, the composer.
    const tabs = page.getByRole('button', { name: 'Completions' }).first()
    const response = page.getByText('Response', { exact: true }).first()
    const composer = page.getByText('System prompt', { exact: true }).first()
    await expect(tabs).toBeVisible({ timeout: 20000 })
    await expect(response).toBeVisible()
    await expect(composer).toBeVisible()

    const [tabsBox, respBox, compBox] = await Promise.all([
      tabs.boundingBox(),
      response.boundingBox(),
      composer.boundingBox(),
    ])
    if (!tabsBox || !respBox || !compBox) throw new Error('a landmark has no box')

    // ORDER: tabs, then Response, then the composer — at every width.
    expect(respBox.y, 'Response sits below the tabs').toBeGreaterThan(tabsBox.y)
    expect(compBox.y, 'the composer sits below the Response panel top').toBeGreaterThan(respBox.y)

    // RESPONSIVE: nothing forces a horizontal scroll.
    const scrollW = await page.evaluate(() => document.documentElement.scrollWidth)
    expect(scrollW, 'no horizontal overflow').toBeLessThanOrEqual(vp.width + 1)

    mkdirSync(SHOTS, { recursive: true })
    await page.screenshot({ path: join(SHOTS, `playground-${vp.name}-${vp.width}.png`) })
  })
}
