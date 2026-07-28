/**
 * e2e: admin.hanzo.ai AI Economics board (feat/ai-economics).
 *
 * TWO layers, mirroring provider-billing.spec:
 *   (A) FIXTURE render — runs against a LOCAL server (BASE_URL=http://localhost:4000)
 *       with the network mocked: `/auth/session` → a global admin so the admin shell
 *       mounts, and the reads (`/v1/admin/usage/funding`, `/v1/admin/finance`,
 *       `/v1/admin/providers/credit`, `/v1/evals/{datasets,runs,evaluators}`) → a
 *       fixture where fable-5 is exactly 75% of requests and gross margin is 62%.
 *       Proves: the page renders, the model-mix table shows the mocked rows WITH the
 *       request-share %, the margin card shows the mocked grossMarginPct, and the
 *       honest "no traffic is harvested" training-data card renders. Desktop + mobile.
 *   (B) LIVE — the fail-closed gate proof (`/v1/admin/*` → >=401 unauthenticated)
 *       against the same origin; needs no credentials, always runs.
 *
 * Run fixture: BASE_URL=http://localhost:4000 npx playwright test ai-economics
 */
import { test, expect, type Route, type Page } from '@playwright/test'
import { requireFixtureServer } from './_fixture'
import { primeSession } from './_session'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4000'

// These render specs assert LOCAL fixture data; skip cleanly when that server is down.
requireFixtureServer()
const SHOTS = join(process.cwd(), 'e2e-shots')

// A SuperAdmin via the isGlobalAdmin/isSuperAdmin CLAIM (what the `admin: true` module
// gates on). owner is a normal org so Scope resolves locally instead of demanding a
// pick from the (mocked-empty) org list.
// owner === the reserved `admin` org IS the SuperAdmin signal the client gate reads
// (`isSuperAdminOwner` / IAM `User.IsSuperAdmin` — the isGlobalAdmin/isSuperAdmin claim
// fields are NOT read), so the `admin: true` module renders instead of the managed notice.
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

/** GET /v1/admin/usage/funding — the model mix: fable-5 = 750/1000 requests (75%),
 *  gpt-5.6 = 200 (20%), ds4-flash = 30, ds4-pro = 20. One row per (provider,model,funding). */
const FUNDING = [
  { provider: 'do-ai', model: 'fable-5', funding: 'credit', tokens: 4_800_000, cost_cents: 18_200, requests: 600 },
  { provider: 'do-ai', model: 'fable-5', funding: 'paid', tokens: 1_200_000, cost_cents: 6_100, requests: 150 },
  { provider: 'openrouter', model: 'gpt-5.6', funding: 'paid', tokens: 900_000, cost_cents: 44_000, requests: 200 },
  { provider: 'openrouter', model: 'ds4-flash', funding: 'paid', tokens: 120_000, cost_cents: 900, requests: 30 },
  { provider: 'openrouter', model: 'ds4-pro', funding: 'paid', tokens: 80_000, cost_cents: 3_100, requests: 20 },
]

/** GET /v1/admin/finance — the casibase-enveloped finance aggregate; grossMarginPct 62. */
const FINANCE = {
  status: 'ok',
  msg: '',
  data: {
    cost: { configured: true, error: '', period: '2026-07', totalCents: 3_800_000, vendors: [], digitalocean: { configured: true, error: '', creditRemainingCents: 2_418_000, monthToDateSpendCents: 41_200, avgDailyBurnCents: 20_100, accountBalanceCents: -2_418_000, generatedAt: '', history: [] } },
    revenue: { configured: true, totalRevenueCents: 10_000_000, mrrCents: 820_000, creditsConsumedCents: 120_000 },
    derived: { grossMarginCents: 6_200_000, grossMarginPct: 62, runwayDays: 120, profitable: true },
    generatedAt: '2026-07-15T00:00:00Z',
  },
}

/** GET /v1/admin/providers/credit — the DO grant + a paid-only provider. */
const CREDIT = [
  { provider: 'do-ai', grant_cents: 2_600_000, burn_cents: 41_200, remaining_cents: 2_418_000, runway_days: 58, has_credit: true, is_paid_only: false },
  { provider: 'openrouter', grant_cents: 100_000, burn_cents: 21_000, remaining_cents: 62_500, runway_days: 3, has_credit: true, is_paid_only: false },
]

/** GET /v1/evals/datasets — user-curated registry: 2 datasets, 150 items. */
const DATASETS = { data: [
  { name: 'router-quality', description: 'router routing quality', items: 120, createdAt: '2026-07-08T00:00:00Z' },
  { name: 'safety-redteam', description: 'safety judgments', items: 30, createdAt: '2026-07-02T00:00:00Z' },
] }

/** GET /v1/evals/runs — recent LLM-as-judge runs with an average score. */
const RUNS = { data: [
  { dataset: 'router-quality', runName: 'rq-2026-07-10', model: 'fable-5', judgeModel: 'claude-opus-4.6', items: 120, scored: 120, avgScore: 0.87, createdAt: '2026-07-10T00:00:00Z' },
  { dataset: 'safety-redteam', runName: 'sr-2026-07-04', model: 'gpt-5.6', judgeModel: 'claude-opus-4.6', items: 30, scored: 30, avgScore: 0.93, createdAt: '2026-07-04T00:00:00Z' },
] }

/** GET /v1/evals/evaluators. */
const EVALUATORS = { data: [{ name: 'quality-judge', model: 'claude-opus-4.6', criteria: 'routing quality', scoreName: 'quality' }] }

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
  // The economics reads. funding/credit are bare arrays (restGet + pluckList); finance
  // is the casibase envelope (originGet unwraps `data`); evals are `{data:[...]}`.
  const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  if (path === '/v1/admin/usage/funding') return json(FUNDING)
  if (path === '/v1/admin/finance') return json(FINANCE)
  if (path === '/v1/admin/providers/credit') return json(CREDIT)
  if (path === '/v1/evals/datasets') return json(DATASETS)
  if (path === '/v1/evals/runs') return json(RUNS)
  if (path === '/v1/evals/evaluators') return json(EVALUATORS)

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
      localStorage.setItem('hz_onboarding_done:' + org, '1') // skip the first-run wizard
      localStorage.setItem('hz_admin_banner_dismissed', '1')
    } catch {
      /* private mode */
    }
  }, ACCOUNT.owner)
  await page.route('**/*', mock)
  await primeSession(page, ACCOUNT)
  await page.goto(`${BASE_URL}/ai-economics`, { waitUntil: 'domcontentloaded' })
  const content = page.locator('[data-testid="product-content"]').first()
  await content.waitFor({ state: 'attached', timeout: 20_000 })
  await expect(content.getByTestId('ai-economics')).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(700)
}

test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }))

// ─── (A) fixture render ───────────────────────────────────────────────────────
test.describe('(A) fixture render — model mix (fable-5 75%) + 62% margin + honest training card', () => {
  test('renders the model mix, share %, margin, and the honest training-data card (desktop)', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await ctx.newPage()
    await openBoard(page)

    // Page rendered (not the operator gate).
    await expect(page.getByText('AI Economics').first()).toBeVisible()
    await expect(page.locator('text=/SuperAdmin access required|not authorized|access denied/i')).toHaveCount(0)

    // (a) model mix — the mocked rows WITH request-share %.
    const modelMix = page.getByTestId('model-mix')
    await expect(modelMix.getByText('Model mix').first()).toBeVisible()
    await expect(modelMix.getByText('fable-5').first()).toBeVisible()
    await expect(modelMix.getByText('gpt-5.6').first()).toBeVisible()
    await expect(modelMix.getByText('75%').first()).toBeVisible() // fable-5 = 750/1000 requests
    await expect(modelMix.getByText('20%').first()).toBeVisible() // gpt-5.6 = 200/1000

    // (b) profitability — the mocked grossMarginPct.
    const margin = page.getByTestId('margin-card')
    await expect(margin.getByText('+62% margin').first()).toBeVisible()

    // (c) training data — the honest "no traffic harvested" collection card + real counts.
    const training = page.getByTestId('training-collection-card')
    await expect(training).toBeVisible()
    await expect(training.getByText(/No traffic is harvested for training/i)).toBeVisible()
    await expect(page.getByText('Eval datasets').first()).toBeVisible()

    await page.screenshot({ path: join(SHOTS, 'ai-economics-desktop.png'), fullPage: true })
    await ctx.close()
  })

  test('reflows with no horizontal body scroll at a narrow (mobile) viewport', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await ctx.newPage()
    await openBoard(page)

    await expect(page.getByTestId('model-mix').getByText('fable-5').first()).toBeVisible()
    const overflow = await page.evaluate(() => {
      const el = document.documentElement
      return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }
    })
    expect(overflow.scrollWidth, 'no horizontal body scroll at 390px').toBeLessThanOrEqual(overflow.clientWidth + 1)

    await page.screenshot({ path: join(SHOTS, 'ai-economics-mobile.png'), fullPage: true })
    await ctx.close()
  })
})

// ─── (B) fail-closed gate — always runs, no credentials ───────────────────────
test.describe('(B) admin gate fail-closed', () => {
  test('/v1/admin/{usage/funding,finance,providers/credit} → fail-closed unauthenticated', async ({ request }) => {
    for (const p of ['usage/funding', 'finance', 'providers/credit']) {
      const res = await request.get(`${BASE_URL}/v1/admin/${p}`)
      // A raw request (no page mocks, no session) NEVER gets data: the console's
      // getAdminGate is fail-closed. Post-deploy this is the 403 global-admin gate;
      // before a sibling route deploys it may 404 — both are "not open". Never 200.
      expect(res.status(), `${BASE_URL}/v1/admin/${p} must be fail-closed (>=401)`).toBeGreaterThanOrEqual(401)
      expect(res.status(), `${BASE_URL}/v1/admin/${p} must not 5xx`).toBeLessThan(500)
    }
  })
})
