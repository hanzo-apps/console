/**
 * The design gate — the invariants of the shell, asserted on COMPUTED STYLE and
 * GEOMETRY in a real browser.
 *
 * This spec is the deliverable, not the screenshots. Every rule below was a real
 * defect measured on the running console, and a rule that only lives in a review
 * comes back. A status code proves a server answered; this proves a human can
 * read the page.
 *
 * WHAT IT PINS
 *  1. No all-caps, anywhere — neither `text-transform: uppercase` nor a string
 *     TYPED in caps. This is the hard rule and the whole reason the file exists.
 *  2. ONE type scale, ONE radius scale, ONE spacing ramp — asserted as
 *     membership, so a new value cannot be introduced without deciding to.
 *  3. Every stacking layer resolves to the ladder in app/design/z.css, never a
 *     literal. The console had drifted to 9999 / 100000 / 100001 / 100002.
 *  4. The overlays actually paint: opaque background, on-screen box. Two of
 *     tonight's bugs were a control that rendered identically in both states and
 *     a footer that ate clicks while returning 200.
 *  5. Contrast is computed from the colours that actually painted.
 *  6. The body never scrolls sideways, at 1440 or at 390.
 *
 * KNOWN EXEMPTIONS, each deliberate and narrow:
 *  - Acronyms (`API`, `GPU`, `CIDR`, …) are not shouting; the allow-list is
 *    explicit so a new one is a decision, not an accident.
 *  - An avatar/brand MONOGRAM scales with its circle — it is a graphic, not app
 *    text — so text-size membership skips it. Marking it takes BOTH a
 *    `[data-monogram]` ancestor AND text of at most three characters, so a marker
 *    placed around a whole distributed component (the only place it CAN go, since
 *    @hanzo/ui paints the org mark itself) still cannot exempt that component's
 *    labels — only its glyph.
 *  - Tamagui's `circular` variant compiles to a 100000px radius; that is the
 *    same concept as our pill token, so both count as "pill".
 *  - Next's dev overlay injects its own chrome; specs run against the app root.
 *  - An `aria-hidden` subtree is not content. A CLOSED drawer parks off screen by
 *    design — the nav drawer at x = -320, the account drawer at x = 390 — which is
 *    how a slide-over animates, not a clip.
 *  - The ladder governs where OUR chrome sits. A library ordering its own
 *    internals is its business: @hanzo/gui's Dialog puts its overlay at 1 and its
 *    content at 2 INSIDE its portal, so the rule applies above 10. And the Gui
 *    portal HOST itself is pinned to a hardcoded 105001 that no console config can
 *    reach — REPORTED as a library finding, excluded here by its own class marker
 *    rather than by raising the ceiling and quietly letting our literals back in.
 */
import { test, expect } from '@playwright/test'


// The gate itself is in `./_gate` — one definition, so `scorecard.spec.ts` can
// run these same rules over every route without a second copy of them.
import { audit, open, type Audit } from './_gate'

const dedupe = <T,>(xs: T[]): T[] => Array.from(new Set(xs.map((x) => JSON.stringify(x)))).map((s) => JSON.parse(s) as T)

// The shell's real states. Level 1 is the rail + home; drilled is the second-level
// nav; settings is the panel-of-rows surface; the palette is the top overlay.
const STATES: [name: string, path: string][] = [
  ['level 1', '/'],
  ['drilled', '/agents'],
  ['settings panels', '/agents/settings'],
]

for (const [name, path] of STATES) {
  test(`${name} — no caps, one scale, one ladder`, async ({ page }) => {
    await open(page, path)
    const a = await audit(page)

    // THE HARD RULE. No exceptions, no text-transform, no typed caps.
    expect(dedupe(a.capsComputed), 'text-transform: uppercase').toEqual([])
    expect(dedupe(a.capsTyped), 'strings typed in caps').toEqual([])

    // ONE of each scale.
    expect(dedupe(a.offType), 'font-size off the type scale').toEqual([])
    expect(dedupe(a.offRadius), 'border-radius off the radius scale').toEqual([])
    expect(dedupe(a.offSpace), 'padding off the 4px ramp').toEqual([])
    expect(dedupe(a.offZ), 'z-index not from the --z-* ladder').toEqual([])

    // Readable, on the black canvas the brief asks for.
    expect(a.bodyBg).toBe('rgb(0, 0, 0)')
    expect(dedupe(a.lowContrast), 'text below WCAG AA against its painted background').toEqual([])
    expect(a.hScroll, 'the body must never scroll sideways').toBe(false)
  })
}

test('the command palette paints, is on screen, and shouts at nobody', async ({ page }) => {
  await open(page, '/')
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k')
  await page.waitForTimeout(1200)

  // It must actually PAINT — a transparent, unstacked overlay is the library
  // failure mode this repo has already been bitten by twice.
  const box = await page.evaluate(() => {
    // Several dialogs live in the DOM at rest — the nav drawer is parked OFF
    // screen at x = -320 — so pick the one that is actually on screen.
    const el = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).find((d) => {
      const r = d.getBoundingClientRect()
      return r.width > 240 && r.height > 40 && r.left >= 0 && r.right <= innerWidth + 1 &&
        getComputedStyle(d).visibility !== 'hidden' && getComputedStyle(d).display !== 'none'
    }) ?? null
    if (!el) return null
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    const bg = (() => {
      for (let e: Element | null = el; e; e = e.parentElement) {
        const b = getComputedStyle(e).backgroundColor
        if (b && !/rgba\(0, 0, 0, 0\)|transparent/.test(b)) return b
      }
      return 'rgba(0, 0, 0, 0)'
    })()
    return { bg, z: cs.zIndex, x: r.x, y: r.y, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight }
  })
  expect(box, 'the palette did not open').not.toBeNull()
  expect(box!.bg, 'the palette rendered transparent').not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/)
  expect(box!.w).toBeGreaterThan(240)
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.w).toBeLessThanOrEqual(box!.vw + 1)

  const a = await audit(page)
  expect(dedupe(a.capsComputed)).toEqual([])
  expect(dedupe(a.capsTyped)).toEqual([])
  expect(dedupe(a.offZ), 'the palette must sit on the ladder').toEqual([])
})

test('the rail is keyboard-reachable and a collapsed section is out of the tab order', async ({ page }) => {
  await open(page, '/')
  const reach = await page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="Products"]') as HTMLElement | null
    if (!nav) return null
    const focusable = Array.from(nav.querySelectorAll<HTMLElement>('button, a[href], [tabindex]:not([tabindex="-1"])'))
      .filter((el) => el.offsetParent !== null)
    // Rows inside a collapsed accordion are `inert` — present, but not tabbable.
    const inertRows = Array.from(nav.querySelectorAll('.hz-acc[data-open="false"] button')).length
    const inertTabbable = Array.from(nav.querySelectorAll<HTMLElement>('.hz-acc[data-open="false"] button'))
      .filter((el) => el.offsetParent !== null && !el.closest('[inert]')).length
    // Every reachable row must be inside the viewport — a control tab lands on
    // but cannot be seen is the same defect as one that cannot be reached.
    const offscreen = focusable.filter((el) => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && (r.right < 0 || r.left > innerWidth || r.bottom < 0)
    }).length
    return { count: focusable.length, offscreen, inertRows, inertTabbable }
  })
  expect(reach, 'no rail found').not.toBeNull()
  expect(reach!.count, 'the rail has no keyboard-reachable rows').toBeGreaterThan(3)
  expect(reach!.offscreen, 'a rail row is focusable but painted off screen').toBe(0)
  expect(reach!.inertTabbable, 'a collapsed section leaked rows into the tab order').toBe(0)
})

test('nothing scrolls sideways on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await open(page, '/')
  const a = await audit(page)
  expect(a.hScroll).toBe(false)
  expect(dedupe(a.capsComputed)).toEqual([])
  expect(dedupe(a.capsTyped)).toEqual([])
  // Painted past the right edge is only a defect when nothing can scroll to it.
  // Wide content (a DataTable, a code block) is REQUIRED to scroll inside its own
  // container, and DataTable already does — that is correct, not a clip.
  const overflow = await page.evaluate(() => {
    const scrollable = (el: Element) => {
      for (let e: Element | null = el.parentElement; e; e = e.parentElement) {
        const ox = getComputedStyle(e).overflowX
        if (ox === 'auto' || ox === 'scroll') return true
      }
      return false
    }
    return Array.from(document.querySelectorAll('body *'))
      .filter((el) => {
        if (el.closest('[aria-hidden="true"]')) return false
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.right > innerWidth + 1 && !scrollable(el)
      })
      .slice(0, 6)
      .map((el) => (el.textContent || el.tagName).trim().slice(0, 44))
  })
  expect(overflow, 'clipped past the right edge with nothing to scroll it').toEqual([])
})
