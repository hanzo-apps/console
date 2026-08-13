import { test, expect } from '@playwright/test'
import { primeSession } from './_session'

// The home at every width a customer actually uses. The assertion that matters is
// GEOMETRY, not visibility: this app clips (html,body{overflow-x:clip}), so an
// element painted past the right edge leaves scrollWidth === clientWidth and is
// simply unreachable — invisible to a scroll check and to every unit test.
const SIZES = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 834, height: 1112 },
  { name: 'laptop', width: 1280, height: 800 },
  { name: 'desktop', width: 1920, height: 1080 },
]

for (const s of SIZES) {
  test(`home renders at ${s.name} (${s.width})`, async ({ page }) => {
    await primeSession(page)
    await page.route('**/v1/**', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '{"data":[]}' }),
    )
    await page.setViewportSize({ width: s.width, height: s.height })
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    // Anchor on a string only the board carries: a bare "Models" also matches the
    // sidebar's nav row, which is off-canvas (and hidden) in the closed mobile drawer.
    await expect(page.getByText('Token volume', { exact: true })).toBeVisible({ timeout: 60_000 })

    // The body never scrolls sideways.
    const scroll = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
    }))
    expect(scroll.sw).toBeLessThanOrEqual(scroll.cw)

    // Nothing is painted past the right edge (the clip makes this invisible above).
    const overflowing = await page.evaluate((w) => {
      const bad: string[] = []
      document.querySelectorAll('body *').forEach((el) => {
        const r = el.getBoundingClientRect()
        // An element parked ENTIRELY off-canvas (a closed drawer, the docked
        // assistant column) is positioned there on purpose. Real overflow starts
        // INSIDE the viewport and runs past the edge — that is what strands content.
        if (r.width > 0 && r.height > 0 && r.left < w - 1 && r.right > w + 1) {
          bad.push(`${el.tagName}.${(el.className || '').toString().slice(0, 24)} right=${Math.round(r.right)}`)
        }
      })
      return bad.slice(0, 5)
    }, s.width)
    expect(overflowing, `painted past the right edge at ${s.width}px`).toEqual([])

    await page.screenshot({ path: `e2e-shots/home-${s.name}.png`, fullPage: true })
  })
}
