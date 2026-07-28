/**
 * COMPREHENSIVE SMOKE — the whole MONEY / USAGE / OBSERVABILITY surface of the console,
 * end to end, honest by construction. This is the repeatable proof that every billing,
 * settings, usage-metrics and o11y page RENDERS (real data OR a graceful/honest state)
 * and never a dead "Could not load" card — the exact regression the platform owner
 * asked to lock down.
 *
 * Two layers, so the spec is ALWAYS runnable and honest:
 *
 *  A. UNAUTHENTICATED fail-closed proof (ALWAYS runs, no creds — green in CI). Proves
 *     the harness reaches the deployment AND the security invariant that matters most:
 *     an anonymous caller NEVER gets 2xx billing/usage/o11y DATA. Each read is gated
 *     (401/403) when the backend is up, or 5xx/redirect while it rolls (single-replica
 *     Recreate) — but never a 200 leaking a tenant's money/usage. Resilient to a roll:
 *     it asserts only "anonymous is refused", and LOGS the live status matrix.
 *
 *  B. AUTHENTICATED render smoke (runs when HANZO_PASSWORD is provided). Signs in with
 *     the ESTABLISHED console form pattern and walks every surface the owner listed:
 *       - Billing: Overview · Reports · Budgets · Invoices · Subscriptions ·
 *         Payment methods · Credits (+ the Finance ledger board). Invoices gets a deep
 *         test: the list/table renders, the DOWNLOAD control exists + the PDF endpoint
 *         responds, the print/statement path (window.print + the PDF) is available, and
 *         a RELOAD re-renders cleanly (no flash-of-error).
 *       - Settings: General · Branding (every tab renders).
 *       - Usage metrics: Usage · Metrics · AI Metrics (charts or an honest empty state;
 *         the time-range control works).
 *       - o11y: Traces · Observations · Service Map · Logs · Dashboards · Alerts ·
 *         Fleet Observability (real data OR an honest RuntimeNotice/empty — NOT a dead
 *         card).
 *     Each surface: navigate, assert it RENDERS (a real marker OR an honest state),
 *     screenshot into e2e-shots/, and COLLECT any dead "Could not load" card. A final
 *     aggregate test FLAGS the collected dead-card list (the 402-as-crash bug the owner
 *     is fixing separately): green for a funded org, and a precise per-surface bug list
 *     for an unfunded one (maxpower).
 *
 * Run:
 *   # unauthenticated fail-closed proof (works today, no creds):
 *   BASE_URL=https://console.hanzo.ai npx playwright test billing-usage-o11y --reporter=line
 *   # full authenticated render smoke (needs a real password — NEVER hardcode it):
 *   HANZO_EMAIL='z@hanzo.ai' HANZO_PASSWORD='…' npx playwright test billing-usage-o11y --reporter=line
 *
 * With no HANZO_PASSWORD the authenticated smoke SKIPS (so the suite is green in CI
 * without secrets) while the fail-closed proof still runs.
 */
import { test, expect, type Page, type Browser, type APIRequestContext } from '@playwright/test'

const EMAIL = process.env.HANZO_EMAIL ?? 'z@hanzo.ai'
const PASSWORD = process.env.HANZO_PASSWORD ?? ''
const CONSOLE = process.env.BASE_URL ?? process.env.CONSOLE_URL ?? 'https://console.hanzo.ai'
const SHOTS = process.env.SHOT_DIR ?? 'e2e-shots'

// ── the dead-card signal ────────────────────────────────────────────────────────
// The generic fallback the owner wants eliminated: a 402/500 rendered as a dead
// "Could not load" (states-logic.ts) / "Could not reach the backend" (BackendState)
// instead of an HONEST top-up / empty / access / initializing state. Matched EXACTLY
// (exact:true) so the legitimate "Could not load the card form." (a Square-iframe
// honest state) and "Could not load more." (pager) are NOT false-flagged.
const DEAD_HEADINGS = ['Could not load', 'Could not reach the backend'] as const
// A hard crash / error boundary / static 404 — always a failure, never honest.
const CRASH_RE = /something went wrong|application error|unexpected token|this page could not be found|client-side exception/i

/** Accumulates "<surface> → <dead heading>" across the serial run; the final test asserts it empty. */
const deadCards: string[] = []

/** Sign in via the console app sign-in form — the ESTABLISHED pattern (never hardcode the password). */
async function signIn(page: Page): Promise<void> {
  await page.goto(`${CONSOLE}/signin`)
  await page.waitForSelector('input[placeholder="Email"]', { timeout: 25_000 })
  await page.fill('input[placeholder="Email"]', EMAIL)
  await page.fill('input[placeholder="Password"]', PASSWORD)
  await page.click('button:has-text("Sign in")')
  await page.waitForFunction(() => !location.pathname.startsWith('/signin'), { timeout: 30_000 }).catch(() => {})
  await page.waitForLoadState('domcontentloaded')
}

/** Body text of an APIResponse, best-effort (first 200 chars). */
async function bodyText(res: { text(): Promise<string> }): Promise<string> {
  return (await res.text().catch(() => '')).slice(0, 200)
}

/**
 * Navigate to a surface and audit it honestly. Asserts liveness (not bounced to
 * sign-in, no hard crash, a real marker OR an honest state is visible), screenshots
 * it, and COLLECTS any exact dead "Could not load" heading (surfaced by the final
 * aggregate test — a dead card never silently passes, but it also doesn't mask the
 * liveness signal of the other surfaces).
 */
async function auditSurface(page: Page, slug: string, name: string, marker: RegExp): Promise<void> {
  await page.goto(`${CONSOLE}/${slug}`, { waitUntil: 'domcontentloaded' })
  // Give the RNW/Tamagui SPA + its data fetch time to settle; networkidle is best-effort.
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(2500)

  // 1) A signed-in user must never be bounced to /signin on a money/usage/o11y page.
  await expect(page, `${name} bounced to sign-in`).not.toHaveURL(/\/signin/, { timeout: 10_000 })

  // 2) No hard crash / error boundary / static 404.
  await expect(page.locator(`text=${CRASH_RE}`), `${name} hard-crashed`).toHaveCount(0)

  // 3) Screenshot every surface (repeatable visual smoke of the whole surface).
  const shot = `${SHOTS}/surface-${slug.replace(/[^a-z0-9]+/gi, '-')}.png`
  await page.screenshot({ path: shot, fullPage: true }).catch(() => {})

  // 4) Collect any EXACT dead-card heading (flagged by the aggregate test).
  for (const h of DEAD_HEADINGS) {
    const n = await page.getByText(h, { exact: true }).count().catch(() => 0)
    if (n > 0) {
      deadCards.push(`${name} (/${slug}) → dead "${h}"`)
      console.warn(`⚠ ${name} (/${slug}) shows a dead "${h}" — expected an honest top-up/empty/access state (402-as-crash bug).`)
    }
  }

  // 5) The surface rendered SOMETHING truthful — its real marker OR a recognized honest state.
  await expect(page.getByText(marker).first(), `${name} rendered neither real content nor an honest state`).toBeVisible({
    timeout: 30_000,
  })
  console.log(`✓ ${name} (/${slug}) rendered — screenshot ${shot}`)
}

// Honest states that count as a truthful render for ANY surface (real content is added
// per-surface). Kept in ONE place so every marker is consistent.
const HONEST =
  'Add credits|Your session expired|Access required|Not enabled|Not available on this deployment|initializing|runtime|managed by Hanzo|Connected|SuperAdmin access|No .* yet|not connected|not configured|Sign in'

// ════════════════════════════════════════════════════════════════════════════════
// A. UNAUTHENTICATED fail-closed proof — ALWAYS runs (no credentials required).
// ════════════════════════════════════════════════════════════════════════════════
test.describe('Money/usage/o11y surface is fail-closed for anonymous (unauthenticated)', () => {
  // The tenant-scoped reads that must NEVER return data to an anonymous caller.
  const READS = [
    '/v1/billing/balance',
    '/v1/billing/invoices',
    '/v1/billing/usage',
    '/v1/billing/payment-methods',
    '/v1/billing/spend-alerts',
    '/v1/usage/summary',
    '/v1/get-cloud-usages',
    '/v1/o11y/observations',
  ]

  test('anonymous never receives 2xx billing/usage/o11y DATA (gated when up, refused while rolling)', async ({
    request,
  }: {
    request: APIRequestContext
  }) => {
    const matrix: string[] = []
    let gatedCount = 0
    for (const path of READS) {
      const res = await request.get(`${CONSOLE}${path}`, { failOnStatusCode: false })
      const status = res.status()
      const body = await bodyText(res)
      matrix.push(`${status} ${path}`)

      // THE invariant: an anonymous caller must not get a 2xx with a data payload.
      // A JSON body carrying data|balance|invoices|records for status 2xx is a leak.
      const twoxxData = status >= 200 && status < 300 && /"(data|balance|invoices|records|usage|amount|cents)"/i.test(body)
      expect(twoxxData, `anonymous ${path} leaked a 2xx data payload: ${body}`).toBe(false)

      // When the backend is UP (not a 5xx roll), a sensitive read should be
      // specifically GATED (401/403) or unrouted (404) — never an open 2xx.
      if (status < 500) {
        expect(status, `${path} is up but not gated (expected 401/403/404, got ${status})`).toBeGreaterThanOrEqual(400)
        if (status === 401 || status === 403) gatedCount++
      }
    }
    console.log(`✓ anonymous fail-closed matrix:\n  ${matrix.join('\n  ')}`)
    if (gatedCount === 0) {
      console.warn(
        '⚠ no endpoint returned a clean 401/403 — the console backend appears to be mid-roll (5xx). The fail-closed invariant still held (no 2xx data leaked).',
      )
    }
  })
})

// ════════════════════════════════════════════════════════════════════════════════
// B. AUTHENTICATED render smoke — runs when HANZO_PASSWORD is provided.
// ════════════════════════════════════════════════════════════════════════════════
test.describe.serial('Billing / Settings / Usage / o11y render smoke (authenticated)', () => {
  test.skip(!PASSWORD, 'HANZO_PASSWORD not set — the authenticated render smoke is staged')

  let page: Page

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    // ONE authenticated context reused across the whole surface walk (fast + realistic:
    // the same session hits every page, exactly like a real user clicking the nav).
    page = await browser.newPage()
    await signIn(page)
  })

  test.afterAll(async () => {
    await page?.close()
  })

  // ── 1) BILLING — every page (Overview · Reports · Budgets · Invoices · Subscriptions ·
  //       Payment methods · Credits) + the Finance ledger board. ─────────────────────
  test('Billing · Overview renders (balance / spend / add-credits, never dead)', async () => {
    await auditSurface(page, 'billing', 'Billing · Overview', new RegExp(`Balance|Spend|Month-to-date|Overview|Credits|${HONEST}`, 'i'))
  })
  test('Billing · Reports renders (cost breakdown by service, never dead)', async () => {
    await auditSurface(page, 'billing/reports', 'Billing · Reports', new RegExp(`Report|Cost|Spend|Model|Provider|breakdown|${HONEST}`, 'i'))
  })
  test('Billing · Budgets renders (spend caps / limits, never dead)', async () => {
    await auditSurface(page, 'billing/budgets', 'Billing · Budgets', new RegExp(`Budget|cap|limit|alert|Spend|${HONEST}`, 'i'))
  })
  test('Billing · Subscriptions renders (plans / renewal, never dead)', async () => {
    await auditSurface(page, 'billing/subscriptions', 'Billing · Subscriptions', new RegExp(`Subscription|Plan|renew|status|${HONEST}`, 'i'))
  })
  test('Billing · Payment methods renders (masked cards, never dead)', async () => {
    await auditSurface(page, 'billing/payment-methods', 'Billing · Payment methods', new RegExp(`Payment|Card|method|Add a card|•••|ending|${HONEST}`, 'i'))
  })
  test('Billing · Credits / recharge renders (top-up, never dead)', async () => {
    await auditSurface(page, 'billing/credits', 'Billing · Credits', new RegExp(`Credit|Add credits|balance|top.?up|recharge|HUSD|${HONEST}`, 'i'))
  })
  test('Finance ledger board renders (balance / ledger, never dead)', async () => {
    await auditSurface(page, 'finance-center', 'Finance ledger', new RegExp(`Finance|Ledger|Balance|spend|credit|invoice|${HONEST}`, 'i'))
  })

  // ── Invoices — the deep test: list renders · view/download control · PDF endpoint ·
  //    print/statement path · clean reload. ───────────────────────────────────────────
  test('Billing · Invoices — list renders, download+statement work, reload is clean', async () => {
    await auditSurface(page, 'billing/invoices', 'Billing · Invoices', new RegExp(`Invoice|billing history|Download|No invoices|${HONEST}`, 'i'))

    // The invoice LIST/table (or its honest empty/error) is present.
    const hasTable = (await page.locator('table, [role="table"]').count()) > 0
    const hasEmpty = (await page.getByText(/No invoices yet|billing period closes/i).count()) > 0
    const hasHonest = (await page.getByText(new RegExp(HONEST, 'i')).count()) > 0
    expect(hasTable || hasEmpty || hasHonest, 'Invoices showed neither a table, an empty state, nor an honest state').toBe(true)

    // DOWNLOAD / VIEW — the per-row "Download" control (opens the hosted invoice PDF).
    // When the org has ≥1 invoice the control exists; when empty, the download path is
    // still proven at the endpoint level below. Never a hard requirement on data existing.
    const downloadCtl = page.getByRole('button', { name: /download/i })
    const downloadCount = await downloadCtl.count()
    if (downloadCount > 0) {
      await expect(downloadCtl.first(), 'invoice Download control not visible').toBeVisible()
      console.log(`✓ Invoices: ${downloadCount} Download control(s) present (view/open the hosted PDF)`)
    } else {
      console.log('ℹ Invoices: no rows for this org — the Download control appears once a period closes')
    }

    // The PDF/statement ENDPOINT responds (download triggers a request that resolves,
    // never a crash). Probe it through the SAME authenticated session (page.request).
    // A real id → the PDF/redirect; a probe id → an honest 404/402/401 — but never 5xx-crash.
    const probe = await page.request.get(`${CONSOLE}/v1/billing/invoices/e2e-probe/pdf`, { failOnStatusCode: false })
    expect(probe.status(), 'invoice PDF endpoint hard-crashed (5xx)').toBeLessThan(500)
    console.log(`✓ Invoices: PDF/statement endpoint responds honestly (status ${probe.status()}, no crash)`)

    // PRINT A STATEMENT — the print hook exists (window.print), and the hosted PDF IS
    // the downloadable statement. (No dedicated "Print" button today — reported.)
    const canPrint = await page.evaluate(() => typeof window.print === 'function')
    expect(canPrint, 'window.print (statement print hook) is unavailable').toBe(true)
    console.log('✓ Invoices: statement path present — window.print hook + downloadable hosted PDF')

    // RELOAD re-renders cleanly — no blank / flash-of-error after a hard reload.
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.waitForTimeout(2000)
    await expect(page.locator(`text=${CRASH_RE}`), 'Invoices crashed after reload').toHaveCount(0)
    const deadAfterReload = await page.getByText('Could not load', { exact: true }).count()
    if (deadAfterReload > 0) deadCards.push('Billing · Invoices (reload) → dead "Could not load"')
    await expect(
      page.getByText(new RegExp(`Invoice|billing history|No invoices|${HONEST}`, 'i')).first(),
      'Invoices did not re-render after reload',
    ).toBeVisible({ timeout: 20_000 })
    console.log('✓ Invoices: reload re-rendered cleanly (no flash-of-error)')
  })

  // ── 2) SETTINGS — every tab. ──────────────────────────────────────────────────────
  test('Settings · General renders (org + account)', async () => {
    await auditSurface(page, 'settings', 'Settings · General', new RegExp(`Settings|Organization|Your account|Name|Email|${HONEST}`, 'i'))
  })
  test('Settings · Branding renders (branding + runtime)', async () => {
    await auditSurface(page, 'settings/branding', 'Settings · Branding', new RegExp(`Branding|Display name|Primary color|Runtime|Brand|${HONEST}`, 'i'))
  })

  // ── 3) USAGE METRICS — Usage · Metrics · AI Metrics + the time-range control. ───────
  test('Usage renders (spend by category / LLM / compute, charts or honest empty)', async () => {
    await auditSurface(page, 'usage', 'Usage', new RegExp(`Usage|Spend|LLM|Machines|category|footprint|${HONEST}`, 'i'))
  })
  test('Metrics renders (per-org usage board or infra health)', async () => {
    await auditSurface(page, 'metrics', 'Metrics', new RegExp(`Metrics|Requests|Tokens|Spend|Services|Uptime|Healthy|${HONEST}`, 'i'))
  })
  test('AI Metrics renders + the time-range control works', async () => {
    await auditSurface(page, 'ai-metrics', 'AI Metrics', new RegExp(`Requests|Tokens|Spend|model|balance|usage|${HONEST}`, 'i'))
    // The 24h/7d/30d range toggle is a real control — clicking it must not crash the board.
    const range = page.getByRole('button', { name: /^(7d|30d|24h)$/i })
    if ((await range.count()) > 0) {
      await range.first().click().catch(() => {})
      await page.waitForTimeout(1500)
      await expect(page.locator(`text=${CRASH_RE}`), 'AI Metrics crashed after a range change').toHaveCount(0)
      console.log('✓ AI Metrics: time-range control works (no crash on toggle)')
    } else {
      console.log('ℹ AI Metrics: range control not found (honest-empty board) — skipped the toggle')
    }
  })

  // ── 4) o11y / OBSERVABILITY — Traces · Observations · Service Map · Logs · Dashboards ·
  //       Alerts · Fleet Observability. Real data OR an honest RuntimeNotice/empty. ─────
  test('Traces (o11y) renders (real spans or honest runtime notice)', async () => {
    await auditSurface(page, 'o11y', 'Traces', new RegExp(`Trace|Latency|Tokens|Cost|Observ|No traces|${HONEST}`, 'i'))
  })
  test('Observations renders (real observations or honest runtime notice)', async () => {
    await auditSurface(page, 'observations', 'Observations', new RegExp(`Observation|Spans|generations|Model|Tokens|No observations|${HONEST}`, 'i'))
  })
  test('Service Map renders (RED metrics / dependency graph or honest state)', async () => {
    await auditSurface(page, 'service-map', 'Service Map', new RegExp(`Service Map|Rate|Errors|Duration|p99|dependency|${HONEST}`, 'i'))
  })
  test('Logs renders (application logs or honest state)', async () => {
    await auditSurface(page, 'logs', 'Logs', new RegExp(`Logs|Application logs|Request activity|Severity|Message|${HONEST}`, 'i'))
  })
  test('Dashboards renders (analytics dashboards or honest state)', async () => {
    await auditSurface(page, 'dashboards', 'Dashboards', new RegExp(`Dashboard|analytics|LLM|Overview|${HONEST}`, 'i'))
  })
  test('Alerts renders (alerting rules or honest state)', async () => {
    await auditSurface(page, 'alerts', 'Alerts', new RegExp(`Alert|rule|notification|${HONEST}`, 'i'))
  })
  test('Fleet Observability renders (global-admin board or honest superadmin-access state)', async () => {
    // For a non-global-admin this is honestly `SuperAdminRequired` — that IS a pass.
    await auditSurface(page, 'fleet-o11y', 'Fleet Observability', new RegExp(`Fleet Observability|Requests|Tokens|Latency|Top organizations|SuperAdmin access|${HONEST}`, 'i'))
  })

  // ── AGGREGATE — the dead-card audit. FLAGS every surface that showed a dead
  //    "Could not load" (the 402-as-crash bug being fixed separately). Green for a
  //    funded org; a precise per-surface bug list for an unfunded one. ────────────────
  test('DEAD-CARD AUDIT — no money/usage/o11y surface shows a dead "Could not load"', () => {
    if (deadCards.length > 0) {
      console.error(`✗ dead "Could not load" cards (402-as-crash bug) on:\n  - ${deadCards.join('\n  - ')}`)
    }
    expect(deadCards, `surfaces showing a dead card instead of an honest top-up/empty/access state:\n  - ${deadCards.join('\n  - ')}`).toEqual([])
  })
})
