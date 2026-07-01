/**
 * Per-user proxy to the Bootnode control plane ("Web3 Backend in a Box") — the
 * embedded web3 Networks module's ONE transport. The browser calls console2's
 * OWN origin (`/bootnode/v1/...`) with just the session cookie; this handler
 * resolves the user, mints a SHORT-LIVED user-bound IAM token, and forwards to
 * the bootnode API with that token. No token reaches the browser.
 *
 * Bootnode manages blockchain networks (create/scale/launch/rpc) via `bootno.de/
 * v1` — the web3 primitive the lux/zoo consoles surface under Web3. Least
 * privilege on the path: only the `networks` surface is proxied (+ launch/rpc/
 * scale sub-actions), so this is not a general bootnode tunnel.
 */
import { type NextRequest, NextResponse } from 'next/server'

import { resolveUser, issueUserToken, type SessionUser } from '~/lib/server/identity'

export const runtime = 'nodejs'

const trim = (s: string) => s.replace(/\/+$/, '')
/** The bootnode API the proxied calls are forwarded to. */
const BOOTNODE_URL = trim(process.env.BOOTNODE_URL ?? 'https://bootno.de')

/** Only the networks surface (list/create/delete/scale) + launch/rpc actions. */
function allowed(rel: string): boolean {
  return (
    rel === 'v1/networks' ||
    rel.startsWith('v1/networks/') ||
    rel.startsWith('v1/launch/') ||
    rel.startsWith('v1/rpc/')
  )
}

// ── Short-lived user-token cache (same shape as the other proxies) ───────────
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
    return NextResponse.json({ error: 'Sign in to manage networks.' }, { status: 401 })
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

  const url = `${BOOTNODE_URL}/${rel}${req.nextUrl.search}`
  const init: RequestInit = {
    method: req.method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      // Scope by the caller's org (bootnode is multi-tenant per bn_ project/org).
      'X-Org-Id': user.owner,
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
      { error: `Bootnode control plane unreachable: ${e instanceof Error ? e.message : String(e)}` },
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
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return forward(req, (await ctx.params).path)
}
