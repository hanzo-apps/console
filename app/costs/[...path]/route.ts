/**
 * Server-gated GLOBAL-admin vendor-COGS proxy → commerce `/v1/costs`.
 *
 * `/v1/costs` is a PLATFORM god-view: what WE pay our vendors (DigitalOcean, the
 * LLM providers we resell) across the whole business, beside revenue, to show
 * MARGIN. So — like the admin business OVERVIEW aggregate, and UNLIKE the
 * per-tenant `/billing` proxy — it MUST be gated to a GLOBAL admin BEFORE anything
 * is forwarded: a tenant customer (even an org-level `isAdmin`) must never read the
 * platform's vendor spend or margin.
 *
 * Defense in depth (the commerce-side gate — `middleware.TokenRequired(permission.
 * Admin)` on the service token — is a separate backend contract we can't test from
 * here): `getAdminGate` enforces the SAME policy the IAM/KMS + admin-aggregate
 * proxies use — a VERIFIED `@<brand.adminDomain>` email AND an IAM global-admin
 * flag, fail-closed (→ 403) on ANY miss. Only THEN do we forward to commerce with
 * the commerce SERVICE token from server-only env (never `NEXT_PUBLIC_`, never in
 * the browser bundle) and `X-Org-Id` pinned to the platform org.
 *
 * This is NOT a per-tenant read, so there is NO billing-subject scoping (that is
 * the `/billing` proxy's job): the COGS figures are platform-wide by definition and
 * only a global admin ever reaches them. Least privilege: only the `costs` read
 * heads are reachable (GET), and every path segment is validated (no traversal to
 * another commerce endpoint). `COMMERCE_TOKEN` unset → honest 501 (the board shows
 * a truthful "not configured" state; it never fabricates a cost).
 */
import { type NextRequest, NextResponse } from 'next/server'

import { getAdminGate } from '~/lib/server/identity'

export const runtime = 'nodejs'

/** Commerce base — the in-cluster ClusterIP (same default the `/billing` + `/commerce`
 *  proxies use). `?? default` matches those proxies; `.replace` trims a trailing slash. */
function commerceBaseUrl(): string {
  return (process.env.COMMERCE_URL ?? 'http://commerce.hanzo.svc:8001').replace(/\/+$/, '')
}

/** The platform org the vendor-cost ledger is namespaced under. Commerce resolves the
 *  tenant from `X-Org-Id` on the service-token path; the whole-platform COGS lives in
 *  the `hanzo` org. Overridable for a differently-named platform org. */
function platformOrg(): string {
  return (process.env.COSTS_ORG ?? process.env.HANZO_DEFAULT_ORG ?? 'hanzo').trim().toLowerCase()
}

/** The commerce cost read surface reachable through this proxy — least privilege.
 *  `costs` (the per-vendor breakdown) and `costs/margin` (revenue − COGS). Anything
 *  else 404s here, so the proxy can never become a general commerce tunnel. */
const ALLOWED = new Set(['costs', 'costs/margin'])

/** A path segment is safe iff it's a real name — no empty, dot-segment, slash, or
 *  percent-escape (a residual `%2e`/`%2f` is a multi-encoding traversal tell). */
const isSafeSegment = (s: string): boolean =>
  s.length > 0 && s !== '.' && s !== '..' && !s.includes('/') && !s.includes('\\') && !s.includes('\0') && !/%[0-9a-f]{2}/i.test(s)

const forbidden = () => NextResponse.json({ status: 'error', msg: 'forbidden' }, { status: 403 })

type Ctx = { params: Promise<{ path: string[] }> }

async function handle(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  // AUTHORIZE FIRST — global-admin only, fail-closed. A non-global-admin (tenant
  // customer, org-level isAdmin) gets a 403 and never sees platform vendor spend.
  const gate = await getAdminGate(req)
  if (!gate) return forbidden()

  const segs = (await ctx.params).path
  if (!segs.every(isSafeSegment)) {
    return NextResponse.json({ status: 'error', msg: 'invalid costs path' }, { status: 400 })
  }
  const path = segs.join('/')
  if (!ALLOWED.has(path)) {
    return NextResponse.json({ status: 'error', msg: 'not found' }, { status: 404 })
  }

  const token = (process.env.COMMERCE_TOKEN ?? process.env.COMMERCE_SERVICE_TOKEN ?? '').trim()
  if (!token) {
    return NextResponse.json({ status: 'error', msg: 'Costs not configured (COMMERCE_TOKEN missing).' }, { status: 501 })
  }

  // Only forward the safe `period` query param (validated commerce-side too), so a
  // crafted query can't reach commerce.
  const q = new URLSearchParams()
  const period = req.nextUrl.searchParams.get('period')
  if (period) q.set('period', period)
  const url = `${commerceBaseUrl()}/v1/${path}${q.toString() ? `?${q}` : ''}`

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Org-Id': platformOrg(),
        Accept: 'application/json',
      },
      cache: 'no-store',
      signal: req.signal,
    })
    const text = await res.text()
    return new NextResponse(text, {
      status: res.status,
      headers: {
        'Content-Type': res.headers.get('content-type') ?? 'application/json',
        'Cache-Control': 'no-store, must-revalidate',
      },
    })
  } catch (e) {
    return NextResponse.json(
      { status: 'error', msg: `Costs upstream unreachable: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    )
  }
}

export async function GET(req: NextRequest, ctx: Ctx) {
  return handle(req, ctx)
}
