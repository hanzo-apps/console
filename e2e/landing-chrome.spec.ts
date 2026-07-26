/**
 * e2e: the LOGGED-OUT landing chrome — every footer link reachable on a phone, ONE
 * typeface, ONE sign-in.
 *
 * These three came out of a rendered-DOM audit of the live surface, and each is
 * invisible to a unit test because each is a LAYOUT/CASCADE fact of a real browser:
 *
 *   1. The footer's legal links sat PAST the right edge at 390px, on a document that
 *      cannot scroll sideways (`html,body{overflow-x:clip}`) — a legally-required link
 *      that could not be reached. `documentElement.scrollWidth` does NOT reveal that
 *      (clip hides the overflow from the scroll box), so this asserts the geometry
 *      directly: every link's box inside the viewport, hit-testing to the link itself,
 *      and nothing on the page painted past the right edge.
 *   2. The shared `@hanzogui/shell` header sets its own SYSTEM font stack as an inline
 *      style, so the header chrome rendered in the platform face while the page body
 *      rendered Geist. `document.fonts.check()` is WORTHLESS as evidence here (it
 *      answers true on a page with no @font-face at all), so this reads the ACTUAL
 *      rendered fonts out of CDP `CSS.getPlatformFontsForNode` — family, glyph count,
 *      and custom-vs-system — and requires the header to resolve the same face as the
 *      body.
 *   3. The header rendered TWO "Sign in" affordances (the shell's default account link
 *      beside our own primary CTA). Exactly one is the standing requirement.
 *
 * Run: BASE_URL=http://localhost:4000 npx playwright test landing-chrome
 */
import { test, expect, type Locator, type Page, type Route } from '@playwright/test'
import { requireFixtureServer } from './_fixture'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const SHOTS = join(process.cwd(), 'e2e-shots')

// A local render spec — skip cleanly when the target origin isn't up.
requireFixtureServer()

const API_RE = /\/(v1|ai|auth|billing|commerce|telemetry|vm|superbase|admin|paas|integrations)(\/|$|\?)/

/**
 * Anonymous by construction: every API call answers 401, so the session resolves to
 * "no account" at once and `/` mounts the PUBLIC landing (the surface under audit).
 * Nothing off-origin is ever reached.
 */
async function anon(route: Route): Promise<void> {
  const req = route.request()
  if (req.resourceType() === 'document') return route.continue()
  const url = new URL(req.url())
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (!local || API_RE.test(url.pathname)) {
    return route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"anon"}' })
  }
  return route.continue()
}

/** Every footer link, keyed by the href it carries — unambiguous, because the header's
 *  own Docs link points at docs.hanzo.ai, not hanzo.ai/docs. */
const FOOTER_LINKS: ReadonlyArray<readonly [label: string, href: string]> = [
  ['Docs', 'https://hanzo.ai/docs'],
  ['API', 'https://hanzo.ai/docs/api'],
  ['Webhooks', '/webhooks'],
  ['Support', 'https://hanzo.ai/support'],
  ['Privacy', 'https://hanzo.ai/privacy'],
  ['Terms', 'https://hanzo.ai/terms'],
]

type Rendered = { family: string; custom: boolean; glyphs: number }

/** The REAL rendered fonts for the first node matching `selector` (CDP, never a guess). */
async function renderedFont(page: Page, selector: string): Promise<Rendered> {
  const cdp = await page.context().newCDPSession(page)
  try {
    await cdp.send('DOM.enable')
    await cdp.send('CSS.enable')
    const { root } = await cdp.send('DOM.getDocument', { depth: -1 })
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector })
    expect(nodeId, `no node matched ${selector}`).toBeTruthy()
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId })
    expect(fonts.length, `${selector}: CDP reported no rendered font (no text?)`).toBeGreaterThan(0)
    // One text run per node here, so the first entry IS the face it renders in.
    const f = fonts[0]
    return { family: f.familyName, custom: f.isCustomFont, glyphs: f.glyphCount }
  } finally {
    await cdp.detach()
  }
}

/** Mark a node so CDP can address it by selector (for text CDP can't select on). */
async function tag(locator: Locator, name: string): Promise<string> {
  await locator.first().evaluate((el, n) => el.setAttribute('data-probe', n), name)
  return `[data-probe="${name}"]`
}

/** `Geist:1234:custom` — the shape the audit reported, printed for the record. */
const summary = (r: Rendered): string => `${r.family}:${r.glyphs}:${r.custom ? 'custom' : 'SYSTEM'}`

async function landing(page: Page, w: number, h: number): Promise<void> {
  await page.setViewportSize({ width: w, height: h })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  // The hero is the anon landing's mount signal.
  await expect(page.getByRole('heading', { name: 'The AI cloud, one platform' })).toBeVisible({ timeout: 30_000 })
  await page.waitForFunction(() => document.fonts.status === 'loaded', null, { timeout: 15_000 })
}

test.beforeEach(async ({ page }) => {
  await page.route('**/*', anon)
})

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true })
})

test('390x844 — every footer link is inside the viewport and hit-tests to the link', async ({ page }) => {
  await landing(page, 390, 844)

  // The page must never scroll sideways — the fix has to WRAP, not add scroll.
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }))
  console.log(
    `  documentElement scrollWidth=${metrics.scrollWidth} clientWidth=${metrics.clientWidth} body.scrollWidth=${metrics.bodyScrollWidth}`,
  )
  expect(metrics.scrollWidth).toBe(metrics.clientWidth)

  for (const [label, href] of FOOTER_LINKS) {
    const link = page.locator(`a[href="${href}"]`).first()
    await link.scrollIntoViewIfNeeded()
    await expect(link, `${label} link missing`).toBeVisible()
    const box = (await link.boundingBox())!
    console.log(`  ${label.padEnd(9)} x=${Math.round(box.x)}..${Math.round(box.x + box.width)} y=${Math.round(box.y)}`)
    expect(box.x, `${label} starts left of the viewport`).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width, `${label} ends past the 390px viewport`).toBeLessThanOrEqual(390)

    // Reachable, not merely inside: the link must be the topmost box at its own centre.
    const hit = await link.evaluate((el) => {
      const r = el.getBoundingClientRect()
      const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return {
        own: !!t && (t === el || el.contains(t)),
        got: t ? `${t.tagName.toLowerCase()}.${t.getAttribute('class') ?? ''}` : null,
      }
    })
    expect(hit.own, `${label} does not hit-test to itself (topmost was ${hit.got})`).toBe(true)
  }

  // Nothing painted past the right edge — the clipped overflow `scrollWidth` hides.
  const past = await page.evaluate((w) => {
    const out: string[] = []
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const cs = getComputedStyle(el)
      if (cs.position === 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') continue
      const r = el.getBoundingClientRect()
      if (r.width < 1 || r.height < 1) continue
      if (r.right > w + 0.5) {
        out.push(
          `${el.tagName.toLowerCase()}.${el.getAttribute('class') ?? ''} right=${Math.round(r.right)} "${(el.textContent ?? '').trim().slice(0, 40)}"`,
        )
      }
    }
    return out.slice(0, 12)
  }, 390)
  expect(past, 'elements painted past the 390px right edge').toEqual([])

  await page.screenshot({ path: join(SHOTS, 'landing-footer-mobile.png'), fullPage: true })
})

test('the header chrome renders the same Geist face as the page body', async ({ page }) => {
  await landing(page, 1440, 900)

  // The body was already correct and is the control every header node must match.
  const heroSel = 'h1.hz-display'
  const subheadSel = await tag(page.getByText('Models, compute, training'), 'subhead')
  const signInSel = await tag(page.locator('header[data-hanzo-shell]').getByRole('link', { name: 'Sign in', exact: true }), 'cta')

  const probes: ReadonlyArray<readonly [what: string, selector: string]> = [
    ['hero h1 (body control)', heroSel],
    ['body paragraph (control)', subheadSel],
    ['footer Terms link', 'a[href="https://hanzo.ai/terms"]'],
    ['header nav link', 'header[data-hanzo-shell] nav a'],
    ['header Meet Hanzo button', 'header[data-hanzo-shell] button'],
    ['header sign-in CTA', signInSel],
  ]

  const seen: Rendered[] = []
  for (const [what, selector] of probes) {
    const r = await renderedFont(page, selector)
    console.log(`  ${what.padEnd(26)} ${selector} -> ${summary(r)}`)
    // The hard gate: it renders GEIST, not a system face.
    expect(r.family, `${what} renders in ${r.family}`).toMatch(/Geist/)
    // And it resolves EXACTLY the way the body does — no mixed typography, whatever
    // this machine's font situation is (an installed Geist satisfies the @font-face
    // `local()` source, so `custom` is a property of the host, not of the fix).
    expect({ what, family: r.family, custom: r.custom }).toEqual({ what, family: seen[0]?.family ?? r.family, custom: seen[0]?.custom ?? r.custom })
    seen.push(r)
  }
  // The header's computed stack must name Geist (it used to resolve through a stack
  // that omitted it entirely: `ui-sans-serif, system-ui, -apple-system, "Segoe UI"`).
  for (const sel of ['header[data-hanzo-shell]', 'header[data-hanzo-shell] nav a', signInSel]) {
    const stack = await page.locator(sel).first().evaluate((el) => getComputedStyle(el).fontFamily)
    console.log(`  stack ${sel} -> ${stack}`)
    expect(stack, `${sel} font stack omits Geist`).toMatch(/Geist/)
  }

  // At 390 the header collapses to icon controls (no chrome text of its own), so the
  // phone check is the page's own type.
  await landing(page, 390, 844)
  for (const [what, selector] of [['hero h1 (mobile)', heroSel], ['footer Terms (mobile)', 'a[href="https://hanzo.ai/terms"]']] as const) {
    const r = await renderedFont(page, selector)
    console.log(`  ${what.padEnd(26)} ${selector} -> ${summary(r)}`)
    expect(r.family).toMatch(/Geist/)
  }
})

test('1440x900 — exactly ONE sign-in affordance in the header, and it is the primary', async ({ page }) => {
  await landing(page, 1440, 900)
  const header = page.locator('header[data-hanzo-shell]')
  const signIn = header.getByRole('link', { name: 'Sign in', exact: true })
  await expect(signIn).toHaveCount(1)

  // The one that survives is the filled primary, not the plain text link.
  const bg = await signIn.evaluate((el) => getComputedStyle(el).backgroundColor)
  console.log(`  the one sign-in: background=${bg}`)
  expect(bg).not.toBe('rgba(0, 0, 0, 0)')
  expect(bg).not.toBe('transparent')

  await page.screenshot({ path: join(SHOTS, 'landing-header-desktop.png') })

  // Mobile collapses to the disclosure button — no duplicate there either.
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(header.getByRole('button', { name: 'Open menu' })).toBeVisible()
  await expect(header.getByRole('link', { name: 'Sign in', exact: true })).toHaveCount(0)
})
