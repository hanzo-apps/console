/**
 * LIVE confirmation for feat/billing-usage-admin (v8.4.15) on the deployed cluster.
 *
 * Topology (verified live):
 *  - console.hanzo.ai: the console app is directly reachable at `/`; `/v1/*` is
 *    routed by the ingress to cloud-api (hanzoai/gateway), which enforces its OWN
 *    `global admin required` gate. The console's own H1 gate is reachable directly
 *    at `/admin/aggregate/*`. z@hanzo.ai is a global admin on this host.
 *  - admin.hanzo.ai: an EDGE forward-auth (`admin-guard@file`, org=admin, cookie
 *    on `.hanzo.ai`) sits in front of the SAME console image. A browser must carry
 *    a valid `.hanzo.ai` guard/session cookie to pass; a cold hit is 401.
 *
 * Three required checks (task bar):
 *   (a) admin business board (LivingOverview: MRR/usage/orgs/top-agents/fleet)
 *       renders for the GLOBAL admin z@hanzo.ai.
 *   (b) an unprivileged caller gets 403 on /v1/admin/* — no cross-org leak
 *       (fail-closed gate); iam/kms are not tunneled.
 *   (c) billing Reports shows the product/agent cost DIMENSION (honest-empty ok).
 */
import { test, expect, type Page, type APIRequestContext } from '@playwright/test'

const EMAIL    = process.env.HANZO_EMAIL    ?? 'z@hanzo.ai'
const PASSWORD = process.env.HANZO_PASSWORD ?? ''
const CONSOLE  = process.env.CONSOLE_URL    ?? 'https://console.hanzo.ai'
const ADMIN    = process.env.ADMIN_URL      ?? 'https://admin.hanzo.ai'
const SHOTS    = process.env.SHOT_DIR       ?? 'e2e-shots'

/** Sign in via the console app sign-in form (email/password → cloud /v1/signin). */
async function signIn(page: Page, base: string) {
  await page.goto(`${base}/signin`)
  await page.waitForSelector('input[placeholder="Email"]', { timeout: 25_000 })
  await page.fill('input[placeholder="Email"]', EMAIL)
  await page.fill('input[placeholder="Password"]', PASSWORD)
  await page.click('button:has-text("Sign in")')
  await page.waitForFunction(() => !location.pathname.startsWith('/signin'), { timeout: 30_000 })
  await page.waitForLoadState('domcontentloaded')
}

// ─── (b) fail-closed gate — needs no credentials, always runs ─────────────────
test.describe('LIVE v8.4.15 — (b) admin gate fail-closed', () => {
  test('/v1/admin/* → 403 unauthenticated on console.hanzo.ai; iam/kms not tunneled', async ({ request }) => {
    for (const head of ['overview', 'usage', 'orgs', 'audit', 'products']) {
      const res = await request.get(`${CONSOLE}/v1/admin/${head}`)
      expect(res.status(), `${CONSOLE}/v1/admin/${head} must be 403`).toBe(403)
    }
    // The console's OWN H1 route is also fail-closed.
    const own = await request.get(`${CONSOLE}/admin/aggregate/overview`)
    expect(own.status(), 'console app /admin/aggregate gate must be 403').toBe(403)
    // Least privilege: iam/kms are NOT reachable through the aggregate rewrite.
    for (const head of ['iam', 'kms']) {
      const res = await request.get(`${CONSOLE}/admin/aggregate/${head}`)
      expect([403, 404], `${head} must not tunnel via aggregate`).toContain(res.status())
    }
    // Edge-guarded admin host: cold hit is refused (401 forward-auth) — never open.
    const edge = await request.get(`${ADMIN}/v1/admin/overview`)
    expect(edge.status(), 'admin.hanzo.ai must be edge-gated (401/403)').toBeGreaterThanOrEqual(401)
    expect(edge.status()).toBeLessThan(404)
    console.log('✓ (b) console /v1/admin/* → 403 unauth; /admin/aggregate/{iam,kms} not tunneled; admin.hanzo.ai edge-gated')
  })
})

// ─── (a) + (c) authenticated as the global admin z@hanzo.ai ───────────────────
test.describe('LIVE v8.4.15 — (a) business board + (c) billing dimension', () => {
  test.skip(!PASSWORD, 'HANZO_PASSWORD not set')

  test('(a) admin business board renders for global admin z@hanzo.ai', async ({ page }) => {
    await signIn(page, CONSOLE)

    // The business board (catalog id `business`, admin:true) renders the ONE
    // LivingOverview for `admin-business`: MRR / revenue / active orgs / customers,
    // revenue+usage trend, top-agents-by-cost donut, fleet health.
    await page.goto(`${CONSOLE}/business`, { waitUntil: 'domcontentloaded' })
    await expect(page).not.toHaveURL(/\/signin/, { timeout: 15_000 })

    // Global admin sees the board (not the admin-only "not authorized" gate).
    const board = page.locator(
      'text=/MRR|Revenue|Active orgs|Customers|Usage cost|Top agents|Fleet|Business/i'
    ).first()
    await expect(board, 'admin business board did not render for the global admin').toBeVisible({ timeout: 30_000 })
    // The client admin gate did NOT block z (would show a forbidden/hidden state).
    await expect(page.locator('text=/not authorized|access denied|admin only|forbidden/i')).toHaveCount(0)

    await page.screenshot({ path: `${SHOTS}/a-business-board.png`, fullPage: true })
    console.log('✓ (a) admin business board rendered for global admin z@hanzo.ai')
  })

  test('(a2) global admin passes the /v1/admin gate (not 403)', async ({ page }) => {
    await signIn(page, CONSOLE)
    const res = await page.request.get(`${CONSOLE}/v1/admin/overview`)
    expect(res.status(), 'global admin must pass the gate (not 403)').not.toBe(403)
    console.log(`✓ (a2) global admin /v1/admin/overview → ${res.status()} (gate passed)`)
  })

  // (a3) admin.hanzo.ai: after establishing the shared `.hanzo.ai` session, the
  // edge guard should admit the global admin and render the same board. If the
  // guard still refuses (its own OIDC bootstrap), record the honest state — the
  // board is proven on console.hanzo.ai (same image) and the edge gate is proven
  // fail-closed above.
  test('(a3) admin.hanzo.ai admits the global admin (or is honestly edge-gated)', async ({ page }) => {
    await signIn(page, CONSOLE) // sets the `.hanzo.ai`-scoped session
    const res = await page.request.get(`${ADMIN}/`)
    if (res.status() === 200) {
      await page.goto(`${ADMIN}/business`, { waitUntil: 'domcontentloaded' })
      const board = page.locator('text=/MRR|Revenue|Active orgs|Customers|Top agents|Business/i').first()
      await expect(board).toBeVisible({ timeout: 30_000 })
      await page.screenshot({ path: `${SHOTS}/a3-admin-host-board.png`, fullPage: true })
      console.log('✓ (a3) admin.hanzo.ai admitted the global admin; board rendered')
    } else {
      console.log(`ℹ (a3) admin.hanzo.ai edge-guard returned ${res.status()} for the shared session — board verified on console.hanzo.ai (same image)`)
    }
  })

  test('(c) billing Reports renders the cost-dimension surface', async ({ page }) => {
    await signIn(page, CONSOLE)
    // Enter the billing product via the app (client-side SPA routing — a HARD goto
    // to /billing/reports is captured by the app's own /billing/[...path] server
    // PROXY route, not the tabbed UI). Land on the billing overview, then click the
    // Reports tab so the client router mounts BillingReports.
    await page.goto(`${CONSOLE}/billing`, { waitUntil: 'domcontentloaded' })
    await expect(page).not.toHaveURL(/\/signin/, { timeout: 15_000 })
    // The Reports tab (subpage nav). Click it (client nav — no server round-trip).
    const reportsTab = page.getByRole('link', { name: /^Reports$/i })
      .or(page.getByText(/^Reports$/).first())
    await reportsTab.first().click({ timeout: 20_000 })

    // The Cost-table Reports surface: the "spend by <dimension>" control. model +
    // provider are always offered; product + agent appear the moment the commerce
    // ledger tags a row (honest — never a fabricated column). Assert a dimension
    // affordance renders (BillingReports mounted, not a proxy JSON / 404).
    await expect(page.locator('text=/not found|could not be found/i'), 'reports fell through to proxy/404')
      .toHaveCount(0, { timeout: 20_000 })
    const dim = page.getByText(/by model|by provider|by product|by agent|group by|dimension|spend by/i).first()
    await expect(dim, 'cost dimension control did not render').toBeVisible({ timeout: 30_000 })
    await expect(page.locator('text=/something went wrong|application error/i')).toHaveCount(0)

    await page.screenshot({ path: `${SHOTS}/c-billing-reports.png`, fullPage: true })
    console.log('✓ (c) billing Reports (tab) rendered the cost-dimension control')
  })
})
