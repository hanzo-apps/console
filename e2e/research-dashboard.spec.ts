import { expect, test } from '@playwright/test'

/**
 * The research dashboard — every benchmark run and its verdict.
 *
 * What this file can and cannot prove, stated plainly, because the difference is the
 * whole value:
 *
 * The console is a SPA behind a catch-all, so EVERY path returns HTTP 200 — including
 * `/definitely-not-a-page`. A test asserting "200" or "the page loaded" passes even when
 * the route is deleted. And `/research` is behind `AuthGate`, so an anonymous visitor is
 * redirected to sign-in and sees NEITHER the dashboard NOR the SuperAdmin gate. Measured,
 * not assumed: the body reads "Sign in to your account".
 *
 * So the two tests that RUN here prove security and routing, not rendering:
 *   - anonymous callers see no corpus data (the gate genuinely holds)
 *   - a nonsense path renders no dashboard (the assertion above can fail)
 * Proving the dashboard PAINTS needs a SuperAdmin session, so that test is staged behind
 * HANZO_PASSWORD rather than faked — the same staging `insights-o11y.spec.ts` uses.
 *
 * Run: BASE_URL=https://cloud.hanzo.ai npx playwright test research-dashboard
 */

const BASE_URL = process.env.BASE_URL ?? 'https://cloud.hanzo.ai'

/** Copy rendered ONLY by ResearchModule. */
const DASHBOARD = /Falsifiable R&D experiments/i
/** Corpus numbers. Never visible to a caller who is not a SuperAdmin. */
const CORPUS = [/\bProven\b/, /\bRefuted\b/, /\bAttempts\b/]

async function settle(page: import('@playwright/test').Page) {
  await page.waitForLoadState('domcontentloaded')
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
}

test.describe('research dashboard', () => {
  test('an anonymous caller sees no corpus data', async ({ page }) => {
    // The security assertion. The module gates on useIsSuperAdmin and the `research`
    // head is org-scoped server-side by the Bearer owner — so an unauthenticated
    // visitor must reach sign-in with zero experiment counts painted. A client-only
    // gate that rendered the KPI band behind a card would fail here.
    await page.goto(`${BASE_URL}/research`)
    await settle(page)
    const body = page.locator('body')

    // ANCHOR FIRST. Every assertion below is an absence, and an absence is satisfied by
    // a blank page, a 502, or a dead host — so prove the app actually rendered before
    // claiming the gate held. Without this the test passes while the site is down.
    await expect(
      body.getByText(/Sign in|Log in/i).first(),
      'the console shell did not render — the absence assertions below would be vacuous',
    ).toBeVisible({ timeout: 15_000 })

    for (const label of CORPUS) {
      await expect(
        body.getByText(label),
        `"${label}" rendered to an anonymous caller — corpus data leaked past the gate`,
      ).toHaveCount(0)
    }
    await expect(
      body.getByText(DASHBOARD),
      'the dashboard rendered to an anonymous caller — the auth gate is not holding',
    ).toHaveCount(0)
  })

  test('is not a catch-all — a nonsense path renders no dashboard', async ({ page }) => {
    // The control that gives the authenticated test (below) its meaning: the SPA
    // answers 200 here too, so if this path could show the research surface, matching
    // on that copy would prove nothing about routing.
    await page.goto(`${BASE_URL}/definitely-not-a-page-9137`)
    await settle(page)

    // Same anchor: the app must have rendered for "no dashboard here" to mean anything.
    await expect(
      page.locator('body').getByText(/Sign in|Log in/i).first(),
      'the console shell did not render — the absence assertion below would be vacuous',
    ).toBeVisible({ timeout: 15_000 })

    await expect(
      page.locator('body').getByText(DASHBOARD),
      'a nonsense path rendered the research dashboard — matching on that copy proves nothing',
    ).toHaveCount(0)
  })

  test('renders the corpus for a SuperAdmin', async ({ page }) => {
    // STAGED, not skipped-and-forgotten: needs the reserved-admin SuperAdmin
    // credential, which lives in KMS and not on a dev host. With it, this is the
    // assertion that actually proves the dashboard paints real evidence.
    const password = process.env.HANZO_PASSWORD
    test.skip(!password, 'set HANZO_PASSWORD (reserved-admin SuperAdmin) to run the render proof')

    await page.goto(`${BASE_URL}/signin`)
    await settle(page)
    await page.getByLabel(/email|username/i).first().fill(process.env.HANZO_USER ?? 'z@hanzo.ai')
    await page.getByLabel(/password/i).first().fill(password!)
    await page.getByRole('button', { name: /sign in|log in/i }).first().click()
    await page.waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 30_000 })

    await page.goto(`${BASE_URL}/research`)
    await settle(page)

    await expect(
      page.locator('body').getByText(DASHBOARD),
      'a SuperAdmin did not get the research dashboard',
    ).toHaveCount(1)
    await expect(page.locator('body').getByText(/\bExperiments\b/)).not.toHaveCount(0)
  })
})
