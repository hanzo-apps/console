/**
 * e2e: the assistant's ONE entry point, and the All-products directory you can act in.
 *
 * Three claims, each measured in a real browser rather than inferred from source:
 *
 *  1. The assistant opens from a FLOATING bottom-right control, not from the header —
 *     asserted on GEOMETRY (the control's box is in the bottom-right quadrant of the
 *     viewport) and on the header carrying no assistant control at all.
 *  2. Clicking an app in the All-products directory NAVIGATES to that app. This is the
 *     regression that matters: the rows rendered, hovered, and did nothing, so the
 *     directory looked interactive and was not. Asserted on where the browser LANDS.
 *  3. A pin made in the directory survives a reload EVEN WHEN the identity token
 *     carries an older preferences snapshot — the exact production condition (the
 *     token is minted at sign-in; a pin made after it is not in it).
 *
 * Local dev server + mocked network; `primeSession` supplies the IAM-PKCE identity.
 *
 * Run: BASE_URL=http://localhost:4000 npx playwright test assistant-fab-and-apps
 */
import { test, expect, type Route, type Page } from '@playwright/test'
import { requireFixtureServer } from './_fixture'
import { primeSession } from './_session'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4000'

requireFixtureServer()
const SHOTS = join(process.cwd(), 'e2e-shots')

const API_RE = /\/(v1|cloud|ai|billing|commerce|telemetry|vm|superbase|admin|paas|integrations)(\/|$|\?)/

async function mock(route: Route) {
  const req = route.request()
  if (req.resourceType() === 'document') return route.continue()
  const url = new URL(req.url())
  const sameOrigin = url.origin === new URL(BASE_URL).origin
  if (sameOrigin && !API_RE.test(url.pathname)) return route.continue()
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ status: 'ok', msg: '', data: [], data2: 0 }),
  })
}

/** Sign in and land on `path`, waiting for the signed-in shell to have mounted. */
async function boot(page: Page, path = '/', claims?: Parameters<typeof primeSession>[1]) {
  await page.route('**/*', mock)
  await primeSession(page, claims)
  await page.goto(`${BASE_URL}${path}`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('button', { name: 'Ask Hanzo' })).toBeVisible({ timeout: 60_000 })
}

test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }))

test('the assistant opens from the bottom-right, and the header carries no AI control', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await boot(page)

  const fab = page.getByRole('button', { name: 'Ask Hanzo' })
  const box = await fab.boundingBox()
  expect(box).not.toBeNull()
  // Bottom-right quadrant: the whole point of the relocation.
  expect(box!.x).toBeGreaterThan(1440 / 2)
  expect(box!.y).toBeGreaterThan(900 / 2)
  // A comfortable target, not a hairline.
  expect(box!.width).toBeGreaterThanOrEqual(44)
  expect(box!.height).toBeGreaterThanOrEqual(44)

  // The topbar itself holds no assistant control any more — it used to carry two
  // (a brand-H "Chat with Hanzo" and a "Talk to Hanzo" mic) beside the search box.
  const inTopbar = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.hz-topbar [aria-label]')).map((n) => n.getAttribute('aria-label') ?? ''),
  )
  expect(inTopbar).not.toHaveLength(0) // the topbar was found at all
  expect(inTopbar.filter((l) => /Hanzo/i.test(l))).toHaveLength(0)

  await page.screenshot({ path: join(SHOTS, 'assistant-fab-desktop.png') })

  // It opens the SAME assistant surface.
  await fab.click()
  await expect(page.getByText('Assistant').first()).toBeVisible({ timeout: 15_000 })
  await page.screenshot({ path: join(SHOTS, 'assistant-open-desktop.png') })
  await ctx.close()
})

test('the assistant control is reachable on a phone and never scrolls the body sideways', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  await boot(page)

  const fab = page.getByRole('button', { name: 'Ask Hanzo' })
  const box = await fab.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x + box!.width).toBeLessThanOrEqual(390)
  expect(box!.y).toBeGreaterThan(844 / 2)

  const [scrollW, clientW] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    document.documentElement.clientWidth,
  ])
  expect(scrollW).toBe(clientW)

  await page.screenshot({ path: join(SHOTS, 'assistant-fab-mobile.png') })
  await ctx.close()
})

test('clicking an app in All products opens that app', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await boot(page)

  await page.getByRole('button', { name: 'All products' }).first().click()
  const row = page.getByRole('button', { name: 'Open Agents' })
  await expect(row).toBeVisible({ timeout: 15_000 })
  await page.screenshot({ path: join(SHOTS, 'all-products-desktop.png') })

  await row.click()
  // Where the browser LANDS is the claim — not that a handler fired.
  await expect(page).toHaveURL(/\/agents$/, { timeout: 15_000 })
  await ctx.close()
})

test('a pin made in All products survives a reload under a STALE token snapshot', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()

  // The production condition: the identity token was minted an hour ago and carries a
  // preferences SNAPSHOT from then. Treating that snapshot as authoritative is what
  // silently threw away every pin made since — the pin reads as pinned, and is gone
  // after a reload.
  const snapshot = { pins: [{ id: 'models', group: '' }], pinGroups: [] }
  await boot(page, '/', {
    properties: { 'hanzo.preferences': JSON.stringify(snapshot) },
    issuedAt: Math.floor(Date.now() / 1000) - 3600,
  })

  const openDirectory = async () => {
    await page.getByRole('button', { name: 'All products' }).first().click()
    // "…to sidebar" / "…from sidebar" are the directory's own labels — the home page's
    // Apps map carries a plain "Pin Agents", so the short form is ambiguous.
    await expect(page.getByRole('button', { name: /Agents (to|from) sidebar/ })).toBeVisible({ timeout: 15_000 })
  }

  // The snapshot the token carries is what the sidebar starts from.
  await openDirectory()
  await page.getByRole('button', { name: 'Pin Agents to sidebar' }).click()
  await expect(page.getByRole('button', { name: 'Remove Agents from sidebar' })).toBeVisible()

  // Only a write the SERVER acknowledged earns the stamp that out-ranks the snapshot.
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('hanzo.console2.prefs.z.writtenAt')), { timeout: 10_000 })
    .not.toBeNull()

  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('button', { name: 'Ask Hanzo' })).toBeVisible({ timeout: 60_000 })

  // Still pinned — the hour-old snapshot did not win. Asserted on what the user sees…
  await openDirectory()
  await expect(page.getByRole('button', { name: 'Remove Agents from sidebar' })).toBeVisible({ timeout: 15_000 })
  // …and on what was actually kept (models from the snapshot, agents from the write).
  const pins = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('hanzo.console2.prefs.z') ?? '{}')
    return (raw.pins ?? []).map((p: { id: string }) => p.id)
  })
  expect(pins).toContain('agents')
  expect(pins).toContain('models')
  await ctx.close()
})
