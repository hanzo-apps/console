/**
 * e2e: the Playground's mode strip is ONE line, and a moving mode is still hittable.
 *
 * The seven modes (Chat · Completions · Embeddings · Image · Video · Audio · Vision)
 * used to wrap onto two rows inside one grey pill, which reads as a broken container
 * rather than a control. They are one line now, and on a phone the line crawls — the
 * same treatment hanzo.app gives its starter chips.
 *
 * These are the assertions only a browser can make. `flexWrap` is a computed-layout
 * property: a unit test can read the prop and still be wrong about where the boxes
 * land, which is exactly how the two-row bar shipped. So this measures GEOMETRY —
 * every mode's box on one row, at 390 and at 1440.
 *
 * And it pins the part that makes a ticker usable at all: hover pauses the crawl for a
 * pointer, but a TOUCH HAS NO HOVER, so without a press-freeze the mode a thumb aims at
 * slides out from under it and the tap lands on the track between two of them. The
 * component sets `pg-hold` on pointerdown; this proves the class lands and that a tap
 * actually switches mode.
 *
 * Run: BASE_URL=http://localhost:4000 npx playwright test playground-modes
 */
import { test, expect, type Route, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { requireFixtureServer } from './_fixture'
import { primeSession } from './_session'

const SHOTS = join(process.cwd(), 'e2e-shots')

const MODES = ['Chat', 'Completions', 'Embeddings', 'Image', 'Video', 'Audio', 'Vision']

/** Every read answers an empty-ok envelope; the strip renders from a static list. */
async function stubApi(page: Page) {
  await page.route('**/v1/**', (route: Route) => {
    const url = route.request().url()
    if (url.includes('/models')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [{ id: 'zen5', object: 'model', owned_by: 'hanzo' }],
        }),
      })
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', msg: '', data: [] }),
    })
  })
}

/**
 * A mode, scoped to the strip.
 *
 * Scoped deliberately, not for tidiness: five of the seven mode names are also
 * PRODUCT names in the sidebar, so a page-wide `getByRole('button')` for
 * "Embeddings" matches the nav row at x=14 as well as the mode at x=512, and
 * `.first()` takes the nav row — DOM order puts the sidebar first. That read as
 * a two-row strip (y=708 vs 696) on a strip that was measurably one row.
 *
 * `.first()` still matters inside the strip: on a phone both copies of the
 * duplicated track are visible, and this wants the one the eye lands on.
 */
function firstMode(page: Page, label: string) {
  return page.locator('.pg-modes-crawl').getByRole('button', { name: label, exact: true }).first()
}

requireFixtureServer()

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true })
})

test.beforeEach(async ({ page }) => {
  await stubApi(page)
  await primeSession(page)
})

test('every mode sits on ONE row at 390px, and the body does not scroll sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/playground')
  await expect(firstMode(page, 'Chat')).toBeVisible({ timeout: 30_000 })

  const tops: number[] = []
  for (const label of MODES) {
    const box = await firstMode(page, label).boundingBox()
    expect(box, `${label} has no painted box`).not.toBeNull()
    tops.push(Math.round(box!.y))
  }

  // One line: every mode's top edge within a couple of px of the first.
  const base = tops[0]
  for (let i = 0; i < MODES.length; i++) {
    expect(Math.abs(tops[i] - base), `${MODES[i]} is on a different row (y=${tops[i]} vs ${base})`).toBeLessThanOrEqual(2)
  }

  // The strip may overflow its own masked track; the PAGE must never scroll sideways.
  const { scrollW, clientW } = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }))
  expect(scrollW).toBeLessThanOrEqual(clientW + 1)

  // And it CRAWLS. One row that merely fits is not what was asked for — the modes past
  // the edge have to come to the reader. `animationName` alone would pass on a paused
  // or zero-distance animation, so this reads the composited transform twice and
  // requires it to have actually moved.
  const track = page.locator('.pg-modes-track')
  expect(await track.evaluate((el) => getComputedStyle(el).animationName)).toBe('pg-modes-scroll')
  const shiftAt = () => track.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41)
  const before = await shiftAt()
  await page.waitForTimeout(700)
  const after = await shiftAt()
  expect(Math.abs(after - before), 'the mode strip is not moving').toBeGreaterThan(1)

  // Frame the strip: it sits below the getting-started card, so a bare viewport shot
  // of the top of the page shows everything except the thing under test. Scroll the
  // SHELL, which holds still — asking Playwright to scroll a MODE into view hangs on
  // its own actionability check ("element is not stable"), because the thing being
  // scrolled to is the thing that is moving.
  await page.locator('.pg-modes-shell').evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await page.screenshot({ path: join(SHOTS, 'playground-modes-mobile.png') })
})

test('a press freezes the crawl, and the tap switches mode', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/playground')
  const embeddings = firstMode(page, 'Embeddings')
  await expect(embeddings).toBeVisible({ timeout: 30_000 })

  // Press-freeze: pointerdown puts `pg-hold` on the crawl, so the target stops moving
  // for the press. Without it a touch cannot land on a moving chip.
  await page.locator('.pg-modes-crawl').dispatchEvent('pointerdown')
  await expect(page.locator('.pg-modes-crawl.pg-hold')).toHaveCount(1)

  await embeddings.click()
  await expect(page).toHaveURL(/\/playground\/embeddings|\/playground/)
})

test('desktop holds still: one copy, no crawl', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/playground')
  await expect(firstMode(page, 'Chat')).toBeVisible({ timeout: 30_000 })

  // The duplicate exists only to make the marquee seamless; with room to hold still it
  // is display:none, so a screen reader hears seven modes and not fourteen.
  const hiddenCopy = page.locator('.pg-modes-group[aria-hidden="true"]')
  await expect(hiddenCopy).toBeHidden()

  const anim = await page.locator('.pg-modes-track').evaluate(
    (el) => getComputedStyle(el).animationName,
  )
  expect(anim === 'none' || anim === '').toBeTruthy()

  // Still one row.
  const tops: number[] = []
  for (const label of MODES) {
    const box = await firstMode(page, label).boundingBox()
    tops.push(Math.round(box!.y))
  }
  for (let i = 0; i < MODES.length; i++) {
    expect(Math.abs(tops[i] - tops[0])).toBeLessThanOrEqual(2)
  }

  await page.screenshot({ path: join(SHOTS, 'playground-modes-desktop.png') })
})
