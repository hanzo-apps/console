/**
 * Per-tenant billing proxy → commerce. The browser calls console2's OWN origin
 * (`/billing/...`); this server handler forwards to commerce's `/v1/billing/...`,
 * injecting the commerce SERVICE token from server-only env (never `NEXT_PUBLIC_`,
 * never in the browser bundle) AND scoping every request to the caller's OWN org.
 *
 * Same trust boundary as the `/admin/iam` + `/admin/kms` proxies, but the authz is
 * PER-TENANT, not admin: any authenticated session may read/act on ITS OWN billing
 * (balance / usage / invoices / credit-grants). The org is resolved server-side
 * from the validated session (`resolveUser`) and stamped as `X-Hanzo-Org` + the
 * `user` billing-subject — the client CANNOT widen scope (a supplied `?user=`/`?org=`
 * is overwritten), so commerce's per-org isolation can never be crossed from the
 * browser. No session → 401.
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

export const runtime = 'nodejs'

const isSafeSegment = (s: string): boolean =>
  s.length > 0 && s !== '.' && s !== '..' && !s.includes('/') && !s.includes('\\') && !s.includes('\0')

/** Orgs whose members bill per-USER (the shared catch-all). Mirrors PERSONAL_BILLING_ORGS. */
function personalBillingOrgs(): Set<string> {
  const raw = (process.env.PERSONAL_BILLING_ORGS || process.env.HANZO_DEFAULT_ORG || 'hanzo')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  return new Set(raw)
}

/** Commerce billing subject for an org+user (= the subject the gateway debits). */
function billingSubject(org: string, name: string): string {
  const o = org.trim().toLowerCase()
  if (!o) return ''
  if (personalBillingOrgs().has(o)) {
    const n = name.trim().toLowerCase()
    return n ? `${o}/${n}` : o
  }
  return o
}

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

  // Overwrite any client `user`/`org` so the browser cannot read another tenant's ledger.
  const search = new URLSearchParams(req.nextUrl.search)
  search.set('user', subject)
  search.delete('org')
  const qs = search.toString()
  const url = `${commerceBaseUrl()}/v1/billing/${path.join('/')}${qs ? `?${qs}` : ''}`

  const init: RequestInit = {
    method: req.method,
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Hanzo-Org': org,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    cache: 'no-store',
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = await req.text()
  }
  try {
    const res = await fetch(url, init)
    const text = await res.text()
    return new NextResponse(text, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('content-type') ?? 'application/json' },
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
