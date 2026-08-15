/**
 * The signed-in bar IS the shared chrome, and navigation survives adopting it.
 *
 * This app drew its own top bar for a long time and it drifted from the one
 * hanzo.ai renders — measured before the change: no ground at all against the
 * reference's `rgba(9,9,11,0.72)` over a 20px blur, a hard hairline where the
 * reference draws none, and 56px against 60. None of that is visible at rest on
 * a dark page, which is exactly why it survived: the difference only shows when
 * something scrolls under the bar, and by then nobody is comparing.
 *
 * So the contract is pinned on COMPUTED STYLE. A screenshot cannot tell a
 * transparent bar from a translucent one over a dark ground, and "looks about
 * right" is the judgement that let the two drift in the first place.
 *
 * The second test is the one that matters more. `OrgHeader` composes its own
 * left cluster, so adopting it can only work if the rail keeps its controls —
 * below `lg` the hamburger is the ONLY route to the nav drawer, and a bar that
 * dropped it would leave a phone with no navigation at all while every
 * screenshot still looked correct.
 */
import { test, expect, type Page } from '@playwright/test'
import { primeSession } from './_session'

/** What the shared chrome is made of — @hanzogui/shell's own `GLASS` + geometry. */
const CHROME = {
  height: 60,
  background: 'rgba(9, 9, 11, 0.72)',
  backdropFilter: 'blur(20px) saturate(1.8)',
  // The bar carries no hairline: the reference draws it transparent.
  borderBottom: '1px rgba(0, 0, 0, 0)',
}

const BAR = 'header[data-hanzo-shell]'

const measure = (page: Page) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const c = getComputedStyle(el)
    return {
      height: Math.round(el.getBoundingClientRect().height),
      background: c.backgroundColor,
      backdropFilter:
        c.backdropFilter || (c as unknown as Record<string, string>).webkitBackdropFilter || 'none',
      borderBottom: `${c.borderBottomWidth} ${c.borderBottomColor}`,
    }
  }, BAR)

test('the signed-in bar is the shared chrome at every width', async ({ page }) => {
  await primeSession(page)
  await page.route('**/v1/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"data":[]}' }),
  )
  for (const width of [390, 834, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector(BAR, { timeout: 60_000 })
    const bar = await measure(page)
    console.log(`console@${width} ${JSON.stringify(bar)}`)
    expect(bar, `no shell header at ${width}`).not.toBeNull()
    expect(bar).toEqual(CHROME)
  }
})

test('the rail keeps its own controls in the shared bar', async ({ page }) => {
  await primeSession(page)
  await page.route('**/v1/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"data":[]}' }),
  )

  // Desktop: the collapse toggle rides `headerLeft`, so the rail can still be
  // collapsed to icons from the bar.
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(BAR, { timeout: 60_000 })
  await expect(page.locator(`${BAR} [aria-label*="Collapse sidebar"]`).first()).toBeVisible()

  // Phone: the hamburger is the ONLY way to the nav drawer, and it opens it.
  await page.setViewportSize({ width: 390, height: 900 })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(BAR, { timeout: 60_000 })
  const burger = page.locator(`${BAR} [aria-label="Open navigation"]`).first()
  await expect(burger).toBeVisible()
  await burger.click()
  // `SidebarNav` is ONE component with three mounts (rail, collapsed-rail flyout,
  // phone drawer) and all three stay in the DOM — the offscreen ones are offset,
  // not unmounted. So `.first()` is the desktop rail, which is display:none at
  // 390: the assertion would read "hidden" while the drawer is open and correct.
  // Match on the one that is actually painted.
  await expect(
    page.getByText('All products').locator('visible=true').first(),
  ).toBeVisible({ timeout: 15_000 })
})

/*
 * The 44px coarse-pointer floor is deliberately NOT asserted here. It used to be
 * this app's own CSS rule and is the shell's now, and proving it needs a real
 * touch device — `test.use(devices[…])` forces its own worker and Playwright
 * refuses it inside a describe, so it would cost a second spec file to state one
 * measurement. Measured by hand on Pixel 7 while adopting the bar: the rail's
 * hamburger is 46x44, against 46x36 on a fine pointer, so the shell's rule does
 * fire. Worth re-measuring on the device if that rule ever moves.
 */
