/**
 * Keyless AI proxy — the ONE path the console uses to reach the model gateway.
 *
 * `/v1/chat/completions` (and friends) REQUIRE an `Authorization: Bearer` token;
 * a browser session cookie alone is rejected. Rather than ship the user's durable
 * `hk-` key to the browser, the console calls its OWN origin (`/ai/v1/...`) with
 * just the session cookie; this server handler resolves the user, mints a
 * SHORT-LIVED, user-bound IAM token (issue-user-token, cached until just before
 * expiry), and forwards to the gateway with that token. No key in the browser, no
 * rotation on a chat turn, and every call is billed to the user's own org.
 *
 * Least privilege: only the read/inference AI endpoints are proxied; anything
 * else 404s, so this is not a general gateway tunnel.
 */
import { type NextRequest, NextResponse } from 'next/server'

import { resolveUser, issueUserToken, type SessionUser } from '~/lib/server/identity'

export const runtime = 'nodejs'

const trim = (s: string) => s.replace(/\/+$/, '')
/** Gateway the proxied AI calls are forwarded to (gated/priced api.hanzo.ai). */
const AI_GATEWAY_URL = trim(process.env.AI_GATEWAY_URL ?? 'https://api.hanzo.ai')

/** The exact `/v1/<...>` endpoints the console is allowed to reach. */
const ALLOWED = new Set([
  'v1/models',
  'v1/pricing/models', // the rich model+provider catalog (context, pricing, specs, tier) for Models/Providers pages
  'v1/chat',
  'v1/chat/completions',
  'v1/embeddings',
  'v1/rerank',
])

// ── Short-lived user-token cache ─────────────────────────────────────────────
// issue-user-token is an IAM round-trip; cache the JWT per user until ~60s before
// it expires so a chat session reuses one token instead of issuing per turn.
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
  if (!ALLOWED.has(rel)) {
    return NextResponse.json({ error: { message: 'Not found', type: 'not_found' } }, { status: 404 })
  }

  const user = await resolveUser(req)
  if (!user) {
    return NextResponse.json(
      { error: { message: 'Sign in to use AI.', type: 'auth_error', code: 'unauthenticated' } },
      { status: 401 },
    )
  }

  let token: string
  try {
    token = await tokenFor(user)
  } catch (e) {
    return NextResponse.json(
      { error: { message: `Could not authorize the request: ${e instanceof Error ? e.message : String(e)}`, type: 'auth_error' } },
      { status: 502 },
    )
  }

  const url = `${AI_GATEWAY_URL}/${rel}${req.nextUrl.search}`
  const init: RequestInit = {
    method: req.method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      // The gateway derives org/user from the JWT; pass the resolved org too so a
      // pooled-org backend scopes correctly either way (it strips client headers).
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
      { error: { message: `AI gateway unreachable: ${e instanceof Error ? e.message : String(e)}`, type: 'upstream_error' } },
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
