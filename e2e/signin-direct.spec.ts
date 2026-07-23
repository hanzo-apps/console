/**
 * e2e regression — a DIRECT load of /signin renders the sign-in form.
 *
 * ROOT CAUSE this guards: the deploy (the go:embed'd static console in hanzoai/cloud)
 * serves the SPA shell (the `/` route's index.html) for EVERY path — verified live:
 * GET / and GET /signin return byte-identical HTML. So a direct /signin load mounts the
 * dashboard tree (Auth), NOT the /signin route. Before the fix, Auth saw no
 * account and called `router.replace('/signin')`, a NO-OP at /signin, and spun on the
 * loader forever (inputs=0, buttons=0). Reaching /signin as a REDIRECT target (from
 * `/`, `/projects`, …) worked because the URL changed. This asserts the direct entry
 * now resolves to the form. The fix: Auth + the /signin route both render the ONE
 * `<SignIn/>` component, so /signin resolves to the form without depending on a nav.
 *
 * Runs LOGGED OUT (a fresh context): the live get-account is anonymous → not signed in.
 * Works against the live console (BASE_URL default) OR a local SPA-fallback server
 * (BASE_URL=http://localhost:4173 serving out/ with index.html as the catch-all).
 */
import { test, expect } from '@playwright/test'

const BASE_URL = process.env.BASE_URL ?? 'https://console.hanzo.ai'

test.describe('direct /signin renders the sign-in form (SPA-fallback regression)', () => {
  test('a hard load of /signin shows inputs + buttons, not an infinite spinner', async ({ browser }) => {
    // Fresh, cookie-less context → a logged-out visitor (anonymous get-account).
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await ctx.newPage()

    await page.goto(`${BASE_URL}/signin`, { waitUntil: 'domcontentloaded' })

    // The credential form: email + password inputs and at least one button. A few
    // seconds is ample — a spinner that never resolves is the bug.
    const emailInput = page.getByPlaceholder('Email')
    await expect(emailInput).toBeVisible({ timeout: 15_000 })
    await expect(page.getByPlaceholder('Password')).toBeVisible()
    expect(await page.locator('input').count()).toBeGreaterThanOrEqual(2)
    expect(await page.locator('button').count()).toBeGreaterThanOrEqual(1)

    await page.screenshot({ path: 'e2e-shots/signin-direct.png' })
    await ctx.close()
  })
})
