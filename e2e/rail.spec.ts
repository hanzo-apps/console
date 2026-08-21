/**
 * e2e: the rail — its two levels, its two ends, and the one search.
 *
 * These are assertions only a browser can make. They read COMPUTED geometry and
 * counts, because every defect here is a LAYOUT defect: a level that renders while
 * the level above it is still painted, a name replaced by a picture, two triggers
 * that are meant to be peers and are not. `toBeVisible()` resolves to display /
 * visibility / box-size, which is the only honest test of "is this on screen".
 *
 * Run: BASE_URL=http://localhost:4123 npx playwright test rail
 */
import { test, expect, type Route, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { primeSession } from './_session'
import { TYPE } from './_gate'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4000'
const SHOTS = join(process.cwd(), 'e2e-shots')
const API_RE = /\/(v1|cloud|ai|billing|commerce|telemetry|vm|superbase|admin|integrations|org|auth\/refresh)(\/|$|\?)/

/** A tenant that HAS uploaded a logo — the case that used to erase the org's name. */
const LOGO = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"%3E%3Crect width="24" height="24" fill="%237c5cff"/%3E%3C/svg%3E'

/**
 * Every backend answers 401 except the org identity, which answers a real org
 * WITH a logo and a display name. This spec is about the RAIL, not data, and an
 * unauthorized read is the state every module already handles honestly.
 */
async function mock(route: Route) {
  const req = route.request()
  if (req.resourceType() === 'document') return route.continue()
  const url = new URL(req.url())
  const json = (body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  if (url.pathname.startsWith('/auth/')) return json({ ok: true })
  if (url.href.includes('get-organization')) {
    return json({ status: 'ok', data: { name: 'hanzo', displayName: 'Hanzo AI', logo: LOGO } })
  }
  const sameOrigin = url.origin === new URL(BASE_URL).origin
  if (sameOrigin && !API_RE.test(url.pathname)) return route.continue()
  return json({ error: 'Sign in to use Hanzo Cloud.' }, 401)
}

/** A hanzo-org user — an admin of their OWN org, NOT a platform super admin.
 *  This is the identity the whole catalog must be available to. */
const ACCOUNT = { owner: 'hanzo', name: 'z', email: 'z@hanzo.ai', displayName: 'Z Admin', isAdmin: true }

async function open(page: Page, path: string) {
  await page.route('**/*', mock)
  await primeSession(page, ACCOUNT)
  await page.goto(`${BASE_URL}${path}`, { waitUntil: 'domcontentloaded' })
  await page.locator('nav[aria-label="Products"]').first().waitFor({ state: 'attached', timeout: 30_000 })
  await page.waitForTimeout(1500)
}

/** The persistent rail (the shell mounts the same nav three times; this is the
 *  first in document order, and every geometry check proves it is the painted one). */
const rail = (page: Page) => page.locator('nav[aria-label="Products"]').first()
const railRow = (page: Page, name: string) =>
  rail(page).getByRole('button', { name, exact: true }).filter({ visible: true })

test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }))

test('level 1 is the whole catalog — a hanzo-org user is not shown a dozen products', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await ctx.newPage()
  await open(page, '/')

  // The catalog used to be filtered to a hard-coded 13-id launch list, so a
  // customer saw six categories. Every category the brand admits is here now.
  const text = await rail(page).innerText()
  for (const category of ['AI', 'Compute', 'Data', 'Network', 'Security', 'Observe', 'Platform', 'Dev', 'Web3', 'Apps']) {
    expect(text, `${category} is a section of the catalog`).toContain(category)
  }
  // Products from categories the launch list erased entirely.
  for (const label of ['Vector', 'Functions', 'Gateway', 'Fine-tuning', 'Projects']) {
    await expect(railRow(page, label).first(), `${label} is reachable`).toBeVisible()
  }

  await page.screenshot({ path: join(SHOTS, 'rail-level-1.png') })
  await ctx.close()
})

test('level 2 REPLACES level 1 — the pages are flush and the catalog is not underneath', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await ctx.newPage()
  await open(page, '/models')

  // The product's own pages are the list.
  for (const label of ['Catalog', 'Leaderboard', 'Blend']) {
    await expect(railRow(page, label).first(), `${label} is a rail row`).toBeVisible()
  }
  // Its category siblings follow them, so moving sideways is one click.
  await expect(rail(page)).toContainText('More in AI')
  await expect(railRow(page, 'Playground').first()).toBeVisible()

  // …and NOTHING from another category is painted: level 1 is gone, not pushed down.
  for (const label of ['Vector', 'Functions', 'Gateway']) {
    expect(await railRow(page, label).count(), `${label} belongs to level 1`).toBe(0)
  }

  // Exactly ONE mention of the product. It used to appear TWICE — once under
  // Pinned carrying the indented pages, once in its category carrying nothing —
  // so the rail showed the same product in two places, one of them dead.
  const lines = (await rail(page).innerText()).split('\n').map((l) => l.trim())
  expect(lines.filter((l) => l === 'Models'), 'Models is named once').toHaveLength(1)
  // …and it is a HEADING, not a link: its index page is the first row beneath it,
  // so a second way to the same page would be the duplication this level removes.
  expect(await railRow(page, 'Models').count(), 'the name is not a second link').toBe(0)

  // The pages are FLUSH with the row that names the level, not indented under it.
  const pages = await Promise.all(
    ['Catalog', 'Leaderboard', 'Blend'].map(async (l) => (await railRow(page, l).first().boundingBox())!.x),
  )
  const back = (await railRow(page, 'Back to AI').first().boundingBox())!.x
  for (const [i, x] of pages.entries()) {
    expect(Math.abs(x - back), `page ${i} is flush with the level, not indented`).toBeLessThanOrEqual(2)
  }

  await page.screenshot({ path: join(SHOTS, 'rail-level-2.png') })

  // The way back up is the category the product sits in.
  await railRow(page, 'Back to AI').first().click()
  await page.waitForTimeout(900)
  expect(new URL(page.url()).pathname).toBe('/category/ai')
  // …and the rail is level 1 again.
  await expect(railRow(page, 'Vector').first()).toBeVisible()

  await ctx.close()
})

test('the org switcher shows the org NAME even when the org has a logo', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await ctx.newPage()
  await open(page, '/')

  const org = page.getByTestId('switcher-context').first()
  // The logo took the name's slot; the name survived only in the aria-label.
  await expect(org).toContainText('Hanzo AI')
  // The logo is the MARK beside it, not a replacement for it.
  await expect(org.locator('img')).toBeVisible()

  await org.click()
  const menu = page.locator('[role=menu]').first()
  await menu.waitFor()
  await page.waitForTimeout(600)

  // The row for the very same org must read the SAME words and wear the SAME mark
  // as the trigger above it. A regular user's row was re-derived from the slug, so
  // the control read "Hanzo AI" over a row reading "Hanzo", with a logo over a
  // monogram — one org, named twice, from two places.
  const row = menu.getByRole('radio').first()
  await expect(row).toHaveText('Hanzo AI')
  await expect(row.locator('img')).toBeVisible()

  await page.screenshot({ path: join(SHOTS, 'rail-org-name.png'), animations: 'disabled' })
  await ctx.close()
})

/**
 * The two ends of the rail were peers in every dimension, and the head is now
 * deliberately the heavier of the two.
 *
 * That is a decision, not drift. The rail carries no wordmark of its own, so the
 * tenant's mark is the first thing read on the screen, and a control that anchors
 * a surface is not the same object as one that sits at its foot. `@hanzo/ui`'s
 * `OrgSwitcher` says both — `lead` steps the row 44→56, the mark 30→36 and the
 * label `$4`→`$6` at 700 — and it lives in the component that owns the markup
 * precisely so a host never reaches in through `className` descendant selectors
 * to get it.
 *
 * So the equality this test used to assert is replaced by the two claims that
 * survive it: they still share a LEFT EDGE and a chevron (they are the same kind
 * of control, opened the same way), and the head is measurably larger — on the
 * SAME type ramp, which is what makes it a step rather than a second scale.
 */
test('the head anchors the rail, the foot is its peer in kind — one ramp, one edge', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await ctx.newPage()
  await open(page, '/')

  // Each control renders twice — desktop rail and mobile drawer — and only one of
  // them is on screen at this viewport. `.first()` is DOM order, not visibility, so
  // it can measure the copy nobody can see; `:visible` measures the one that painted.
  const measure = (id: string) =>
    page.locator(`[data-testid="${id}"]:visible`).first().evaluate((el) => {
      const mark = el.querySelector('img, [class*="OrgMark"], span, div')
      // The NAME, not the trigger. The button's own `font-size` is the inherited
      // control size and is identical on both ends, so reading it compared nothing —
      // the type that carries the lockup is on the label, and the label is the
      // widest text leaf (the monogram glyph is the other one).
      const label = [...el.querySelectorAll('*')]
        .filter((e) => e.children.length === 0 && (e.textContent ?? '').trim().length > 0)
        .sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0]
      const ls = label ? getComputedStyle(label) : getComputedStyle(el)
      return {
        height: el.getBoundingClientRect().height,
        x: el.getBoundingClientRect().x,
        font: ls.fontSize,
        weight: ls.fontWeight,
        // The chevron: both must carry one, or one reads as a caption.
        svgs: el.querySelectorAll('svg').length,
        markH: mark ? Math.round(mark.getBoundingClientRect().height) : 0,
      }
    })

  const org = await measure('switcher-context')
  const account = await measure('nav-user')

  // Same kind of control: one edge, one affordance.
  expect(account.x, 'same left edge').toBe(org.x)
  expect(account.svgs > 0 && org.svgs > 0, 'both carry a chevron').toBe(true)

  // The head anchors: measurably larger in the row and in the mark.
  expect(org.height, 'the head is the taller control').toBeGreaterThan(account.height)
  expect(org.markH, 'the head carries the larger mark').toBeGreaterThan(account.markH)

  // …and it steps up the SHARED ramp rather than introducing a second scale.
  // An off-ramp size here would be a local type decision, which is the thing the
  // design gate exists to refuse.
  expect(TYPE.has(Math.round(parseFloat(org.font))), `head type ${org.font} is on the ramp`).toBe(true)
  expect(TYPE.has(Math.round(parseFloat(account.font))), `foot type ${account.font} is on the ramp`).toBe(true)
  expect(parseFloat(org.font), 'the head reads larger than the foot').toBeGreaterThan(parseFloat(account.font))

  // The account is at the FOOT, the org at the HEAD — peers, not a stack.
  const orgY = (await page.getByTestId('switcher-context').first().boundingBox())!.y
  const accY = (await page.getByTestId('nav-user').first().boundingBox())!.y
  expect(accY).toBeGreaterThan(orgY)

  await page.screenshot({ path: join(SHOTS, 'rail-switchers.png') })

  // Both open onto the same sheet, and the account's opens UPWARD so it stays
  // on screen from the foot of the rail.
  await page.getByTestId('nav-user').first().click()
  const menu = page.locator('[role=menu]').first()
  await menu.waitFor()
  await page.waitForTimeout(600)
  const box = (await menu.boundingBox())!
  expect(box.y, 'the account sheet opens upward, fully on screen').toBeGreaterThanOrEqual(0)
  expect(box.y + box.height).toBeLessThanOrEqual(1001)
  // It PAINTS: an opaque sheet, not a transparent stack the rail reads through.
  const paint = await menu.evaluate((el) => {
    const s = getComputedStyle(el)
    return { bg: s.backgroundColor, opacity: s.opacity }
  })
  expect(paint.bg).not.toBe('rgba(0, 0, 0, 0)')
  expect(Number(paint.opacity)).toBe(1)
  await page.screenshot({ path: join(SHOTS, 'rail-account-menu.png'), animations: 'disabled' })
  await ctx.close()
})

test('search from the rail reaches a product the rail is not currently showing', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await ctx.newPage()
  // Inside a product, so the rail is level 2 and the catalog is put away.
  await open(page, '/models')
  expect(await railRow(page, 'Vector').count(), 'Vector is not on the rail here').toBe(0)

  // The rail's search box is the SAME palette the header opens — one search.
  await rail(page).getByText('Search or jump to…').first().click()
  await page.waitForTimeout(900)

  // Fill the palette's OWN input, then commit — where the query TAKES you is the
  // honest probe. Merely finding the word "Vector" on screen proves nothing: with an
  // empty query the palette browses the whole catalog, so "Vector" is already there
  // and a spec that looks for it passes without the search ever having run.
  const box = page.getByPlaceholder(/Search apps and commands/i).filter({ visible: true }).first()
  await box.fill('vector')
  await expect(page.locator('#cmdk-active').first()).toBeVisible()
  await page.screenshot({ path: join(SHOTS, 'rail-search.png'), animations: 'disabled' })

  await page.keyboard.press('Enter')
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 }).toBe('/vector')

  // …and the rail followed: it is now Vector's level 2, from a product that was
  // nowhere on the rail a moment ago.
  await page.waitForTimeout(1500)
  await expect(rail(page)).toContainText('More in Data')
  await page.screenshot({ path: join(SHOTS, 'rail-search-landed.png'), animations: 'disabled' })
  await ctx.close()
})

test('the settings toggle decides whether the rail lists the catalog', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await ctx.newPage()
  await open(page, '/profile')

  const label = page.getByText('Show every product').first()
  await expect(label).toBeVisible()
  await page.screenshot({ path: join(SHOTS, 'rail-toggle.png') })

  // ON by default: the rail carries the catalog — here, the rest of this
  // product's category beneath its own pages.
  await expect(rail(page)).toContainText('More in Settings')
  await expect(railRow(page, 'Members').first()).toBeVisible()

  // Turn it off — the rail keeps this product's pages and the pins, nothing else.
  const toggle = page.getByRole('switch').first()
  await expect(toggle).toBeVisible()
  await toggle.click()
  await page.waitForTimeout(900)
  await expect(rail(page), 'the catalog is put away').not.toContainText('More in Settings')
  await expect(railRow(page, 'Account').first(), 'this product keeps its pages').toBeVisible()
  await page.screenshot({ path: join(SHOTS, 'rail-toggle-off.png') })

  // Back at level 1 the catalog is put away there too — the pins remain.
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)
  expect(await railRow(page, 'Vector').count(), 'no catalog at level 1 either').toBe(0)
  await expect(railRow(page, 'Models').first(), 'the pins stay').toBeVisible()

  await ctx.close()
})
