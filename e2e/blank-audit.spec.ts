/**
 * e2e blank audit — mocked-network render proof for EVERY in-console product route.
 *
 * Runs against a LOCAL `next dev` (BASE_URL=http://localhost:4000) with the whole
 * network mocked, so it needs NO real backend and NO password:
 *   - `/auth/session` → a global-admin account (sees every product), so the Auth
 *     and Scope pass and the full console shell mounts.
 *   - every data endpoint (`/v1`, `/v1`, `/ai`, `/billing`, `/commerce`,
 *     `/telemetry`, `/vm`, `/superbase`, `/admin`, cross-origin platform) → a chosen
 *     failure mode (AUDIT_MODE): `notrouted` (404, the "backend not wired on this
 *     deployment" reality), `down` (502), or `empty` (200 empty payload).
 *
 * For each route it navigates `/<id>`, waits for the shell's `product-content`
 * region, and classifies what rendered there:
 *   - `blank`     → the content region mounted but is EMPTY (the bug we hunt),
 *   - `content`   → real data OR an honest error/empty card (the goal),
 *   - `notfound`  → Next 404 (an unrouted/external id — expected for a few),
 *   - `no-shell`  → the shell itself failed to mount (worse than blank).
 *
 * It writes e2e/blank-report.json and fails iff any route is `blank`/`no-shell`.
 *
 * Run: AUDIT_MODE=notrouted BASE_URL=http://localhost:4000 npx playwright test blank-audit
 */
import { test, expect, type Route } from '@playwright/test'
import { requireFixtureServer } from './_fixture'
import { primeSession } from './_session'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4000'

// These render specs assert LOCAL fixture data; skip cleanly when that server is down.
requireFixtureServer()
const MODE = (process.env.AUDIT_MODE ?? 'notrouted') as 'notrouted' | 'down' | 'empty'
const ROLE = (process.env.AUDIT_ROLE ?? 'admin') as 'admin' | 'customer'

const CANONICAL_IDS: string[] = JSON.parse(readFileSync(join(process.cwd(), 'e2e', 'route-ids.json'), 'utf8'))
/**
 * The HUMAN slugs the console nav / docs / bookmarks / the CTO's e2e list use that
 * are NOT registry ids — they must resolve via SLUG_ALIASES to a real module (never
 * a 404 blank). Auditing them here proves the alias map end-to-end against the real app.
 */
const ALIAS_SLUGS = ['traces', 'deploy', 'plans-pricing', 'wallets', 'model-catalog', 'fine-tuning', 'web-search', 'mlpipelines', 'kubeflow']
const IDS: string[] = [...CANONICAL_IDS, ...ALIAS_SLUGS]

/** A global-admin (sees every surface) or a tenant customer (Dave/maxpower shape). */
const ACCOUNT =
  ROLE === 'admin'
    ? { owner: 'admin', name: 'z', type: 'normal-user', email: 'z@hanzo.ai', displayName: 'Z Admin', isGlobalAdmin: true, isAdmin: true, signupApplication: 'hanzo-cloud' }
    : { owner: 'maxpower', name: 'dave', type: 'normal-user', email: 'dave@maxpower.com', displayName: 'Dave', isGlobalAdmin: false, isAdmin: true, signupApplication: 'hanzo-cloud' }

/** casibase envelope + REST payloads for the three failure modes. */
function payloadFor(mode: typeof MODE): { status: number; body: string } {
  if (mode === 'down') return { status: 502, body: 'Bad Gateway' }
  if (mode === 'notrouted') return { status: 404, body: JSON.stringify({ status: 'error', msg: 'not found', data: null }) }
  // empty-ok: a well-formed empty envelope; REST readers also tolerate [] / {}.
  return { status: 200, body: JSON.stringify({ status: 'ok', msg: '', data: [], data2: 0 }) }
}

/** Path prefixes that are DATA calls (mock them); everything else is a Next asset/page. */
const API_RE = /\/(v1|cloud|ai|billing|commerce|telemetry|vm|superbase|admin|paas|integrations|auth\/refresh)(\/|$|\?)/

async function mock(route: Route) {
  const req = route.request()
  // NEVER mock a top-level page navigation (the app HTML). A product route id can
  // collide with an API head (e.g. `/integrations`, `/billing`), so keying off the
  // path alone would serve the mock JSON AS the page. Only data calls (xhr/fetch)
  // are mocked; documents/assets always load the real app.
  if (req.resourceType() === 'document') return route.continue()
  const url = new URL(req.url())
  const path = url.pathname

  // Session → authed account (always ok, regardless of MODE).
  if (path === '/auth/session') {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ account: ACCOUNT, expiresIn: 3600 }) })
  }
  if (path.startsWith('/auth/')) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  }

  // Same-origin Next asset or the app HTML → let it through.
  const sameOrigin = url.origin === new URL(BASE_URL).origin
  const isApi = API_RE.test(path)
  if (sameOrigin && !isApi) return route.continue()

  // Cross-origin (platform.hanzo.ai, api.hanzo.ai, cloud.hanzo.ai, …) OR a
  // same-origin data path → the chosen failure mode.
  const { status, body } = payloadFor(MODE)
  const contentType = body.startsWith('{') || body.startsWith('[') ? 'application/json' : 'text/plain'
  return route.fulfill({ status, contentType, body })
}

type Outcome = 'content' | 'blank' | 'notfound' | 'no-shell'
const results: Record<string, { outcome: Outcome; chars: number; sample: string }> = {}

test.describe.configure({ mode: 'serial' })

test.describe(`blank audit [mode=${MODE} role=${ROLE}]`, () => {
  let page: import('@playwright/test').Page
  let ctx: import('@playwright/test').BrowserContext

  test.beforeAll(async ({ browser }) => {
    ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    page = await ctx.newPage()
    // Seed the active org to the account's own org so Scope doesn't hard-pin +
    // reload a customer (currentOrg !== owner) mid-audit, and dismiss the admin
    // banner so the shell is stable. Runs before every navigation (survives reloads).
    await page.addInitScript((org) => {
      try {
        localStorage.setItem('hanzo.console.org', org)
        localStorage.setItem('hz_admin_banner_dismissed', '1')
      } catch {
        /* private mode */
      }
    }, ACCOUNT.owner)
    await page.route('**/*', mock)
  await primeSession(page, ACCOUNT)
  })

  test.afterAll(async () => {
    writeFileSync(join(process.cwd(), 'e2e', 'blank-report.json'), JSON.stringify({ mode: MODE, role: ROLE, results }, null, 2))
    const blanks = Object.entries(results).filter(([, r]) => r.outcome === 'blank' || r.outcome === 'no-shell')
    const nf = Object.entries(results).filter(([, r]) => r.outcome === 'notfound').map(([id]) => id)
    // eslint-disable-next-line no-console
    console.log(`\n=== blank audit [${MODE}/${ROLE}] ===\nroutes: ${Object.keys(results).length}  blank/no-shell: ${blanks.length}  notfound: ${nf.length}`)
    if (blanks.length) console.log('BLANK:', blanks.map(([id, r]) => `${id}(${r.outcome})`).join(', '))
    if (nf.length) console.log('NOTFOUND:', nf.join(', '))
    await ctx?.close()
  })

  for (const id of IDS) {
    test(`/${id}`, async () => {
      await page.goto(`${BASE_URL}/${id}`, { waitUntil: 'domcontentloaded' })
      // Let the client mount + the module's first data attempt settle.
      const content = page.locator('[data-testid="product-content"]').first()
      const appeared = await content.waitFor({ state: 'attached', timeout: 15_000 }).then(() => true).catch(() => false)

      let outcome: Outcome
      let chars = 0
      let sample = ''
      if (!appeared) {
        // No shell content region — either a Next 404 (notfound) or a shell failure.
        const is404 = await page.locator('text=/404|not be found|This page could not/i').count().then((c) => c > 0).catch(() => false)
        outcome = is404 ? 'notfound' : 'no-shell'
      } else {
        // Give async data one more settle beat, then read the region's text.
        await page.waitForTimeout(1200)
        const txt = (await content.innerText().catch(() => '')) || ''
        chars = txt.trim().length
        sample = txt.trim().slice(0, 80).replace(/\s+/g, ' ')
        outcome = chars > 0 ? 'content' : 'blank'
      }
      results[id] = { outcome, chars, sample }
      // Record only — the final `no blank routes` test asserts over ALL results, so
      // one blank never fail-fasts the serial group and hides the rest.
      // eslint-disable-next-line no-console
      console.log(`${outcome === 'content' ? '✓' : outcome === 'notfound' ? '·' : '✗'} /${id} [${outcome}] ${chars}c ${sample}`)
    })
  }

  test('no route renders blank', async () => {
    const bad = Object.entries(results).filter(([, r]) => r.outcome === 'blank' || r.outcome === 'no-shell')
    expect(bad.map(([id, r]) => `${id}(${r.outcome})`), 'every product route must render real data or an honest state').toEqual([])
  })
})
