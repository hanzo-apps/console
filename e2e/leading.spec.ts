/**
 * e2e: LEADING — no rendered text may have a line-height smaller than its font-size.
 *
 * This exists because of a trap that is invisible to every unit test and to every
 * type-check: react-native-web's style compiler appends `px` to a numeric style value
 * unless the property is on its unitless allow-list — and `lineHeight` is NOT on it
 * (`react-native-web/dist/exports/StyleSheet/compiler/unitlessNumbers.js`). React DOM's
 * own allow-list DOES include `lineHeight`, so `style={{ lineHeight: 1.12 }}` is a
 * correct, idiomatic RATIO in plain React and silently becomes the absurd
 * `line-height: 1.12px` under @hanzo/gui (Tamagui/RNW).
 *
 * The failure mode is not subtle once rendered: the line box collapses to ~1px, the
 * heading's descenders fall into whatever sits beneath it, and the element above is
 * clipped. It shipped on every product landing (the guide PitchHero headline).
 *
 * So this asserts the INVARIANT rather than the one call site — every visible text node
 * on the surface must have `line-height >= font-size` — which catches the next numeric
 * lineHeight anyone writes, anywhere, without them having to know about RNW's list.
 *
 * Run: BASE_URL=http://localhost:4000 npx playwright test leading
 */
import { test, expect, type Page, type Route } from '@playwright/test'
import { requireFixtureServer } from './_fixture'
import { primeSession } from './_session'

requireFixtureServer()

const API_RE = /\/(v1|cloud|ai|auth|billing|commerce|telemetry|vm|superbase|admin|integrations)(\/|$|\?)/

/** Everything the shell asks for answers an empty-ok envelope — this spec measures TYPE, not data. */
async function stub(route: Route) {
  const req = route.request()
  if (req.resourceType() === 'document') return route.continue()
  if (!API_RE.test(new URL(req.url()).pathname)) return route.continue()
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"items":[],"data":[]}' })
}

/** Every visible text node whose computed line-height is smaller than its own font-size. */
async function collapsedLines(page: Page) {
  return page.evaluate(() => {
    const bad: { text: string; fontSize: string; lineHeight: string; height: number }[] = []
    document.querySelectorAll('*').forEach((el) => {
      if (el.children.length) return
      const text = (el as HTMLElement).innerText?.trim()
      if (!text) return
      const cs = getComputedStyle(el)
      const size = parseFloat(cs.fontSize)
      const lead = parseFloat(cs.lineHeight) // `normal` → NaN, which is never a defect
      if (!Number.isFinite(lead) || !Number.isFinite(size) || lead >= size) return
      bad.push({
        text: text.slice(0, 60),
        fontSize: cs.fontSize,
        lineHeight: cs.lineHeight,
        height: Math.round(el.getBoundingClientRect().height),
      })
    })
    return bad
  })
}

for (const path of ['/models', '/agents', '/playground']) {
  test(`no collapsed line box on ${path}`, async ({ page }) => {
    await page.route('**/*', stub)
    await primeSession(page)
    await page.goto(path, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2500)
    expect(await collapsedLines(page)).toEqual([])
  })
}

test('the product guide headline leads its own subhead', async ({ page }) => {
  await page.route('**/*', stub)
  await primeSession(page)
  await page.goto('/models', { waitUntil: 'domcontentloaded' })
  const guide = page.getByTestId('product-guide')
  await expect(guide).toBeVisible({ timeout: 20_000 })

  const box = await guide.evaluate((g) => {
    const texts = [...g.querySelectorAll('*')].filter(
      (e) => !e.children.length && (e as HTMLElement).innerText?.trim(),
    ) as HTMLElement[]
    const headline = texts.reduce((a, b) =>
      parseFloat(getComputedStyle(b).fontSize) > parseFloat(getComputedStyle(a).fontSize) ? b : a,
    )
    const cs = getComputedStyle(headline)
    return {
      fontSize: parseFloat(cs.fontSize),
      lineHeight: parseFloat(cs.lineHeight),
      height: headline.getBoundingClientRect().height,
    }
  })

  // A display headline leads between 1.0 and 1.5 — and its box is at least one line tall.
  expect(box.lineHeight).toBeGreaterThanOrEqual(box.fontSize)
  expect(box.lineHeight).toBeLessThanOrEqual(box.fontSize * 1.5)
  expect(box.height).toBeGreaterThanOrEqual(box.fontSize)
})
