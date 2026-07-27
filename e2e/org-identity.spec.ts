/**
 * e2e: the console's ORG identity in the chrome — mocked-network render proof.
 *
 * Two things this pins, both of which the shipped console got wrong:
 *
 *  1. The top-left mark is the ORG's, never the house glyph. With a logo it is
 *     that logo; with none it is the org's MONOGRAM — the treatment the account
 *     widget gives a person — and NOT the brand mark, and NOT the org's name set
 *     as running text.
 *  2. The org switcher is the PEER of the account control: same height, same
 *     mark size, same type, same hit area, same left edge.
 *
 * Both are measured off the RENDERED boxes, not off class names, so a styling
 * regression fails here.
 *
 * Run: BASE_URL=http://localhost:4000 npx playwright test org-identity
 */
import { test, expect, type Page, type Route } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { requireFixtureServer } from './_fixture'
import { primeSession } from './_session'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4000'
const SHOTS = join(process.cwd(), 'e2e-shots')

requireFixtureServer()
test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }))

/** A tenant whose id carries a separator — its monogram must read AL, not A. */
const ORG = 'acme-labs'
const LOGO = 'https://cdn.example.test/acme-labs.png'
const API_RE = /\/(v1|ai|billing|commerce|telemetry|vm|superbase|admin|paas|integrations|auth\/refresh)(\/|$|\?)/

const envelope = (data: unknown) => JSON.stringify({ status: 'ok', msg: '', data, data2: 0 })

/** Mount the shell as a member of `acme-labs`; `logo` decides which mark shows. */
async function openShell(page: Page, logo: string | null) {
  await page.route('**/*', async (route: Route) => {
    const req = route.request()
    if (req.resourceType() === 'document') return route.continue()
    const url = new URL(req.url())

    // The ONE org read the chrome makes (`useOrgIdentity` → get-organization).
    if (url.pathname.endsWith('/v1/iam/get-organization')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: envelope({ owner: 'admin', name: ORG, displayName: 'Acme Labs', logo: logo ?? '' }),
      })
    }
    // The logo bytes — a 1x1 PNG, so the <img> genuinely paints.
    if (url.href === LOGO) {
      return route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
          'base64',
        ),
      })
    }
    if (url.origin === new URL(BASE_URL).origin && !API_RE.test(url.pathname)) return route.continue()
    return route.fulfill({ status: 200, contentType: 'application/json', body: envelope([]) })
  })

  // A plain tenant member (owner !== 'admin'), i.e. NOT a super admin — the case
  // that has no cross-tenant org list to draw its own row from.
  await primeSession(page, { owner: ORG, name: 'dave', email: 'dave@acme.test', displayName: 'Dave Lorenzini', isAdmin: false })
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('button', { name: /account menu/i }).first()).toBeVisible({ timeout: 30_000 })
}

const orgMark = (page: Page) => page.getByRole('link', { name: /— home/ }).first()
const orgTrigger = (page: Page) => page.getByRole('button', { name: /switch organization/i }).first()
const accountTrigger = (page: Page) => page.getByRole('button', { name: /account menu/i }).first()

test('the top-left mark is the org monogram — never the house mark, never the name as text', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await openShell(page, null)

  const mark = orgMark(page)
  await expect(mark).toBeVisible()

  // The monogram of the org's DISPLAY name, by the account widget's own rule.
  await expect(mark).toHaveText('AL')

  // Not the house glyph: the slot paints no SVG at all.
  expect(await mark.locator('svg').count()).toBe(0)
  // Not the org name as running text.
  await expect(mark).not.toContainText('Acme Labs')

  await page.screenshot({ path: join(SHOTS, 'org-identity-monogram.png') })
  await ctx.close()
})

test('the org’s OWN logo replaces the mark when IAM carries one', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await openShell(page, LOGO)

  const logo = orgMark(page).locator('img')
  await expect(logo).toHaveAttribute('src', LOGO)
  // The logo REPLACES the monogram — one mark, not both.
  await expect(orgMark(page)).toHaveText('')
  expect(await orgMark(page).locator('svg').count()).toBe(0)

  await page.screenshot({ path: join(SHOTS, 'org-identity-logo.png') })
  await ctx.close()
})

test('the org switcher reads as the peer of the account control', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await openShell(page, null)

  const org = orgTrigger(page)
  const account = accountTrigger(page)
  await expect(org).toBeVisible()
  await expect(account).toBeVisible()

  const [orgBox, accountBox] = [await org.boundingBox(), await account.boundingBox()]
  if (!orgBox || !accountBox) throw new Error('a switcher did not lay out')

  // Same height, same width, same left edge — one hit area, one column.
  expect(Math.round(orgBox.height)).toBe(Math.round(accountBox.height))
  expect(Math.abs(orgBox.width - accountBox.width)).toBeLessThanOrEqual(1)
  expect(Math.abs(orgBox.x - accountBox.x)).toBeLessThanOrEqual(1)
  // A real target, not a caption.
  expect(orgBox.height).toBeGreaterThanOrEqual(44)

  // Same type: the org name and the account name are set identically.
  const type = (root: typeof org, name: string) =>
    root.locator(`text=${name}`).first().evaluate((el) => {
      const s = getComputedStyle(el)
      return { size: s.fontSize, weight: s.fontWeight }
    })
  expect(await type(org, 'Acme Labs')).toEqual(await type(account, 'Dave Lorenzini'))

  // Same mark size — the org monogram tile matches the account avatar tile.
  const tile = async (root: typeof org) => {
    const b = await root.locator('div,span').filter({ hasText: /^(AL|DL)$/ }).last().boundingBox()
    return b ? { w: Math.round(b.width), h: Math.round(b.height) } : null
  }
  expect(await tile(org)).toEqual(await tile(account))

  await page.screenshot({ path: join(SHOTS, 'org-identity-peers.png') })
  // The sidebar column alone — the two controls, top and bottom, side by side.
  await page.screenshot({ path: join(SHOTS, 'org-identity-sidebar.png'), clip: { x: 0, y: 0, width: 300, height: 900 } })
  await ctx.close()
})
