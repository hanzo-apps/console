/**
 * e2e: OSS App Store + Platform deploy home — mocked-network render proof.
 *
 * Same pattern as workbench/models-surfaces: a LOCAL dev server with the network
 * mocked. primeSession seeds the IAM-PKCE identity; the OSS catalog
 * (`templates.hanzo.ai/meta.json`) is mocked with a small real-shaped set, logos
 * are left to 404 (proving the monogram fallback), and `/v1/platform/projects`
 * returns empty so the deploy dialog loads. Proves:
 *   - `/store` renders the App Store grid (real-shaped cards), search filters it,
 *     the maker "Earn 20%" hook shows, and the Deploy dialog opens over the real
 *     PaaS path.
 *   - `/platform` renders the deploy HOME (hero · App Store tile · featured OSS
 *     strip · projects) — what platform.hanzo.ai boots into.
 *
 * Run: BASE_URL=http://localhost:4000 npx playwright test platform-store
 */
import { test, expect, type Route } from '@playwright/test'
import { requireFixtureServer } from './_fixture'
import { primeSession } from './_session'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4000'
requireFixtureServer()
const SHOTS = join(process.cwd(), 'e2e-shots')

/** A small real-shaped slice of the live meta.json (the exact field set). */
const CATALOG = [
  { id: 'n8n', name: 'n8n', description: 'Workflow automation for technical people', version: 'latest', logo: 'logo.png', tags: ['automation', 'self-hosted'], links: { github: 'https://github.com/n8n-io/n8n', website: 'https://n8n.io' } },
  { id: 'postgres', name: 'Postgres', description: 'The world’s most advanced open-source database', version: '16', logo: 'logo.svg', tags: ['database'], links: { github: 'https://github.com/postgres/postgres' } },
  { id: 'grafana', name: 'Grafana', description: 'Dashboards and observability', version: 'latest', logo: 'logo.svg', tags: ['monitoring', 'self-hosted'], links: { github: 'https://github.com/grafana/grafana' } },
  { id: 'ghost', name: 'Ghost', description: 'Professional publishing platform', version: 'latest', logo: 'logo.png', tags: ['cms'], links: { website: 'https://ghost.org' } }, // no github → View app, no earn hook
]

async function mockCatalog(page: import('@playwright/test').Page): Promise<void> {
  // The OSS catalog CDN (cross-origin; Playwright serves it, bypassing CORS).
  await page.route('**/meta.json', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CATALOG) }),
  )
  // Logos 404 → the card's monogram fallback (never a broken image).
  await page.route('**/blueprints/**', (route: Route) => route.fulfill({ status: 404, body: '' }))
  // The org's PaaS projects (empty → the deploy dialog offers a new auto-named project).
  await page.route('**/v1/platform/projects**', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ projects: [] }) }),
  )
}

test.describe('OSS App Store', () => {
  test('the store renders the catalog, filters, and opens the deploy dialog', async ({ page }) => {
    await mockCatalog(page)
    await primeSession(page)
    await page.goto(`${BASE_URL}/store`, { waitUntil: 'domcontentloaded' })

    // The page + payout banner + the real-shaped cards.
    await expect(page.getByText('App Store', { exact: false }).first()).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('Built one of these?', { exact: false })).toBeVisible()
    await expect(page.getByText('n8n', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Postgres', { exact: true }).first()).toBeVisible()
    // The maker "Earn 20%" hook (derived from links.github).
    await expect(page.getByText('Maintainer? Earn 20%', { exact: false }).first()).toBeVisible()

    mkdirSync(SHOTS, { recursive: true })
    await page.screenshot({ path: join(SHOTS, 'store-grid.png'), fullPage: true })

    // Search narrows to Postgres.
    await page.getByPlaceholder('Search 1000+ open-source apps…').fill('postgres')
    await expect(page.getByText('Postgres', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('n8n', { exact: true })).toHaveCount(0)

    // Deploy opens the dialog over the real PaaS path.
    await page.getByPlaceholder('Search 1000+ open-source apps…').fill('')
    await page.getByRole('button', { name: 'Deploy', exact: true }).first().click()
    await expect(page.getByText('Deploy n8n', { exact: false }).or(page.getByText('Deploy Postgres', { exact: false })).first()).toBeVisible()
    await page.screenshot({ path: join(SHOTS, 'store-deploy.png'), fullPage: true })
  })
})

test.describe('Platform deploy home', () => {
  test('/platform renders the deploy hero, tiles, and featured OSS strip', async ({ page }) => {
    await mockCatalog(page)
    await primeSession(page)
    await page.goto(`${BASE_URL}/platform`, { waitUntil: 'domcontentloaded' })

    await expect(page.getByText('Deploy anything.', { exact: false })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('Browse the App Store', { exact: false }).first()).toBeVisible()
    await expect(page.getByText('One-click apps', { exact: false })).toBeVisible()
    // A featured card from the live catalog + the projects section.
    await expect(page.getByText('n8n', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Your projects', { exact: true })).toBeVisible()
    mkdirSync(SHOTS, { recursive: true })
    await page.screenshot({ path: join(SHOTS, 'platform-home.png'), fullPage: true })
  })
})
