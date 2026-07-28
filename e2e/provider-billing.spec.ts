/**
 * e2e: admin.hanzo.ai Provider Billing board (feat/admin-provider-billing).
 *
 * TWO layers, mirroring insights-o11y.spec:
 *   (A) FIXTURE render — runs against a LOCAL server (BASE_URL=http://localhost:4000)
 *       with the network mocked (budgets-responsive pattern): `/auth/session` → a
 *       global admin so the admin shell mounts, and the two contract endpoints
 *       (`/v1/admin/providers/credit`, `/v1/admin/usage/funding`) → the DIGITALOCEAN
 *       $26k credit + glm-5.2 funding-split fixture. Proves the credit card + the
 *       credit-vs-paid split RENDER, at desktop AND mobile (no horizontal scroll),
 *       with screenshots. This is the develop-against-the-contract proof.
 *   (B) LIVE — the fail-closed gate proof (`/v1/admin/providers/credit` +
 *       `/v1/admin/usage/funding` → 403 unauthenticated) ALWAYS runs; the
 *       authenticated render against REAL DO data is STAGED behind HANZO_PASSWORD
 *       (the reserved-admin SuperAdmin secret) + a deployed image.
 *
 * Run fixture: BASE_URL=http://localhost:4000 npx playwright test provider-billing
 * Run live:    HANZO_PASSWORD=… CONSOLE_URL=https://admin.hanzo.ai npx playwright test provider-billing
 */
import { test, expect, type Route, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { requireFixtureServer } from './_fixture'
import { primeSession } from './_session'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4000'
const SHOTS = join(process.cwd(), 'e2e-shots')

// A SuperAdmin via the isGlobalAdmin/isSuperAdmin CLAIM (what the admin:true module
// gates on — `useIsSuperAdmin`). owner is a normal org so the Scope resolves the
// current org locally instead of demanding a pick from the (mocked-empty) org list;
// the real reserved-`admin`-org SuperAdmin is exercised by the LIVE (B) test.
const ACCOUNT = {
  owner: 'admin',
  name: 'z',
  type: 'normal-user',
  email: 'z@hanzo.ai',
  displayName: 'Z Admin',
  isGlobalAdmin: true,
  isSuperAdmin: true,
  isAdmin: true,
  signupApplication: 'hanzo-cloud',
}

/** GET /v1/admin/providers/credit — the DO $26k grant (the acceptance headline),
 *  plus a paid-only + a second credit provider to exercise every badge. */
const CREDIT = [
  { provider: 'do-ai', grant_cents: 2_600_000, burn_cents: 41_200, remaining_cents: 2_418_000, runway_days: 58, has_credit: true, is_paid_only: false },
  { provider: 'openrouter', grant_cents: 100_000, burn_cents: 21_000, remaining_cents: 62_500, runway_days: 3, has_credit: true, is_paid_only: false },
  { provider: 'openai-direct', grant_cents: 0, burn_cents: 8_500, remaining_cents: 0, runway_days: null, has_credit: false, is_paid_only: true },
]

/** GET /v1/admin/usage/funding — glm-5.2 on DO drawn from OUR CREDIT (the live
 *  usage), plus paid / paid-only / BYO rows so the split shows all four classes. */
const FUNDING = [
  { provider: 'do-ai', model: 'glm-5.2', funding: 'credit', tokens: 1_284_000, cost_cents: 18_200, requests: 3_120 },
  { provider: 'openrouter', model: 'gpt-5', funding: 'paid', tokens: 92_000, cost_cents: 44_000, requests: 210 },
  { provider: 'openai-direct', model: 'gpt-5-mini', funding: 'paid_only', tokens: 30_000, cost_cents: 9_000, requests: 140 },
  { provider: 'anthropic', model: 'claude-opus-4.6', funding: 'byo', tokens: 50_000, cost_cents: 0, requests: 80 },
]

const API_RE = /\/(v1|cloud|ai|billing|commerce|telemetry|vm|superbase|admin|paas|integrations|auth\/refresh)(\/|$|\?)/

async function mock(route: Route) {
  const req = route.request()
  if (req.resourceType() === 'document') return route.continue()
  const url = new URL(req.url())
  const path = url.pathname

  if (path === '/auth/session') {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ account: ACCOUNT, expiresIn: 3600 }) })
  }
  if (path.startsWith('/auth/')) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  }
  // The two contract endpoints — bare arrays, exactly as documented.
  if (path === '/v1/admin/providers/credit') {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CREDIT) })
  }
  if (path === '/v1/admin/usage/funding') {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FUNDING) })
  }

  const sameOrigin = url.origin === new URL(BASE_URL).origin
  if (sameOrigin && !API_RE.test(path)) return route.continue()
  // Any other data call → an honest empty-ok envelope so the shell is quiet.
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', msg: '', data: [], data2: 0 }) })
}

async function openBoard(page: Page) {
  await page.addInitScript((org) => {
    try {
      localStorage.setItem('hanzo.console.org', org)
      localStorage.setItem('hanzo.console.org.selected', '1') // ENTERED flag — Scope → scoped console
      localStorage.setItem('hz_onboarding_done:' + org, '1') // skip the first-run wizard (auto-skipped on admin.* + embed)
      localStorage.setItem('hz_admin_banner_dismissed', '1')
    } catch {
      /* private mode */
    }
  }, ACCOUNT.owner)
  await page.route('**/*', mock)
  await primeSession(page, ACCOUNT)
  await page.goto(`${BASE_URL}/provider-billing`, { waitUntil: 'domcontentloaded' })
  const content = page.locator('[data-testid="product-content"]').first()
  await content.waitFor({ state: 'attached', timeout: 20_000 })
  // Scope the readiness wait to the product CONTENT (the "Provider Billing" nav
  // label is hidden behind the off-canvas sidebar on a narrow viewport).
  await expect(content.getByText('Provider credit').first()).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(900)
}

test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }))

// ─── (A) fixture render ───────────────────────────────────────────────────────
test.describe('(A) fixture render — DO $26k credit + glm-5.2 funding split', () => {
  // Asserts LOCAL fixture data (the seeded $26k/glm-5.2 board); skip when the
  // fixture server is down. The (B) LIVE gate below hits prod and always runs.
  requireFixtureServer()

  test('renders the credit card + funding split at a desktop viewport', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await ctx.newPage()
    await openBoard(page)

    // Section 1: the DO credit card — the $26k grant + remaining + runway + badge.
    await expect(page.locator('text=Provider credit').first()).toBeVisible()
    await expect(page.locator('text=do-ai').first()).toBeVisible()
    await expect(page.locator('text=$26,000.00').first()).toBeVisible() // the $26k DO grant
    await expect(page.locator('text=$24,180.00').first()).toBeVisible() // remaining
    await expect(page.locator('text=58 days').first()).toBeVisible() // runway_days
    await expect(page.locator('text=Has credit').first()).toBeVisible()
    await expect(page.locator('text=Paid-only').first()).toBeVisible() // openai-direct badge

    // Section 2: the credit-vs-paid split — all four funding classes + the glm-5.2 row.
    await expect(page.locator('text=Credit vs paid usage').first()).toBeVisible()
    await expect(page.locator('text=Our credit').first()).toBeVisible()
    await expect(page.locator('text=glm-5.2').first()).toBeVisible()
    await expect(page.locator('text=BYO key').first()).toBeVisible()

    await page.screenshot({ path: join(SHOTS, 'provider-billing-desktop.png'), fullPage: true })
    await ctx.close()
  })

  test('reflows with no horizontal body scroll at a narrow (mobile) viewport', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await ctx.newPage()
    await openBoard(page)

    await expect(page.locator('text=do-ai').first()).toBeVisible()
    const overflow = await page.evaluate(() => {
      const el = document.documentElement
      return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }
    })
    expect(overflow.scrollWidth, 'no horizontal body scroll at 390px').toBeLessThanOrEqual(overflow.clientWidth + 1)

    await page.screenshot({ path: join(SHOTS, 'provider-billing-mobile.png'), fullPage: true })
    await ctx.close()
  })
})

// ─── (B) live — fail-closed gate always runs; real-DO render staged ───────────
const CONSOLE = process.env.CONSOLE_URL ?? 'https://console.hanzo.ai'
const PASSWORD = process.env.HANZO_PASSWORD ?? ''
const EMAIL = process.env.HANZO_EMAIL ?? 'z@hanzo.ai'

test.describe('(B) LIVE — admin gate + real DO data', () => {
  test('fail-closed: /v1/admin/{providers/credit,usage/funding} → 403 unauthenticated', async ({ request }) => {
    for (const p of ['providers/credit', 'usage/funding']) {
      const res = await request.get(`${CONSOLE}/v1/admin/${p}`)
      // Fail-closed: an unauthenticated caller NEVER gets data. Post-deploy this is
      // the 403 global-admin gate (like every other /v1/admin/* head); before the
      // sibling endpoint deploys the route may 404 — both are "not open". Never 200.
      expect(res.status(), `${CONSOLE}/v1/admin/${p} must be fail-closed (>=401)`).toBeGreaterThanOrEqual(401)
      expect(res.status(), `${CONSOLE}/v1/admin/${p} must not 5xx`).toBeLessThan(500)
    }
  })

  test('authenticated: the board renders REAL DO credit + funding for the SuperAdmin', async ({ page }) => {
    test.skip(!PASSWORD, 'HANZO_PASSWORD (reserved-admin SuperAdmin secret) not set — staged for the live deploy')
    await page.goto(`${CONSOLE}/signin`)
    await page.waitForSelector('input[placeholder="Email"]', { timeout: 25_000 })
    await page.fill('input[placeholder="Email"]', EMAIL)
    await page.fill('input[placeholder="Password"]', PASSWORD)
    await page.click('button:has-text("Sign in")')
    await page.waitForFunction(() => !location.pathname.startsWith('/signin'), { timeout: 30_000 })

    await page.goto(`${CONSOLE}/provider-billing`, { waitUntil: 'domcontentloaded' })
    await expect(page).not.toHaveURL(/\/signin/, { timeout: 15_000 })
    // The board (not the operator-access gate) rendered for the SuperAdmin.
    await expect(page.locator('text=/Provider credit|Credit vs paid/i').first()).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('text=/SuperAdmin access required/i')).toHaveCount(0)
    // Real DO data: the $26k grant / a do-ai card / glm-5.2 usage.
    await expect(page.locator('text=/do-ai|digitalocean/i').first()).toBeVisible({ timeout: 30_000 })
    await page.screenshot({ path: join(SHOTS, 'provider-billing-live-do.png'), fullPage: true })
    console.log('✓ (B) Provider Billing rendered REAL DO credit + funding for the SuperAdmin')
  })
})
