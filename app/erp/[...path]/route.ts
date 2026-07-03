/**
 * Same-origin proxy to the brand's ERPNext/Frappe (`erp.<brand>`) REST API — the READ
 * path behind the console's NATIVE ERP summary views (Accounting / Items / Sales Orders).
 *
 * ERP is a SINGLE shared per-BRAND Frappe instance (verified ground truth: one site,
 * `erp.hanzo.ai`, NOT per-customer-org and NOT row-scoped per org). So — unlike the
 * per-org CMS proxy — this is ENTITLEMENT-GATED: only a member of the owning brand org
 * (or a global admin) may read it. A customer org receives a 403 and no ERP data — never
 * a cross-tenant read of the brand's accounting/items/sales.
 *
 * Frappe does NOT accept a Hanzo IAM Bearer on `/api/*` (its OAuth-provider check rejects
 * it); the real REST credential is a Frappe `token <api_key>:<api_secret>`. This proxy
 * forwards that as a SERVER-ONLY secret (`ERP_API_TOKEN`, KMS-provisioned) when set — it
 * never reaches the browser. When ERP isn't deployed yet (today `erp.<brand>` is 502) or
 * the token isn't provisioned, the upstream simply errors and the native views render the
 * honest "connect / deploy ERP" state — never fabricated ERP data.
 *
 * SSRF-safe: the target host is `erp.<brand>` with `<brand>` CLAMPED to the known brand
 * domains. Least privilege on the path: `allowErpSurface` admits ONLY `GET
 * /api/resource/<DocType>` list reads; `pathIsClean` rejects traversal. GET/HEAD only.
 */
import { type NextRequest, NextResponse } from 'next/server'

import { resolveUser } from '~/lib/server/identity'
import { clampedBrandDomain, brandOrgForHost, isEntitled } from '~/lib/server/embed-probe'
import { pathIsClean } from '~/lib/server/bearer-proxy'
import { allowErpSurface } from '~/lib/server/proxy-allow'
import { fetchWithTimeout } from '~/lib/server/fetch-timeout'

export const runtime = 'nodejs'

const trimR = (s: string) => s.replace(/\/+$/, '')
const trimL = (s: string) => s.replace(/^\/+/, '')

/** The per-brand Frappe origin for this request, SSRF-clamped. `ERP_URL` pins a single
 *  in-cluster origin; otherwise `https://erp.<clamped-brand-domain>`. */
function erpTarget(host: string | null): string {
  const override = process.env.ERP_URL?.trim()
  if (override) return trimR(override)
  return `https://erp.${clampedBrandDomain(host)}`
}

type Ctx = { params: Promise<{ path: string[] }> }

async function handle(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const path = trimL((await ctx.params).path.join('/')).replace(/\/+$/, '')
  if (!pathIsClean(path) || !allowErpSurface(path)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const user = await resolveUser(req)
  if (!user) return NextResponse.json({ error: 'Sign in to view ERP.' }, { status: 401 })

  // Entitlement: the shared brand ERP is not per-org isolated, so only the owning brand
  // org / a global admin may read it. A customer org gets an honest 403 (the module then
  // shows the provision panel), never the brand's ERP data.
  const host = req.headers.get('host')
  if (!isEntitled('erp', user.owner, brandOrgForHost(host), user.isGlobalAdmin)) {
    return NextResponse.json({ error: 'ERP is not provisioned for your organization.', entitled: false }, { status: 403 })
  }

  const token = process.env.ERP_API_TOKEN?.trim()
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (token) headers.Authorization = `token ${token}` // Frappe key:secret, server-only

  let dest: URL
  try {
    dest = new URL(`${trimR(erpTarget(host))}/${path}${req.nextUrl.search}`)
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  try {
    const res = await fetchWithTimeout(dest, { method: 'GET', headers, cache: 'no-store', signal: req.signal })
    return new NextResponse(res.body, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('content-type') ?? 'application/json', 'Cache-Control': 'no-store' },
    })
  } catch {
    // 502/timeout/DNS → the module renders the honest "ERP isn't connected — deploy it" state.
    return NextResponse.json({ error: 'ERP is not reachable.' }, { status: 502 })
  }
}

export async function GET(req: NextRequest, ctx: Ctx) {
  return handle(req, ctx)
}
export async function HEAD(req: NextRequest, ctx: Ctx) {
  return handle(req, ctx)
}
