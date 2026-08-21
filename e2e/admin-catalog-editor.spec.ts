/**
 * Catalog & Pricing admin editor — render + edit-persists proof (increment 2).
 *
 * Drives the REAL CatalogModule (client + form + metadata editor) against a
 * mock of commerce's `/v1/commerce/catalog/*` CRUD, seeded with the REAL 17 infra tiers
 * increment 1 seeds (11 cloud + 3 gpu + 3 datastore). The mock is a live
 * in-memory store: a PUT mutates it, so a save → re-fetch shows the NEW price —
 * the exact "edit persists" loop the module drives against commerce (whose CRUD
 * contract is itself proven by commerce's own passing api/catalog handler tests).
 *
 * Proves: the table renders every real tier with its price + spec; opening a
 * cloud tier shows the editable form (name/price/published/category/metadata);
 * changing the price + Save issues `PUT /v1/commerce/catalog/entries/<slug>` with the new
 * priceCents; and the table then reflects the persisted price. Screenshots the
 * table + the open edit form (admin-catalog-editor.png).
 *
 * Run: BASE_URL=http://localhost:4000 npx playwright test admin-catalog-editor
 */
import { test, expect, type Route, type Page } from '@playwright/test'
import { requireFixtureServer } from './_fixture'
import { primeSession } from './_session'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4000'
requireFixtureServer()
const SHOTS = join(process.cwd(), 'e2e-shots')

/** The REAL 17 infra tiers commerce seeds (models/catalogentry/seed/infra-tiers.json),
 *  in the raw `catalog-entry` shape the admin GET /v1/commerce/catalog/entries returns. */
function seedEntries(): Record<string, unknown>[] {
  const cloud = (
    [
      ['cloud-starter', 'Starter', 'Get started for free. Perfect for side projects, bots, and learning.', 500, { id: 'starter', vcpus: 1, memoryGB: 1, diskGB: 20, cpuType: 'shared', maxVMs: 1, priceMonthly: 5, features: ['1 VM', '1 vCPU', '1 GB RAM', '20 GB SSD'], freeTier: true }],
      ['cloud-builder', 'Builder', 'For developers shipping real products.', 1000, { id: 'builder', vcpus: 2, memoryGB: 2, diskGB: 40, cpuType: 'shared', maxVMs: 5, priceMonthly: 10, features: ['Up to 5 VMs', '2 vCPU'] }],
      ['cloud-dev', 'Dev', 'The sweet spot. Full dev environment with room to grow.', 1500, { id: 'dev', vcpus: 2, memoryGB: 8, diskGB: 25, cpuType: 'shared', maxVMs: 25, priceMonthly: 15, features: ['Up to 25 VMs', '2 vCPU', '8 GB RAM'], popular: true }],
      ['cloud-pro', 'Pro', 'Dedicated CPU. Zero noisy neighbors.', 2500, { id: 'pro', vcpus: 2, memoryGB: 8, diskGB: 80, cpuType: 'dedicated', maxVMs: 25, priceMonthly: 25, features: ['2 dedicated vCPU'] }],
      ['cloud-turbo', 'Turbo', '4x the power. Browser automation, CI/CD, and heavy workloads.', 3900, { id: 'turbo', vcpus: 4, memoryGB: 16, diskGB: 160, cpuType: 'shared', maxVMs: 25, priceMonthly: 39, features: ['4 vCPU', '16 GB RAM'] }],
      ['cloud-turbo-dedicated', 'Turbo Dedicated', 'All the power of Turbo with dedicated CPU cores.', 4900, { id: 'turbo-dedicated', vcpus: 4, memoryGB: 16, diskGB: 160, cpuType: 'dedicated', maxVMs: 25, priceMonthly: 49, features: ['4 dedicated vCPU'] }],
      ['cloud-business', 'Business', 'Team-scale compute.', 21900, { id: 'business', vcpus: 8, memoryGB: 32, diskGB: 240, cpuType: 'dedicated', maxVMs: 50, priceMonthly: 219, features: ['8 dedicated vCPU'] }],
      ['cloud-enterprise', 'Enterprise', 'Mission-critical infrastructure.', 42900, { id: 'enterprise', vcpus: 16, memoryGB: 64, diskGB: 360, cpuType: 'dedicated', maxVMs: 100, priceMonthly: 429, features: ['16 dedicated vCPU'] }],
      ['cloud-scale', 'Scale', 'Platform-scale compute.', 84900, { id: 'scale', vcpus: 32, memoryGB: 128, diskGB: 600, cpuType: 'dedicated', maxVMs: 250, priceMonthly: 849, features: ['32 dedicated vCPU'] }],
      ['cloud-mega', 'Mega', 'Maximum single-node power.', 129900, { id: 'mega', vcpus: 48, memoryGB: 192, diskGB: 960, cpuType: 'dedicated', maxVMs: 500, priceMonthly: 1299, features: ['48 dedicated vCPU'] }],
      ['cloud-ultra', 'Ultra', 'Extreme compute. Multi-node clusters.', 399900, { id: 'ultra', vcpus: 96, memoryGB: 384, diskGB: 1920, cpuType: 'dedicated', maxVMs: 1000, priceMonthly: 3999, features: ['96 dedicated vCPU'] }],
    ] as const
  ).map(([slug, name, description, priceCents, metadata], i) => ({ slug, name, category: 'cloud', description, priceCents, currency: 'usd', order: i, published: true, metadata }))

  const gpu = (
    [
      ['gpu-standard', 'GPU Standard', '1x H100 · 80 GB VRAM', 348, { gpu: '1x H100', vram: '80 GB', price: 3.48 }],
      ['gpu-pro', 'GPU Pro', '2x H100 · 160 GB VRAM', 696, { gpu: '2x H100', vram: '160 GB', price: 6.96 }],
      ['gpu-ultra', 'GPU Ultra', '4x H100 · 320 GB VRAM', 1392, { gpu: '4x H100', vram: '320 GB', price: 13.92 }],
    ] as const
  ).map(([slug, name, description, priceCents, metadata], i) => ({ slug, name, category: 'gpu', description, priceCents, currency: 'usd', order: 11 + i, published: true, metadata }))

  const datastore = (
    [
      ['datastore-basic', 'Basic', 'For teams getting started with analytics', 6652, { id: 'basic', replicas: 1, ramGiB: 8, vcpu: 2, storageGB: 1000, priceMonthly: 66.52, priceHourly: 0.0922, support: { level: 'standard' }, features: ['async_inserts', 'http_api'] }],
      ['datastore-scale', 'Scale', 'For production workloads with high availability', 49938, { id: 'scale', replicas: 2, ramGiB: 8, vcpu: 2, storageGB: null, priceMonthly: 499.38, priceHourly: 0.6936, support: { level: 'priority' }, popular: true }],
      ['datastore-enterprise', 'Enterprise', 'For mission-critical deployments at scale', 266940, { id: 'enterprise', replicas: 2, ramGiB: 32, vcpu: 8, storageGB: 5000, priceMonthly: 2669.4, priceHourly: 3.7075, support: { level: 'enterprise', sla: true }, contactSales: true }],
    ] as const
  ).map(([slug, name, description, priceCents, metadata], i) => ({ slug, name, category: 'datastore', description, priceCents, currency: 'usd', order: 14 + i, published: true, metadata }))

  return [...cloud, ...gpu, ...datastore]
}

const API_RE = /\/(v1|cloud|ai|billing|commerce|telemetry|vm|superbase|admin|integrations|auth\/refresh)(\/|$|\?)/

test('catalog editor renders the infra tiers, edits a price, and persists', async ({ page }) => {
  // A live in-memory catalog — GET returns it, PUT mutates it (the persistence loop).
  const store = new Map(seedEntries().map((e) => [e.slug as string, e]))
  // A holder (not a bare `let`) so TS keeps the union type across the route closure.
  const cap: { put: { slug: string; body: Record<string, unknown> } | null } = { put: null }

  await page.route('**/*', async (route: Route) => {
    const req = route.request()
    if (req.resourceType() === 'document') return route.continue()
    const url = new URL(req.url())
    const path = url.pathname

    // Catalog admin CRUD (bare JSON, not the casibase envelope).
    if (path === '/v1/commerce/catalog/entries' && req.method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([...store.values()]) })
    }
    const m = path.match(/^\/v1\/commerce\/catalog\/entries\/(.+)$/)
    if (m && req.method() === 'PUT') {
      const slug = decodeURIComponent(m[1])
      const body = JSON.parse(req.postData() || '{}') as Record<string, unknown>
      cap.put = { slug, body }
      const updated = { ...(store.get(slug) ?? {}), ...body, slug }
      store.set(slug, updated)
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(updated) })
    }

    // Everything else same-origin API → an honest empty envelope (the shell's
    // non-critical calls); let real assets/documents through.
    const sameOrigin = url.origin === new URL(BASE_URL).origin
    if (sameOrigin && !API_RE.test(path)) return route.continue()
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', msg: '', data: [], data2: 0 }) })
  })

  // A global admin (reserved `admin` org) — the catalog module is admin-gated.
  await primeSession(page, { owner: 'admin', name: 'z', email: 'z@hanzo.ai', isAdmin: true })

  await page.goto(`${BASE_URL}/catalog`, { waitUntil: 'domcontentloaded' })

  // The table renders every real tier.
  await expect(page.getByText('Catalog & Pricing').first()).toBeVisible({ timeout: 25_000 })
  await expect(page.getByText('cloud-dev').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('gpu-standard').first()).toBeVisible()
  await expect(page.getByText('datastore-enterprise').first()).toBeVisible()
  // The cloud-dev price is the seeded $15.00 before the edit.
  await expect(page.getByText('$15.00').first()).toBeVisible()

  // Open the cloud-dev row → the edit form.
  await page.getByText('cloud-dev').first().click()
  await expect(page.getByText('Edit Dev').first()).toBeVisible({ timeout: 10_000 })
  // The spec (metadata) editor shows the real cloud scalars.
  await expect(page.getByText('Spec (metadata)').first()).toBeVisible()

  // Screenshot the editor (table behind + the open edit form).
  mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: join(SHOTS, 'admin-catalog-editor.png'), fullPage: false })

  // Edit the price: $15 → $18. The price field is uniquely identified by its
  // placeholder "15" (the metadata priceMonthly value input shows placeholder "value").
  const priceBox = page.locator('input[placeholder="15"]')
  await expect(priceBox).toBeVisible({ timeout: 8_000 })
  await expect(priceBox).toHaveValue('15')
  await priceBox.fill('18')

  await page.getByRole('button', { name: 'Save changes' }).click()

  // The PUT was issued to the correct endpoint with the new priceCents (1800).
  await expect.poll(() => cap.put?.slug, { timeout: 10_000 }).toBe('cloud-dev')
  expect(cap.put?.body.priceCents).toBe(1800)
  // Name/category/metadata survived the round-trip (the form sends the whole entry).
  expect(cap.put?.body.name).toBe('Dev')
  expect(cap.put?.body.category).toBe('cloud')
  expect((cap.put?.body.metadata as Record<string, unknown>)?.vcpus).toBe(2)

  // The store persisted it, so the reloaded table shows the NEW price.
  await expect(page.getByText('$18.00').first()).toBeVisible({ timeout: 10_000 })
  await page.screenshot({ path: join(SHOTS, 'admin-catalog-editor-persisted.png'), fullPage: false })
})
