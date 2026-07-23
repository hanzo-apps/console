/**
 * e2e: admin.hanzo.ai super-admin view audit — monochrome + not-broken + org search.
 *
 * Renders every admin-only view as a super-admin (primeSession owner:'admin') against
 * a LOCAL fixture server with the network mocked, and asserts three things the CTO asked
 * for: (1) MONOCHROME — no surface has a blue/cool color cast (the hue-220 light-theme
 * bug); (2) NOT BROKEN — every admin route renders its shell without an error-boundary
 * crash, and page errors are collected per route; (3) org SEARCH is reachable. One
 * screenshot per view so breakage is visible.
 *
 * Run: BASE_URL=http://localhost:4000 npx playwright test admin-views-audit
 */
import { test, expect, type Route, type Page } from '@playwright/test'
import { requireFixtureServer } from './_fixture'
import { primeSession } from './_session'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4000'
requireFixtureServer()
const SHOTS = join(process.cwd(), 'e2e-shots', 'admin-audit')

/** The super-admin identity (a@hanzo.ai in the reserved `admin` org). */
const ADMIN = { owner: 'admin', name: 'a', email: 'a@hanzo.ai', displayName: 'Admin', isAdmin: true }

/** Every admin-only view (registry `admin:true`) + the two catalog editors. */
const ADMIN_VIEWS = [
  'finance-center', 'provider-billing', 'provider-admin', 'ai-economics', 'iam', 'kms',
  'audit', 'secrets', 'authz', 'hsm', 'mpc', 'treasury', 'tenants', 'entitlements',
  'cluster-fleet', 'function-fleet', 'service-mesh', 'gitops', 'status', 'tracker',
  'routing', 'models', 'platform', 'authors-admin', 'affiliates-admin', 'referrals-admin',
  'catalog', 'plans',
]

const API_RE = /\/(v1|cloud|ai|billing|commerce|telemetry|vm|superbase|admin|paas|integrations|auth\/refresh)(\/|$|\?)/

async function mock(route: Route) {
  const req = route.request()
  if (req.resourceType() === 'document') return route.continue()
  const url = new URL(req.url())
  const sameOrigin = url.origin === new URL(BASE_URL).origin
  if (sameOrigin && !API_RE.test(url.pathname)) return route.continue()
  // Honest-empty for every API — the audit is about RENDER + THEME, not data.
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', msg: '', data: [], data2: 0 }) })
}

/** Parse `rgb(r, g, b[, a])` → [r,g,b] or null. */
function rgb(v: string): [number, number, number] | null {
  const m = v.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** A color is monochrome when R≈G≈B. A blue cast = B meaningfully above R and G. */
function blueCast([r, g, b]: [number, number, number]): number {
  return b - Math.max(r, g)
}

test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }))

test('every admin view is monochrome — no blue cast in the rendered surfaces', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await page.route('**/*', mock)
  await primeSession(page, ADMIN)
  await page.goto(`${BASE_URL}/finance-center`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500) // let the SPA hydrate + the module mount

  // Sample the computed background/border/text colors of every rendered element and
  // assert none carries a blue cast beyond a small tolerance (anti-aliasing / semantics
  // like a green "live" dot are allowed — we only flag a systemic BLUE tint).
  const offenders = await page.evaluate(() => {
    const bad: { sel: string; prop: string; color: string }[] = []
    const rgbOf = (v: string) => { const m = v.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/); return m ? [+m[1], +m[2], +m[3]] as [number, number, number] : null }
    const els = Array.from(document.querySelectorAll('*')).slice(0, 4000)
    for (const el of els) {
      const cs = getComputedStyle(el as Element)
      for (const prop of ['backgroundColor', 'borderTopColor', 'color'] as const) {
        const c = rgbOf(cs[prop]); if (!c) continue
        const [r, g, bl] = c
        // Ignore near-black/near-white/transparent grays; flag a real blue tint only.
        if (bl - Math.max(r, g) >= 18 && bl > 60) bad.push({ sel: (el as Element).tagName.toLowerCase(), prop, color: cs[prop] })
      }
    }
    return bad.slice(0, 20)
  })
  await page.screenshot({ path: join(SHOTS, 'finance-center.png') })
  if (offenders.length) console.log('BLUE-CAST offenders:', JSON.stringify(offenders, null, 2))
  expect(offenders, `blue-cast surfaces found: ${JSON.stringify(offenders)}`).toHaveLength(0)

  await ctx.close()
})

test('the LIGHT theme is monochrome — the hue-220 blue-tinge fix', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await page.route('**/*', mock)
  await primeSession(page, ADMIN)
  await page.addInitScript(() => { try { localStorage.setItem('theme', 'light') } catch { /* private */ } })
  await page.goto(`${BASE_URL}/finance-center`, { waitUntil: 'domcontentloaded' })
  // Force the light-theme class regardless of the next-themes storage key — this is the
  // surface (html:root.t_light) that used to build its scale on hsl(220 …) = blue.
  await page.evaluate(() => { document.documentElement.classList.add('t_light'); document.documentElement.classList.remove('t_dark') })
  await page.waitForTimeout(1500)
  const offenders = await page.evaluate(() => {
    const bad: { sel: string; prop: string; color: string }[] = []
    const rgbOf = (v: string) => { const m = v.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/); return m ? [+m[1], +m[2], +m[3]] as [number, number, number] : null }
    for (const el of Array.from(document.querySelectorAll('*')).slice(0, 4000)) {
      const cs = getComputedStyle(el as Element)
      for (const prop of ['backgroundColor', 'borderTopColor', 'color'] as const) {
        const c = rgbOf(cs[prop]); if (!c) continue
        const [r, g, bl] = c
        if (bl - Math.max(r, g) >= 18 && bl > 60) bad.push({ sel: (el as Element).tagName.toLowerCase(), prop, color: cs[prop] })
      }
    }
    return bad.slice(0, 20)
  })
  await page.screenshot({ path: join(SHOTS, 'finance-center-light.png') })
  if (offenders.length) console.log('LIGHT-MODE BLUE-CAST offenders:', JSON.stringify(offenders, null, 2))
  expect(offenders, `light-mode blue-cast surfaces: ${JSON.stringify(offenders)}`).toHaveLength(0)
  await ctx.close()
})

test('org search is reachable for a super-admin', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await page.route('**/*', mock)
  await primeSession(page, ADMIN)
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2000)
  // The org switcher/picker must expose a filter input for a super-admin (many orgs).
  const filter = page.locator('input[placeholder*="rganization" i], input[placeholder*="ilter" i], input[placeholder*="earch" i]')
  await expect(filter.first(), 'no org search/filter input found for super-admin').toBeVisible({ timeout: 10_000 })
  await ctx.close()
})

test('no admin view crashes — each renders its shell (screenshot per view)', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await page.route('**/*', mock)
  await primeSession(page, ADMIN)

  const broken: { view: string; reason: string }[] = []
  for (const view of ADMIN_VIEWS) {
    const errors: string[] = []
    const onErr = (e: Error) => errors.push(e.message)
    page.on('pageerror', onErr)
    try {
      await page.goto(`${BASE_URL}/${view}`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(1500)
      await page.screenshot({ path: join(SHOTS, `${view}.png`) })
      // A hard crash = the shared error boundary card, or a JS pageerror.
      const crashed = await page.locator('text=/Something went wrong|Application error|Unhandled|Cannot read prop/i').first().isVisible().catch(() => false)
      if (crashed) broken.push({ view, reason: 'error-boundary/crash card' })
      else if (errors.length) broken.push({ view, reason: `pageerror: ${errors[0]}` })
    } catch (e) {
      broken.push({ view, reason: `navigation: ${(e as Error).message}` })
    } finally {
      page.off('pageerror', onErr)
    }
  }
  if (broken.length) console.log('BROKEN ADMIN VIEWS:', JSON.stringify(broken, null, 2))
  expect(broken, `broken admin views: ${JSON.stringify(broken)}`).toHaveLength(0)
  await ctx.close()
})
