/**
 * e2e: find and do — pin, sort, filter, search, and the keyboard that drives them.
 *
 * Every claim here is measured in a real browser on COMPUTED STYLE and GEOMETRY,
 * because the failures this lane exists to prevent are invisible to a status code:
 * a pin that reports success and is gone after a reload, an affordance that renders
 * at zero opacity forever, a control painted off its own row.
 *
 * Local fixture server + mocked network; `primeSession` supplies the IAM-PKCE
 * identity. The preference PATCH is mocked to echo nothing, which is the HONEST
 * worst case — it is exactly the condition (an account that never reports the key
 * back) under which pins used to be lost.
 *
 * Run: BASE_URL=http://localhost:4300 npx playwright test find-and-do
 */
import { test, expect, type Route, type Page } from '@playwright/test'
import { requireFixtureServer } from './_fixture'
import { primeSession } from './_session'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4300'

requireFixtureServer()
const SHOTS = join(process.cwd(), 'e2e-shots')

const API_RE = /\/(v1|cloud|ai|billing|commerce|telemetry|vm|superbase|admin|paas|integrations)(\/|$|\?)/

/** A small real-shaped model catalog, enough for the Models + Marketplace lists. */
const MODELS = {
  object: 'list',
  data: [
    { id: 'zen5', owned_by: 'hanzo' },
    { id: 'zen5-mini', owned_by: 'hanzo' },
    { id: 'anthropic/claude-opus-4.6', owned_by: 'anthropic' },
    { id: 'qwen3.5-397b', owned_by: 'hanzo' },
  ],
}

async function mock(route: Route) {
  const req = route.request()
  if (req.resourceType() === 'document') return route.continue()
  const url = new URL(req.url())
  if (url.pathname === '/v1/models') {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MODELS) })
  }
  const sameOrigin = url.origin === new URL(BASE_URL).origin
  if (sameOrigin && !API_RE.test(url.pathname)) return route.continue()
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ status: 'ok', msg: '', data: [], data2: 0 }),
  })
}

/**
 * Sign in and land on `path`. `ready` is what proves the signed-in shell mounted —
 * it defaults to the rail's own pin affordances, which exist only on the DESKTOP
 * rail (below lg the nav is a drawer), so a mobile viewport passes its own signal.
 */
async function boot(page: Page, path = '/', ready?: () => Promise<void>) {
  await page.route('**/*', mock)
  await primeSession(page)
  await page.goto(`${BASE_URL}${path}`, { waitUntil: 'domcontentloaded' })
  if (ready) return ready()
  await expect(page.getByRole('button', { name: /^(Pin|Unpin) / }).first()).toBeVisible({ timeout: 30_000 })
}

/**
 * The palette, opened by the real ⌘K path rather than by clicking chrome.
 *
 * ⌘K is a TOGGLE bound on `window`, so a press that lands mid-navigation (before the
 * destination route has mounted its listener) is simply lost. Retrying the real
 * gesture is honest — it still proves the shortcut works — where a single press would
 * only prove the test's timing.
 */
/** The one mounted palette dialog (the one that owns the search input). */
const palette = (page: Page) =>
  page
    .locator('[role="dialog"]')
    .filter({ has: page.getByPlaceholder('Search apps and commands…') })
    .last()

async function openPalette(page: Page) {
  const input = page.getByPlaceholder('Search apps and commands…')
  await expect(async () => {
    await page.keyboard.press('ControlOrMeta+k')
    await expect(input).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 20_000 })
}

test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }))

test('a pin survives a reload — the account is silent, the cache is not', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await boot(page)

  const pin = page.getByRole('button', { name: 'Pin Agents' }).first()
  await expect(pin).toBeVisible()
  await pin.click()

  // It reads as pinned immediately…
  await expect(page.getByRole('button', { name: 'Unpin Agents' }).first()).toBeVisible()

  // …and is STILL pinned after a full reload. Before this lane's fix the account's
  // (silent) view overwrote the cache here and the pin was gone.
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('button', { name: 'Unpin Agents' }).first()).toBeVisible({ timeout: 30_000 })

  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('hanzo.console2.prefs.z') ?? '{}'),
  )
  expect(stored.pins.map((p: { id: string }) => p.id)).toContain('agents')

  // Unpinning is just as durable, so the state is genuinely the user's, not sticky.
  await page.getByRole('button', { name: 'Unpin Agents' }).first().click()
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('button', { name: 'Pin Agents' }).first()).toBeVisible({ timeout: 30_000 })

  await ctx.close()
})

test('typing a product name opens that product — pins never outrank what you typed', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await boot(page)

  // Models and Chat are pinned by default. Before this was split, `pinnedFirst` was
  // applied to the RANKED list too, so a barely-matching pinned product outranked an
  // exact name match and "billing" + ↵ opened /models. Enter is the honest probe:
  // it asserts on where the user actually lands, not on DOM order.
  for (const [query, path] of [
    ['agents', '/agents'],
    ['billing', '/billing'],
    ['vector', '/vector'],
  ]) {
    await openPalette(page)
    await page.getByPlaceholder('Search apps and commands…').fill(query)
    await expect(page.locator('#cmdk-active').first()).toBeVisible()
    await page.keyboard.press('Enter')
    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: 15_000 })
      .toBe(path)
  }

  await ctx.close()
})

test('the default view leads with pins, and a result can be pinned without leaving', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await boot(page)

  await openPalette(page)

  // A product query (not one that also matches a verb like "ask"/"apps"), so the
  // selection lands on a destination — actions rank first and carry no pin.
  await page.getByPlaceholder('Search apps and commands…').fill('agents')
  await expect(page.locator('#cmdk-active')).toBeVisible()

  // The pin on the SELECTED result: a real control, at the row's RIGHT edge.
  const activeRow = page.locator('#cmdk-active')
  const pinBtn = activeRow.getByRole('button', { name: /^(Pin|Unpin) / })
  await expect(pinBtn).toHaveCount(1)

  const rowBox = await activeRow.boundingBox()
  const pinBox = await pinBtn.boundingBox()
  expect(rowBox).not.toBeNull()
  expect(pinBox).not.toBeNull()
  // Right edge: the pin sits in the last quarter of its row, and inside it.
  expect(pinBox!.x).toBeGreaterThan(rowBox!.x + rowBox!.width * 0.75)
  expect(pinBox!.x + pinBox!.width).toBeLessThanOrEqual(rowBox!.x + rowBox!.width + 1)
  // Vertically centred on its own row, not floating above or below it.
  const rowMid = rowBox!.y + rowBox!.height / 2
  const pinMid = pinBox!.y + pinBox!.height / 2
  expect(Math.abs(rowMid - pinMid)).toBeLessThan(4)
  // A real hit target, not a 2px sliver.
  expect(pinBox!.width).toBeGreaterThanOrEqual(20)
  expect(pinBox!.height).toBeGreaterThanOrEqual(20)

  const label = (await pinBtn.getAttribute('aria-label')) ?? ''
  const product = label.replace(/^(Pin|Unpin) /, '')

  // ⌥↵ pins the selection and KEEPS the palette open — curating is repeatable.
  await page.keyboard.press('Alt+Enter')
  await expect(page.getByPlaceholder('Search apps and commands…')).toBeVisible()
  await expect(activeRow.getByRole('button', { name: `Unpin ${product}` })).toHaveCount(1)
  await expect(activeRow.getByRole('button', { name: /^(Pin|Unpin) / })).toHaveAttribute('aria-pressed', 'true')

  await page.screenshot({ path: join(SHOTS, 'palette-pin.png') })

  // Clear the query: the default view collects the pins into one leading section,
  // under the same word the sidebar uses.
  await page.getByPlaceholder('Search apps and commands…').fill('')

  // Scoped to the PALETTE. The sidebar has its own "Pinned" heading, so an unscoped
  // text match here would pass whether or not the palette groups anything at all —
  // and an assertion that can pass for the wrong reason is worse than no assertion.
  //
  // Read via textContent, not a text locator: the section labels are uppercased in
  // CSS, so `getByText('Pinned')` matches the rendered "PINNED" inconsistently.
  const scan = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input')).filter((i) =>
      (i.getAttribute('placeholder') ?? '').startsWith('Search apps'),
    )
    const host = inputs[0]?.closest('[role="dialog"]')
    if (!host) return null
    const text = Array.from(host.querySelectorAll('*'))
      .filter((e) => e.children.length === 0)
      .map((e) => (e.textContent ?? '').trim())
      .filter(Boolean)
    return { palettes: inputs.length, hasPinnedSection: text.includes('Pinned') }
  })
  expect(scan).not.toBeNull()
  // Exactly one palette is mounted, so nothing read here can be a stale copy.
  expect(scan!.palettes).toBe(1)
  // The pins are collected under their own heading rather than scattered through
  // the categories.
  expect(scan!.hasPinnedSection).toBe(true)

  await page.screenshot({ path: join(SHOTS, 'palette-pinned-first.png') })

  // And the selection starts on a PINNED product, so ↵ on the untouched default
  // view goes somewhere the user chose. `models` is pinned out of the box.
  await page.keyboard.press('Enter')
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 }).toBe('/models')

  await ctx.close()
})

test('the row pin is quiet until reached, and lit while pinned', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await boot(page)
  await openPalette(page)
  await page.getByPlaceholder('Search apps and commands…').fill('agents')
  await expect(page.locator('#cmdk-active')).toBeVisible()

  // A result that is NOT the keyboard selection: its pin is painted at zero opacity
  // — present in the DOM and reachable, but not drawn.
  const rows = page.locator('.hz-row-pin')
  const count = await rows.count()
  let restingOpacity: number | null = null
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i)
    if ((await row.getAttribute('id')) === 'cmdk-active') continue
    const quiet = row.locator('.hz-pin')
    if ((await quiet.count()) === 0) continue
    restingOpacity = await quiet.first().evaluate((el) => Number(getComputedStyle(el).opacity))
    // Hovering the ROW reveals it — the affordance appears where the eye already is.
    await row.hover()
    await expect
      .poll(async () => quiet.first().evaluate((el) => Number(getComputedStyle(el).opacity)))
      .toBeGreaterThan(0.9)
    break
  }
  expect(restingOpacity).not.toBeNull()
  expect(restingOpacity).toBeLessThan(0.05)

  // The SELECTED row's pin is drawn without any hover — the keyboard user is never
  // shown an empty row where the mouse user is shown a control.
  const activePin = page.locator('#cmdk-active').locator('[aria-label^="Pin "], [aria-label^="Unpin "]').first()
  const activeOpacity = await activePin.evaluate((el) => Number(getComputedStyle(el).opacity))
  expect(activeOpacity).toBeGreaterThan(0.3)

  await ctx.close()
})

test('⌘K, arrows, Enter and Escape drive the whole surface', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await boot(page)

  await openPalette(page)
  const first = await page.locator('#cmdk-active').getAttribute('aria-label').catch(() => null)
  const firstText = await page.locator('#cmdk-active').innerText()

  // ↓ moves the selection to a different row (the selection is a single element, so
  // "moved" is provable by its text changing).
  await page.keyboard.press('ArrowDown')
  await expect.poll(async () => page.locator('#cmdk-active').innerText()).not.toBe(firstText)

  // ↑ returns to it.
  await page.keyboard.press('ArrowUp')
  await expect.poll(async () => page.locator('#cmdk-active').innerText()).toBe(firstText)
  expect(first === null || typeof first === 'string').toBe(true)

  await page.screenshot({ path: join(SHOTS, 'palette-keyboard.png') })

  // Esc closes.
  await page.keyboard.press('Escape')
  await expect(page.getByPlaceholder('Search apps and commands…')).toHaveCount(0)

  // ↵ on a selection navigates — the palette is a way to ACT, not just to look.
  await openPalette(page)
  await page.getByPlaceholder('Search apps and commands…').fill('marketplace')
  await expect(page.locator('#cmdk-active')).toBeVisible()
  await page.keyboard.press('Enter')
  await expect.poll(() => page.url(), { timeout: 15_000 }).toContain('/marketplace')

  await ctx.close()
})

test('a list keeps the narrowing you gave it, and Reset gives it back', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const search = page.getByPlaceholder('Search listings, providers, descriptions…')
  // Drilled into a product the rail shows that product's sub-nav, not the catalog
  // with its pins — so the surface under test is its own readiness signal.
  await boot(page, '/marketplace', async () => {
    await expect(search).toBeVisible({ timeout: 30_000 })
  })

  // Nothing is narrowed yet, so Reset is not there. A control that is always present
  // but usually inert teaches a user to ignore it.
  await expect(page.getByRole('button', { name: 'Reset filters' })).toHaveCount(0)

  await search.fill('zen')
  const available = page.getByRole('button', { name: 'Available now' })
  await available.click()
  await expect(available).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Reset filters' })).toBeVisible()
  await page.screenshot({ path: join(SHOTS, 'list-narrowed.png') })

  // Navigate away and back: the view is exactly as it was left. This is the whole
  // point of persisting it — a list you must re-narrow on every visit is a list you
  // stop narrowing.
  await page.goto(`${BASE_URL}/models`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByPlaceholder('Search models across every family…')).toBeVisible({ timeout: 30_000 })
  await page.goto(`${BASE_URL}/marketplace`, { waitUntil: 'domcontentloaded' })

  const back = page.getByPlaceholder('Search listings, providers, descriptions…')
  await expect(back).toBeVisible({ timeout: 30_000 })
  await expect(back).toHaveValue('zen')
  await expect(page.getByRole('button', { name: 'Available now' })).toHaveAttribute('aria-pressed', 'true')

  // …and it survives a full reload, like the pins.
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByPlaceholder('Search listings, providers, descriptions…')).toHaveValue('zen', {
    timeout: 30_000,
  })

  // Reset clears every narrowing at once and takes its own control away with it.
  await page.getByRole('button', { name: 'Reset filters' }).click()
  await expect(page.getByPlaceholder('Search listings, providers, descriptions…')).toHaveValue('')
  await expect(page.getByRole('button', { name: 'Available now' })).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByRole('button', { name: 'Reset filters' })).toHaveCount(0)

  await ctx.close()
})

test('the list bar reads on the black canvas and never scrolls the page sideways', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  const search = page.getByPlaceholder('Search models across every family…')
  // At 390px the rail is a drawer, so the list bar itself is the readiness signal.
  await boot(page, '/models', async () => {
    await expect(search).toBeVisible({ timeout: 30_000 })
  })
  await search.fill('zen')

  // The placeholder/typed text must actually be legible against what is behind it.
  const contrast = await search.evaluate((el) => {
    const lum = (c: string) => {
      const [r, g, b] = (c.match(/[\d.]+/g) ?? ['0', '0', '0']).slice(0, 3).map(Number)
      const f = (v: number) => {
        const s = v / 255
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
    }
    // Walk up for the first non-transparent background actually painted behind it.
    let node: HTMLElement | null = el as HTMLElement
    let bg = 'rgb(0, 0, 0)'
    while (node) {
      const c = getComputedStyle(node).backgroundColor
      if (c && !c.includes('rgba(0, 0, 0, 0)')) {
        bg = c
        break
      }
      node = node.parentElement
    }
    const fg = getComputedStyle(el as HTMLElement).color
    const a = lum(fg)
    const b = lum(bg)
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
  })
  expect(contrast).toBeGreaterThanOrEqual(4.5)

  // The body must never scroll sideways at 390px.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)

  await page.screenshot({ path: join(SHOTS, 'list-bar-mobile.png') })
  await ctx.close()
})
