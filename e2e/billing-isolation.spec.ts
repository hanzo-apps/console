/**
 * e2e: two-tenant BILLING ISOLATION through the `/v1/billing/*` proxy.
 *
 * The proxy (app/v1/billing/[...path]/route.ts) resolves the billing subject from the
 * session server-side and pins the full subject-key set (user/userId/customerId) +
 * the X-Org-Id header, so a tenant can only ever read its OWN commerce ledger. This
 * spec proves that end-to-end against the LIVE proxy: two accounts in DIFFERENT orgs
 * each fetch `/v1/billing/subscriptions` (and `/v1/billing/methods`), and we assert
 * the two result sets are disjoint — neither tenant can see the other's rows.
 *
 * This is the regression guard for the IDOR RED found (the proxy previously pinned
 * only `?user=` while commerce filters subscriptions on `?userId=`, so subscriptions
 * were returned across the whole namespace).
 *
 * Credentials (env, never in repo). Skips unless BOTH tenants are provided:
 *   TENANT_A_EMAIL / TENANT_A_PASSWORD  (org A)
 *   TENANT_B_EMAIL / TENANT_B_PASSWORD  (org B, a DIFFERENT org)
 *   BASE_URL  default https://console.hanzo.ai
 *
 * Run:  TENANT_A_EMAIL=.. TENANT_A_PASSWORD=.. TENANT_B_EMAIL=.. TENANT_B_PASSWORD=.. pnpm e2e billing-isolation.spec.ts
 */
import { test, expect, type Page } from '@playwright/test'

const BASE_URL = process.env.BASE_URL ?? 'https://console.hanzo.ai'
const A = { email: process.env.TENANT_A_EMAIL ?? '', password: process.env.TENANT_A_PASSWORD ?? '' }
const B = { email: process.env.TENANT_B_EMAIL ?? '', password: process.env.TENANT_B_PASSWORD ?? '' }

async function signIn(page: Page, email: string, password: string) {
  await page.goto(`${BASE_URL}/signin`)
  await page.waitForSelector('input[placeholder="Email"]', { timeout: 20_000 })
  await page.fill('input[placeholder="Email"]', email)
  await page.fill('input[placeholder="Password"]', password)
  await page.click('button:has-text("Sign in")')
  const base = new URL(BASE_URL).origin
  await page.waitForURL((url) => url.origin === base && url.pathname === '/', { timeout: 30_000 })
  await page.waitForLoadState('domcontentloaded')
}

/** Fetch a billing path through the same-origin DATA proxy (`/v1/billing/*`), as the
 *  signed-in browser. (`/billing/<slug>` is a UI tab, served by the SPA — it differs at
 *  the FIRST path segment, so the two never collide.) */
async function billing(page: Page, path: string): Promise<{ status: number; ids: string[] }> {
  return page.evaluate(async (p) => {
    const res = await fetch(`/v1/billing/${p}`, { credentials: 'include', headers: { Accept: 'application/json' } })
    let ids: string[] = []
    try {
      const body = await res.json()
      const rows = Array.isArray(body)
        ? body
        : (body?.subscriptions ?? body?.paymentMethods ?? body?.payment_methods ?? body?.invoices ?? body?.data ?? [])
      ids = (Array.isArray(rows) ? rows : [])
        .map((r: { id?: unknown }) => (typeof r?.id === 'string' ? r.id : ''))
        .filter(Boolean)
    } catch {
      /* non-JSON (e.g. 501 not-configured) — ids stays empty */
    }
    return { status: res.status, ids }
  }, path)
}

test.describe('billing is isolated per tenant through the proxy', () => {
  test.skip(
    !A.email || !A.password || !B.email || !B.password,
    'TENANT_A_* / TENANT_B_* not set — skipping two-tenant billing isolation',
  )

  test('two distinct-org tenants never see each other’s subscriptions or payment methods', async ({ browser }) => {
    const ctxA = await browser.newContext()
    const ctxB = await browser.newContext()
    const pageA = await ctxA.newPage()
    const pageB = await ctxB.newPage()

    await signIn(pageA, A.email, A.password)
    await signIn(pageB, B.email, B.password)

    // `invoices` is included because its row ids drive the per-invoice PDF URL
    // (`/v1/billing/invoices/:id/pdf`) — proving the invoice list is tenant-isolated
    // proves a user can only ever build a PDF URL for their OWN org's invoices.
    for (const path of ['subscriptions', 'methods', 'invoices']) {
      const a = await billing(pageA, path)
      const b = await billing(pageB, path)

      // A 401 would mean the session broke; a 501 means commerce isn't configured
      // on this deployment (isolation is vacuously safe — nothing is returned).
      expect(a.status, `tenant A /${path} not authorized`).not.toBe(401)
      expect(b.status, `tenant B /${path} not authorized`).not.toBe(401)

      if (a.status === 501 || b.status === 501) continue

      // The core isolation assertion: the two tenants' row-id sets are disjoint.
      const overlap = a.ids.filter((id) => b.ids.includes(id))
      expect(overlap, `/${path} leaked ${overlap.length} shared rows across tenants`).toEqual([])
    }

    await ctxA.close()
    await ctxB.close()
  })
})
