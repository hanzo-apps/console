/**
 * Same-origin proxy to the platform.hanzo.ai control plane (embedded PaaS). The
 * browser calls console2's OWN origin (`/paas/...`); this server-side handler
 * forwards to `platform.hanzo.ai/v1/...`, injecting the service token from
 * server-only env (sourced via KMS — never `NEXT_PUBLIC_`, never in the browser
 * bundle). This is the real control-plane API, not an iframe stub.
 *
 * SECURITY (deny-by-default): the proxy attaches a powerful, UNSCOPED platform
 * service token (every tenant, every cluster), so EVERY request must first
 * present a valid IAM session AND be a GLOBAL platform admin — both verified
 * BEFORE the token is attached. The token carries no user scope, so the gate is
 * the sole authz: a tenant ORG admin (`isAdmin`) is NOT enough; only a global
 * admin (member of the admin org) passes. Unauthenticated → 401, non-global-admin
 * → 403. The forwarded path is constrained to `/v1/...` (no `..` traversal).
 * (Re-add `PAAS_SERVICE_TOKEN` to the deployment once this gate is confirmed.)
 *
 * When `PAAS_SERVICE_TOKEN` is unset the proxy returns an honest 501 (to global
 * admins) so the UI shows a truthful "not configured" state — it never fabricates.
 */
import { type NextRequest, NextResponse } from 'next/server'

import { getServerAccount, isGlobalAdminAccount } from '~/lib/auth/server'

/**
 * A path segment is safe iff it cannot alter the resolved path: non-empty, not a
 * relative `.`/`..`, and free of separators / NUL. This keeps the forwarded URL
 * inside the platform's `/v1/` prefix (URL normalization would let `..` escape it).
 */
const isSafeSegment = (s: string): boolean =>
  s.length > 0 && s !== '.' && s !== '..' && !s.includes('/') && !s.includes('\\') && !s.includes('\0')

async function forward(req: NextRequest, path: string[]): Promise<NextResponse> {
  // Deny-by-default authz — verify the session + require GLOBAL admin BEFORE the
  // token (uniform 401 for anyone unauthenticated, regardless of the path shape).
  const account = await getServerAccount(req.headers.get('cookie'))
  if (!account) {
    return NextResponse.json({ error: 'Sign in to use the control plane.' }, { status: 401 })
  }
  if (!isGlobalAdminAccount(account)) {
    return NextResponse.json(
      { error: 'Global platform admin access is required for the control plane.' },
      { status: 403 },
    )
  }

  // Constrain the forwarded path to /v1/... — reject any traversal/odd segment.
  if (!path.every(isSafeSegment)) {
    return NextResponse.json({ error: 'Invalid control-plane path.' }, { status: 400 })
  }

  const token = process.env.PAAS_SERVICE_TOKEN ?? ''
  if (!token) {
    return NextResponse.json(
      { error: 'PaaS control plane is not configured (PAAS_SERVICE_TOKEN missing).' },
      { status: 501 },
    )
  }

  const platformUrl = (process.env.PLATFORM_URL ?? 'https://platform.hanzo.ai').replace(/\/+$/, '')
  const url = `${platformUrl}/v1/${path.join('/')}${req.nextUrl.search}`
  const init: RequestInit = {
    method: req.method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    // Never cache control-plane reads.
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
      { error: `PaaS upstream unreachable: ${e instanceof Error ? e.message : String(e)}` },
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
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return forward(req, (await ctx.params).path)
}
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return forward(req, (await ctx.params).path)
}
