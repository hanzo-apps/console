/**
 * Per-user proxy to the Hanzo Base control plane (base.hanzo.ai) — the embedded
 * Base module's ONE transport. The browser calls console2's OWN origin
 * (`/superbase/v1/...`) with just the session cookie; this server handler
 * resolves the user, mints a SHORT-LIVED user-bound IAM token, and forwards to
 * base.hanzo.ai with that token. No token ever reaches the browser, and the
 * SAME @hanzo/superbase-dashboard screens render here and standalone.
 *
 * NOT the PaaS pattern: PaaS forwards a god-mode SERVICE token and is gated to
 * brand admins. Base authorizes PER USER itself — the `tenants` collection's
 * `ListRule = "owner_iam_user = @request.auth.id"` and admin-only mutations are
 * enforced by Base against the forwarded user identity. So here we forward the
 * USER's own minted bearer (least privilege, tenant-scoped by Base), and the
 * only gate is "must be signed in" (resolveUser → 401). A non-admin simply sees
 * their own tenants and gets Base's 403 on a mutation — honest, not faked.
 *
 * Least privilege on the path too: only the `tenants` collection records surface
 * is proxied; anything else 404s, so this is not a general Base tunnel.
 */
import { type NextRequest, NextResponse } from 'next/server'

import { resolveUser, issueUserToken, type SessionUser } from '~/lib/server/identity'

export const runtime = 'nodejs'

const trim = (s: string) => s.replace(/\/+$/, '')
/** The Base control plane the proxied calls are forwarded to. */
const BASE_URL = trim(process.env.BASE_DASHBOARD_URL ?? 'https://base.hanzo.ai')

/** Only the tenants collection records surface (list/get/create/update/delete). */
const RECORDS = 'v1/collections/tenants/records'
function allowed(rel: string): boolean {
  return rel === RECORDS || rel.startsWith(`${RECORDS}/`)
}

// ── Short-lived user-token cache (same shape as the AI/admin proxies) ─────────
type CachedToken = { token: string; expMs: number }
const tokenCache = new Map<string, CachedToken>()
const SKEW_MS = 60_000
const FALLBACK_TTL_MS = 5 * 60_000

async function tokenFor(user: SessionUser): Promise<string> {
  const hit = tokenCache.get(user.id)
  if (hit && hit.expMs > Date.now()) return hit.token
  const { accessToken, expiresIn } = await issueUserToken(user)
  const ttl = expiresIn > 0 ? expiresIn * 1000 : FALLBACK_TTL_MS
  tokenCache.set(user.id, { token: accessToken, expMs: Date.now() + ttl - SKEW_MS })
  return accessToken
}

async function forward(req: NextRequest, path: string[]): Promise<NextResponse> {
  const rel = path.join('/')
  if (!allowed(rel)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const user = await resolveUser(req)
  if (!user) {
    return NextResponse.json({ error: 'Sign in to manage Base tenants.' }, { status: 401 })
  }

  let token: string
  try {
    token = await tokenFor(user)
  } catch (e) {
    return NextResponse.json(
      { error: `Could not authorize the request: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    )
  }

  const url = `${BASE_URL}/${rel}${req.nextUrl.search}`
  const init: RequestInit = {
    method: req.method,
    headers: {
      Authorization: `Bearer ${token}`,
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
      { error: `Base control plane unreachable: ${e instanceof Error ? e.message : String(e)}` },
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
