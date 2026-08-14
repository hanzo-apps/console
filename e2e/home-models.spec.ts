/**
 * The home's models widget, rendered.
 *
 * The bug this exists to catch is invisible to a unit test and to a reviewer: a
 * `flex` on a content stack makes it contribute nothing to its parent's intrinsic
 * height under React Native Web, so the card measures short and `overflow: hidden`
 * clips the text mid-sentence — silently, identically at every width, and only in
 * a browser. So the assertion is geometric: each card's text must fit inside the
 * card that contains it.
 */
import { test, expect } from '@playwright/test'

import { primeSession } from './_session'

const WIDTHS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 1024, height: 1366 },
  { name: 'laptop', width: 1440, height: 900 },
  { name: 'desktop', width: 1920, height: 1080 },
]

for (const v of WIDTHS) {
  test(`models widget at ${v.name} (${v.width})`, async ({ page }) => {
    await page.setViewportSize({ width: v.width, height: v.height })
    await primeSession(page)
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    const section = page.getByTestId('models-section')
    await expect(section).toBeVisible({ timeout: 60_000 })
    await section.scrollIntoViewIfNeeded()

    // Two houses and a door — the lineup, not a catalog.
    for (const name of ['Enso', 'Zen', 'Every other family']) {
      await expect(section.getByText(name, { exact: true }).first()).toBeVisible()
    }

    // Nothing is clipped: every card's own text sits inside its card's box. A
    // short card still "renders" the text in the DOM, so only geometry can tell.
    const clipped = await section.evaluate((root) => {
      const bad: string[] = []
      for (const card of Array.from(root.querySelectorAll('[aria-label]'))) {
        const box = card.getBoundingClientRect()
        for (const child of Array.from(card.querySelectorAll('*'))) {
          const c = child.getBoundingClientRect()
          if (!c.height || !child.textContent?.trim()) continue
          if (c.bottom > box.bottom + 1) {
            bad.push(`${card.getAttribute('aria-label')}: "${child.textContent.trim().slice(0, 40)}"`)
            break
          }
        }
      }
      return bad
    })
    expect(clipped, 'card content overflows its card').toEqual([])

    // A widget that pushes the page sideways is wrong whatever it looks like.
    const scrolls = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(scrolls, `the body scrolls sideways at ${v.width}px`).toBe(false)
  })
}
