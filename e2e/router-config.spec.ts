/**
 * e2e: the per-org Router configuration panel (Router › Policy tab).
 *
 * Mocked-network render proof against a LOCAL server (same pattern as
 * budgets-responsive / models-surfaces): `/auth/session` → an admin so the shell
 * mounts, `GET /v1/ai/router/policy` → a real-shaped policy (allowlist + dial +
 * prefer + ceiling + the org's servable `available` set), everything else → an
 * empty-ok envelope.
 *
 * Why this exists: the panel is the ONE surface an org admin uses to (1) restrict
 * which models the auto-router may pick from, and (2) bias it between savings and
 * quality. A mocked unit suite can stay green while the page doesn't render, so this
 * asserts what only a browser can — that the allowlist chips + the savings↔quality
 * dial actually paint, that Select-all/Clear re-count live, and — the load-bearing
 * contract check — that Save PUTs `enabledModels` + `qualityBias` to
 * `/v1/ai/router/policy`.
 *
 * Run: BASE_URL=http://localhost:4010 npx playwright test router-config
 */
import { test, expect, type Route, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { requireFixtureServer } from './_fixture'
import { primeSession } from './_session'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4010'

// Render spec asserts LOCAL fixture data; skip cleanly when that server is down.
requireFixtureServer()
const SHOTS = join(process.cwd(), 'e2e-shots')
const DESKTOP = join(homedir(), 'Desktop')

const ORG = 'hanzo'

/**
 * The OIDC userinfo claims the @hanzo/iam SDK resolves the account from (the console's
 * current auth model — a valid access token in sessionStorage + a userinfo fetch, NOT
 * a `/auth/session` BFF). `accountFromClaims` projects these onto the Account.
 */
const CLAIMS = {
  sub: `${ORG}/z`,
  owner: ORG,
  name: 'z',
  email: 'z@hanzo.ai',
  displayName: 'Z Admin',
  type: 'normal-user',
  isAdmin: true,
}

/** A real-shaped router policy per the GET /v1/ai/router/policy contract. */
const POLICY = {
  prefer: { default: ['zen5'], code: ['zen5-coder'] },
  costCeiling: 0.003,
  enabledModels: ['gpt-4o-mini', 'enso'], // 2 of 4 → the allowlist is a restriction
  qualityBias: 0.75, // → "Favor quality" on the dial
  hasOverride: true,
  available: [
    { id: 'gpt-4o-mini', name: 'GPT-4o mini' },
    { id: 'enso', name: 'Enso' },
    { id: 'zen5-coder', name: 'Zen5 Coder' },
    { id: 'claude-haiku', name: 'Claude Haiku' },
  ],
}

const API_RE = /\/(v1|cloud|ai|billing|commerce|telemetry|vm|superbase|admin|paas|integrations|auth\/refresh)(\/|$|\?)/

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

/** Captured PUT body for /v1/ai/router/policy — the contract proof for the save path. */
let lastSaveBody: Record<string, unknown> = {}
let saved = false

async function mock(route: Route) {
  const req = route.request()
  if (req.resourceType() === 'document') return route.continue()
  const url = new URL(req.url())
  const path = url.pathname

  // @hanzo/iam OIDC: discovery → userinfo → the account claims (the current auth model).
  // Discovery is a cross-origin GET (to the IAM host) → the fulfilled response needs
  // an ACAO header to be readable; point `userinfo_endpoint` at the SAME origin so the
  // Bearer userinfo fetch is same-origin (no CORS preflight).
  if (path.endsWith('/.well-known/openid-configuration'))
    return route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
      body: JSON.stringify({
        issuer: 'https://hanzo.id',
        authorization_endpoint: 'https://hanzo.id/v1/iam/oauth/authorize',
        token_endpoint: 'https://hanzo.id/v1/iam/oauth/token',
        userinfo_endpoint: `${BASE_URL}/v1/iam/oauth/userinfo`,
        jwks_uri: 'https://hanzo.id/v1/iam/oauth/jwks',
      }),
    })
  if (path.endsWith('/v1/iam/oauth/userinfo')) return json(route, CLAIMS)
  if (path.startsWith('/auth/')) return json(route, { ok: true })

  // The page under test — the real router-policy contract (casibase envelope). ONE noun,
  // method-dispatched: GET /v1/ai/router/policy reads the effective policy; PUT upserts it.
  if (path.endsWith('/v1/ai/router/policy')) {
    if (req.method() === 'PUT') {
      try {
        lastSaveBody = JSON.parse(req.postData() ?? '{}')
      } catch {
        lastSaveBody = {}
      }
      saved = true
      // Echo the submitted policy back (merged with the read-only available set).
      return json(route, { status: 'ok', msg: '', data: { ...POLICY, ...lastSaveBody } })
    }
    return json(route, { status: 'ok', msg: '', data: POLICY })
  }

  const sameOrigin = url.origin === new URL(BASE_URL).origin
  if (sameOrigin && !API_RE.test(path)) return route.continue()
  return json(route, { status: 'ok', msg: '', data: [], data2: 0 })
}

/**
 * Open the Router › Policy tab and wait for the panel's CONTENT.
 *
 * `marker` must be a phrase unique to the panel body ("Enabled models"), not a bare
 * product title — a title also matches the hidden sidebar nav span on a narrow
 * viewport, which is never visible and would fail a rendered page.
 */
async function openPolicy(page: Page, marker = 'Enabled models') {
  await page.addInitScript((org) => {
    try {
      // A valid @hanzo/iam session: a non-expired access token in localStorage so the
      // SDK's getValidAccessToken() returns it (userinfo is network-mocked to CLAIMS).
      // Without a future `expires_at` the SDK treats the token as expired → anonymous.
      localStorage.setItem('hanzo_iam_access_token', 'mock-access-token')
      localStorage.setItem('hanzo_iam_expires_at', String(Date.now() + 3600000))

      localStorage.setItem('hanzo.console.org', org)
      // Scope shows the org PICKER until an org is explicitly entered — the scope
      // VALUE alone is not enough (lib/org-scope.ts hasSelectedOrg).
      localStorage.setItem('hanzo.console.org.selected', '1')
      localStorage.setItem('hz_admin_banner_dismissed', '1')
      // The first-run onboarding wizard is a full takeover that renders INSTEAD of the
      // product — mark it done or the page under test never mounts (lib/onboarding/guard.ts).
      localStorage.setItem(`hz_onboarding_done:${org}`, '1')
    } catch {
      /* private mode */
    }
  }, ORG)
  await page.route('**/*', mock)
  await primeSession(page)
  await page.goto(`${BASE_URL}/router/policy`, { waitUntil: 'domcontentloaded' })
  await page.locator('[data-testid="product-content"]').first().waitFor({ state: 'attached', timeout: 20_000 })
  await expect(page.locator(`text=${marker}`).first()).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(800)
}

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true })
  mkdirSync(DESKTOP, { recursive: true })
})

test('renders the router config panel — allowlist, savings↔quality dial, pools, ceiling', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await openPolicy(page)

  // The panel title + all four concerns render.
  await expect(page.locator('text=Router policy').first()).toBeVisible()
  await expect(page.locator('text=Enabled models').first()).toBeVisible()
  await expect(page.locator('text=Savings vs quality').first()).toBeVisible()
  await expect(page.locator('text=Task pools').first()).toBeVisible()
  await expect(page.locator('text=Cost ceiling').first()).toBeVisible()

  // The allowlist is populated from `available` (names shown), and the dial reflects
  // the loaded qualityBias=0.75 → "Favor quality". (Text locators — a selected chip
  // carries a Check icon that can perturb the button's accessible name.)
  await expect(page.locator('text=GPT-4o mini').first()).toBeVisible()
  await expect(page.locator('text=Claude Haiku').first()).toBeVisible()
  await expect(page.locator('text=2 of 4 models selected').first()).toBeVisible()
  await expect(page.locator('text=Favor quality').first()).toBeVisible()

  await page.screenshot({ path: join(SHOTS, 'router-config-desktop.png'), fullPage: true })
  await page.screenshot({ path: join(DESKTOP, 'router-config-panel.png'), fullPage: true })
  await ctx.close()
})

test('Select-all / Clear re-count live, and Save POSTs enabledModels + qualityBias', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  lastSaveBody = {}
  saved = false
  await openPolicy(page)

  // "All models" honesty: Clear → empty selection labelled as no restriction.
  await page.getByRole('button', { name: 'Clear', exact: true }).first().click()
  await expect(page.locator('text=All models are allowed').first()).toBeVisible()

  // Select all → the count reflects every servable model.
  await page.getByRole('button', { name: 'Select all', exact: true }).first().click()
  await expect(page.locator('text=4 of 4 models selected').first()).toBeVisible()

  // Save round-trips the FULL body — the load-bearing contract check.
  await page.getByRole('button', { name: 'Save', exact: true }).first().click()
  await page.waitForTimeout(800)
  expect(saved, 'Save PUT a body to /v1/ai/router/policy').toBe(true)
  expect(Array.isArray(lastSaveBody.enabledModels), 'enabledModels is an array').toBe(true)
  expect((lastSaveBody.enabledModels as string[]).slice().sort()).toEqual(
    ['claude-haiku', 'enso', 'gpt-4o-mini', 'zen5-coder'].sort(),
  )
  expect(typeof lastSaveBody.qualityBias, 'qualityBias is a number').toBe('number')
  expect(lastSaveBody.qualityBias).toBe(0.75)
  // prefer + costCeiling are preserved (round-tripped), not clobbered.
  expect(lastSaveBody.costCeiling).toBe(0.003)
  expect((lastSaveBody.prefer as Record<string, string[]>).code).toEqual(['zen5-coder'])

  await page.screenshot({ path: join(SHOTS, 'router-config-saved.png'), fullPage: true })
  await ctx.close()
})

test('reflows with no horizontal body scroll at a narrow (mobile) viewport', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  await openPolicy(page)

  await expect(page.locator('text=Enabled models').first()).toBeVisible()

  const overflow = await page.evaluate(() => {
    const el = document.documentElement
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }
  })
  expect(overflow.scrollWidth, 'no horizontal body scroll at 390px').toBeLessThanOrEqual(overflow.clientWidth + 1)

  await page.screenshot({ path: join(SHOTS, 'router-config-mobile.png'), fullPage: true })
  await page.screenshot({ path: join(DESKTOP, 'router-config-panel-mobile.png'), fullPage: true })
  await ctx.close()
})
