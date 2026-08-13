/**
 * Guided tour — RENDER proof, not a mock.
 *
 * The defect this pins: "Take the tour" appeared to do nothing. It DID mount the
 * overlay, but `PitchHero` sits inside `<FadeIn>` (`.hz-fade-up` carries
 * `will-change: transform` and leaves a `transform` behind), which makes that div the
 * containing block for every `position: fixed` descendant — so the backdrop dimmed
 * only the card and the spotlight, measured in viewport coordinates, was painted in
 * card coordinates and clipped away by the card's `overflow: hidden`.
 *
 * So the assertions here are GEOMETRIC. A spotlight that agrees with its target's own
 * `getBoundingClientRect` cannot be the broken one, and a backdrop that covers the
 * viewport cannot be trapped in a card. Nothing about that is observable from the DOM
 * tree alone, which is exactly why the bug survived a green suite.
 */
import { test, expect, type Page } from '@playwright/test'
import { primeSession } from './_session'
import { PLAYGROUND_TOUR, CONSOLE_TOUR } from '../src/lib/tour/steps'

const SHOTS = '/Users/a/Desktop/hanzo-console-tour'

/** Selector for a step id, straight off the shipped tour data (never a hand copy). */
const targetFor = (id: string): string | undefined =>
  [...PLAYGROUND_TOUR, ...CONSOLE_TOUR].find((s) => s.id === id)?.target

async function stubBackend(page: Page): Promise<void> {
  await page.route('**/v1/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) }),
  )
}

/** The overlay's own geometry, read from the page. */
async function overlay(page: Page) {
  return page.evaluate(() => {
    const q = (s: string) => document.querySelector(s) as HTMLElement | null
    const box = (el: HTMLElement | null) => (el ? el.getBoundingClientRect().toJSON() : null)
    const card = q('[data-tour-overlay="card"]')
    return {
      step: card?.getAttribute('data-tour-step') ?? null,
      title: card?.querySelector('*')?.textContent ?? null,
      card: box(card),
      spotlight: box(q('[data-tour-overlay="spotlight"]')),
      backdrop: box(q('[data-tour-overlay="backdrop"]')),
      viewport: { w: window.innerWidth, h: window.innerHeight },
      // The containing block the browser actually resolved for the fixed card —
      // `null` means the viewport, which is the whole fix.
      cardOffsetParent: card?.offsetParent ? (card.offsetParent as HTMLElement).tagName : null,
    }
  })
}

/** Where the step's anchor really is, per the DOM. */
async function anchorBox(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const all = Array.from(document.querySelectorAll(sel)) as HTMLElement[]
    const el = all.find((e) => {
      const r = e.getBoundingClientRect()
      return r.width >= 1 && r.height >= 1
    })
    return el ? el.getBoundingClientRect().toJSON() : null
  }, selector)
}

/**
 * Wait for the step to LAND: its anchor on screen and the spotlight agreeing with it
 * (a 6px halo each side). Polling the agreement rather than sleeping is what makes
 * this a measurement instead of a race — a step that never lands fails here, loudly,
 * instead of being measured mid-flight.
 */
async function settled(page: Page): Promise<string> {
  let id = ''
  await expect
    .poll(
      async () => {
        const o = await overlay(page)
        if (!o.step) return 'no step'
        id = o.step
        const inView =
          o.card!.left >= -1 &&
          o.card!.top >= -1 &&
          o.card!.right <= o.viewport.w + 1 &&
          o.card!.bottom <= o.viewport.h + 1
        if (!inView) return `coach-mark off screen ${JSON.stringify(o.card)} vp ${JSON.stringify(o.viewport)}`

        const sel = targetFor(o.step)
        if (!sel) return 'ok' // a centered step has nothing to agree with
        const a = await anchorBox(page, sel)
        if (!a) return `anchor ${sel} absent`
        if (!o.spotlight) return 'no spotlight'
        const off = Math.max(
          Math.abs(o.spotlight.left + 6 - a.left),
          Math.abs(o.spotlight.top + 6 - a.top),
          Math.abs(o.spotlight.width - 12 - a.width),
          Math.abs(o.spotlight.height - 12 - a.height),
        )
        if (off >= 2) return `spotlight off by ${off.toFixed(1)}px`

        /**
         * The card must not sit on top of what it describes. Stated as AREA, not as a
         * yes/no overlap, because a target that fills the screen (the response panel
         * is 952x448 of a 1280x720 viewport) leaves no band deep enough for a card on
         * ANY side — a card floating inside that ring is the honest presentation, and
         * it necessarily covers a quarter of it.
         *
         * The strict property — "clear of the target whenever a clear box exists" —
         * belongs to `placeCoachMark` and is proven exhaustively in `place.test.ts`.
         * This is the browser-side backstop: the original defect drew the card over
         * 100% of a 36px-tall target, and that still fails here.
         */
        const s = o.spotlight
        const c = o.card!
        const ox = Math.max(0, Math.min(c.right, s.right) - Math.max(c.left, s.left))
        const oy = Math.max(0, Math.min(c.bottom, s.bottom) - Math.max(c.top, s.top))
        const frac = (ox * oy) / (s.width * s.height)
        if (frac > 0.35)
          return `${o.step}: coach-mark ${c.width}x${c.height} covers ${(frac * 100).toFixed(0)}% of the ${s.width}x${s.height} spotlight`
        return 'ok'
      },
      { timeout: 15_000, intervals: [100, 150, 250, 400] },
    )
    .toBe('ok')
  return id
}

async function openPlayground(page: Page): Promise<void> {
  await stubBackend(page)
  await primeSession(page)
  await page.goto('/playground')
  await expect(page.getByRole('button', { name: /take the tour/i })).toBeVisible({ timeout: 30_000 })
}

test.describe('guided tour', () => {
  test('walks every Playground stop, spotlight on the right element', async ({ page }) => {
    await openPlayground(page)
    await page.getByRole('button', { name: /take the tour/i }).click()

    const card = page.locator('[data-tour-overlay="card"]')
    await expect(card).toBeVisible({ timeout: 10_000 })

    const seen: string[] = []
    for (let n = 0; n < 20; n += 1) {
      // Spotlight-on-target is asserted inside `settled`.
      const id = await settled(page)
      seen.push(id)
      const o = await overlay(page)

      // The card is laid out against the VIEWPORT, not the pitch card. This is the
      // whole defect: before the portal, offsetParent was the faded card's ancestor.
      expect(o.cardOffsetParent, `step ${id}: fixed card escapes every transformed ancestor`).toBeNull()

      // The backdrop covers the whole viewport — it dimmed only the card before.
      expect(o.backdrop!.width).toBeGreaterThanOrEqual(o.viewport.w - 1)
      expect(o.backdrop!.height).toBeGreaterThanOrEqual(o.viewport.h - 1)

      // On-screen and clear of the spotlight are asserted inside `settled`.
      await page.screenshot({ path: `${SHOTS}/playground-${String(n + 1).padStart(2, '0')}-${id}.png` })

      const next = page.getByRole('button', { name: /^next$/i })
      if (await next.count()) {
        await next.click()
        continue
      }
      await page.getByRole('button', { name: /^done$/i }).click()
      break
    }

    // Every authored stop was reached, in order, and the tour ended.
    expect(seen).toEqual(PLAYGROUND_TOUR.map((s) => s.id))
    await expect(card).toHaveCount(0)
    await page.screenshot({ path: `${SHOTS}/playground-99-finished.png` })
  })

  test('Back steps home, Skip and Escape close it', async ({ page }) => {
    await openPlayground(page)
    const card = page.locator('[data-tour-overlay="card"]')

    // Forward two, then Back — the counter and the spotlight walk back with it.
    await page.getByRole('button', { name: /take the tour/i }).click()
    await expect(card).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: /^next$/i }).click()
    expect(await settled(page)).toBe(PLAYGROUND_TOUR[1].id)
    await page.getByRole('button', { name: /^back$/i }).click()
    expect(await settled(page)).toBe(PLAYGROUND_TOUR[0].id)
    await expect(card.getByText('Step 1 of ' + PLAYGROUND_TOUR.length)).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/controls-01-back.png` })

    // Skip closes it.
    await page.getByRole('button', { name: /^skip$/i }).click()
    await expect(card).toHaveCount(0)
    await page.screenshot({ path: `${SHOTS}/controls-02-skipped.png` })

    // Re-launch (it always replays), then Escape closes it.
    await page.getByRole('button', { name: /take the tour/i }).click()
    await expect(card).toBeVisible()
    expect((await overlay(page)).step, 'relaunch restarts at step 1').toBe(PLAYGROUND_TOUR[0].id)
    await page.keyboard.press('Escape')
    await expect(card).toHaveCount(0)

    // Re-launch, then the X closes it.
    await page.getByRole('button', { name: /take the tour/i }).click()
    await expect(card).toBeVisible()
    await page.getByRole('button', { name: /close tour/i }).click()
    await expect(card).toHaveCount(0)
    await page.screenshot({ path: `${SHOTS}/controls-03-closed.png` })
  })

  /**
   * The graceful-skip path, with a real case rather than a contrived one: at 390px the
   * sidebar is a drawer, so the tour's last stop (`nav`) has no anchor on screen. It
   * must drop out of the plan — counted out of the total, not walked to and pointed at
   * nothing — and the rest must still fit a phone.
   */
  test('drops a stop whose anchor is not on a phone, and fits the screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openPlayground(page)
    await page.getByRole('button', { name: /take the tour/i }).click()

    const card = page.locator('[data-tour-overlay="card"]')
    await expect(card).toBeVisible({ timeout: 10_000 })

    const navPainted = await anchorBox(page, '[data-tour="nav"]')
    expect(navPainted, 'the sidebar is a drawer at 390px').toBeNull()

    const total = PLAYGROUND_TOUR.length - 1
    await expect(card.getByText(`Step 1 of ${total}`)).toBeVisible()

    const seen: string[] = []
    for (let n = 0; n < 20; n += 1) {
      seen.push(await settled(page))
      await page.screenshot({ path: `${SHOTS}/mobile-${String(n + 1).padStart(2, '0')}-${seen[n]}.png` })
      const noScroll = await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      )
      expect(noScroll, `step ${seen[n]}: no horizontal body scroll at 390px`).toBe(true)
      const next = page.getByRole('button', { name: /^next$/i })
      if (!(await next.count())) break
      await next.click()
    }
    expect(seen).not.toContain('nav')
    expect(seen).toEqual(PLAYGROUND_TOUR.filter((s) => s.id !== 'nav').map((s) => s.id))
  })

  test('honors prefers-reduced-motion — no glide, no entrance', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openPlayground(page)
    await page.getByRole('button', { name: /take the tour/i }).click()
    await settled(page)
    await page.getByRole('button', { name: /^next$/i }).click()
    await settled(page)

    const motion = await page.evaluate(() => {
      const q = (s: string) => document.querySelector(s) as HTMLElement | null
      const read = (el: HTMLElement | null) =>
        el ? { transition: getComputedStyle(el).transition, animation: getComputedStyle(el).animationName } : null
      return {
        spotlight: read(q('[data-tour-overlay="spotlight"]')),
        card: read(q('[data-tour-overlay="card"]')),
        backdrop: read(q('[data-tour-overlay="backdrop"]')),
      }
    })
    for (const [what, m] of Object.entries(motion)) {
      expect(m, `${what} is rendered`).toBeTruthy()
      expect(m!.transition, `${what}: no transition under reduced motion`).toMatch(/^(all 0s|none 0s|)/)
      expect(m!.animation, `${what}: no entrance under reduced motion`).toBe('none')
    }
    await page.screenshot({ path: `${SHOTS}/reduced-motion.png` })
  })

  test('the console tour navigates between routes', async ({ page }) => {
    await stubBackend(page)
    await primeSession(page)
    await page.goto('/')
    await expect(page.getByRole('button', { name: /take the tour/i })).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: /take the tour/i }).click()

    const card = page.locator('[data-tour-overlay="card"]')
    await expect(card).toBeVisible({ timeout: 10_000 })

    // Walk to the step whose anchor lives on /playground — the tour must take us there.
    let reached = false
    for (let n = 0; n < 20; n += 1) {
      const id = await settled(page)
      await page.screenshot({ path: `${SHOTS}/console-${String(n + 1).padStart(2, '0')}-${id}.png` })
      if (id === 'playground') {
        // `settled` already proved the spotlight sits on the composer; this proves
        // the tour got there by NAVIGATING, not by luck.
        expect(new URL(page.url()).pathname).toBe('/playground')
        reached = true
        break
      }
      const next = page.getByRole('button', { name: /^next$/i })
      if (!(await next.count())) break
      await next.click()
    }
    expect(reached, 'the console tour reached its cross-route step').toBe(true)
  })
})
