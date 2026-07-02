/**
 * Per-tenant billing DATA proxy → commerce. The browser calls console2's OWN origin
 * (`/billing/v1/...`); this server handler forwards to commerce's `/v1/billing/...`,
 * injecting the commerce SERVICE token from server-only env (never `NEXT_PUBLIC_`,
 * never in the browser bundle) AND scoping every request to the caller's OWN org.
 *
 * Namespaced under `/billing/v1/` (NOT bare `/billing/`) so the data plane never
 * shadows the billing UI tab URLs (`/billing/reports`, `/billing/invoices`, …): a
 * route handler always wins over the catch-all page for a matching path segment, so
 * the tab slugs and the data endpoints must live in disjoint path space. The tab
 * URLs now fall through to the SPA (`app/(dashboard)/[...slug]`).
 *
 * Same trust boundary as the `/admin/iam` + `/admin/kms` proxies, but the authz is
 * PER-TENANT, not admin: any authenticated session may read/act on ITS OWN billing
 * (balance / usage / invoices / credit-grants / subscriptions / payment-methods).
 * The org is resolved server-side from the validated session (`resolveUser`) and
 * stamped as `X-Org-Id` (the header commerce's service-token path actually reads —
 * `commerce/middleware/accesstoken.go`), and the server-resolved billing subject is
 * pinned onto the FULL commerce subject-key set (`user`/`userId`/`customerId`, via
 * `scopedBillingSearch`) while `?org=` is dropped. The client CANNOT widen scope: a
 * forged `?userId=`/`?customerId=`/`?org=` is overwritten, and because EVERY subject
 * param is pinned, no billing endpoint is left unfiltered regardless of which one it
 * reads (subscriptions filter `userId`, payment-methods `customerId`). So commerce's
 * per-tenant isolation can never be crossed from the browser. No session → 401.
 *
 * Billing-subject mirrors `object.BillingSubject` (hanzoai/ai) + chat's
 * `billingSubject`: a member of a PERSONAL-billing org (default the shared `hanzo`
 * catch-all) bills per-user as `<org>/<name>`; a dedicated org (maxpower, …) bills
 * per-org as `<org>`. The SAME subject the gateway debits — so the console shows
 * the exact balance/usage that gets charged.
 *
 * `COMMERCE_TOKEN` unset → honest 501 (the UI shows a truthful "not configured"
 * state; it never fabricates a balance).
 */
import { type NextRequest, NextResponse } from 'next/server'

import { resolveUser } from '~/lib/server/identity'
import { billingSubject, scopedBillingSearch, scopedBillingBody } from '~/lib/server/billing-scope'
import { fetchWithTimeout } from '~/lib/server/fetch-timeout'

export const runtime = 'nodejs'

const isSafeSegment = (s: string): boolean =>
  s.length > 0 && s !== '.' && s !== '..' && !s.includes('/') && !s.includes('\\') && !s.includes('\0')

function commerceBaseUrl(): string {
  return (process.env.COMMERCE_URL ?? 'http://commerce.hanzo.svc:8001').replace(/\/+$/, '')
}

async function forward(req: NextRequest, path: string[]): Promise<NextResponse> {
  // Per-tenant authz: any valid session may see ITS OWN billing (no admin gate).
  const user = await resolveUser(req)
  if (!user) {
    return NextResponse.json({ error: 'Sign in to view billing.' }, { status: 401 })
  }
  if (!path.every(isSafeSegment)) {
    return NextResponse.json({ error: 'Invalid billing path.' }, { status: 400 })
  }

  const token = process.env.COMMERCE_TOKEN ?? process.env.COMMERCE_SERVICE_TOKEN ?? ''
  if (!token) {
    return NextResponse.json(
      { error: 'Billing is not configured (COMMERCE_TOKEN missing).' },
      { status: 501 },
    )
  }

  // Scope to the caller's OWN org — server-resolved, never client-supplied.
  const org = user.owner.trim()
  const subject = billingSubject(org, user.name)

  // Pin the FULL billing-subject key set to the server-resolved subject, and
  // strip `org`, so the browser can never read another tenant's ledger. Commerce
  // filters each endpoint on a DIFFERENT param — subscriptions on `userId`,
  // payment-methods on `customerId` (or `user`), usage on `user` — so pinning
  // only ONE param leaves the others unfiltered (a cross-tenant read). This
  // mirrors commerce's own edge-auth `billingSubjectKeys`
  // (commerce/middleware/edgeauth.go: {"user","userId","customerId"}) exactly, so
  // every billing endpoint is scoped no matter which param it reads.
  const qs = scopedBillingSearch(req.nextUrl.search, subject)
  const url = `${commerceBaseUrl()}/v1/billing/${path.join('/')}${qs ? `?${qs}` : ''}`

  const init: RequestInit = {
    method: req.method,
    headers: {
      Authorization: `Bearer ${token}`,
      // Commerce resolves the tenant namespace from `X-Org-Id` on the service-token
      // path (commerce/middleware/accesstoken.go). It does NOT read `X-Hanzo-Org`,
      // so sending that alone silently falls back to the service org — every tenant
      // sharing one namespace. Send `X-Org-Id`, matching the `/ai` proxy.
      'X-Org-Id': org,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    cache: 'no-store',
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    // Scope the WRITE body to the caller's OWN subject too (not just the query):
    // commerce reads the subject from the JSON body on writes like create-spend-alert
    // (`userId`), so pin it server-side — the browser needn't know its subject and a
    // forged body subject cannot widen scope. Mirrors `scopedBillingSearch`.
    init.body = scopedBillingBody(await req.text(), subject)
  }
  try {
    const res = await fetchWithTimeout(url, init)
    const text = await res.text()
    return new NextResponse(text, {
      status: res.status,
      headers: {
        'Content-Type': res.headers.get('content-type') ?? 'application/json',
        // A per-tenant money response (balance/usage/invoices) must NEVER be cached
        // by the browser or any intermediary — otherwise the wallet shows a stale
        // number after a completion or a top-up. The live-balance store still polls,
        // but this guarantees each fetch hits commerce, not a cache.
        'Cache-Control': 'no-store, must-revalidate',
      },
    })
  } catch (e) {
    return NextResponse.json(
      { error: `Billing upstream unreachable: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    )
  }
}

type Ctx = { params: Promise<{ path: string[] }> }

export async function GET(req: NextRequest, ctx: Ctx) {
  return forward(req, (await ctx.params).path)
}
export async function POST(req: NextRequest, ctx: Ctx) {
  return forward(req, (await ctx.params).path)
}
