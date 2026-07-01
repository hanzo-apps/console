/**
 * Same-origin proxy to the durable task engine (hanzoai/tasks `tasksd`, the native
 * Temporal-style HTTP surface at `/v1/tasks/*`).
 *
 * `tasksd` runs `TASKSD_REQUIRE_IDENTITY=true`: it validates an IAM **Bearer JWT**
 * against the IAM JWKS, unconditionally STRIPS inbound `X-Org-Id`, and mints org +
 * user from the JWT claims (`owner`→org). So — like the `/ai` proxy — the console
 * calls its OWN origin (`/tasksd/...`) with just the session cookie; this server
 * handler resolves the signed-in user, mints a SHORT-LIVED, user-bound IAM token
 * (cached until just before expiry), and forwards it as the Bearer. No key in the
 * browser, and every read is org-scoped by the JWT server-side.
 *
 * READ-ONLY: only GET is proxied (the console never mutates workflows here), so
 * this is a scoped read tunnel to `/v1/tasks/*`, nothing else. When the engine is
 * unreachable (the public `tasks.hanzo.ai` TLS is not yet provisioned; the real
 * path is the in-cluster service) the fetch fails and the UI shows an honest
 * BackendStateCard — never fabricated workflows.
 */
import { type NextRequest, NextResponse } from 'next/server'

import { resolveUser, issueUserToken, type SessionUser } from '~/lib/server/identity'

export const runtime = 'nodejs'

const trim = (s: string) => s.replace(/\/+$/, '')
/** The durable task engine. Public TLS is not live yet → default to the in-cluster
 *  service (tasks.hanzo.svc:80 → tasksd :7243). Override with TASKS_URL. */
const TASKS_URL = trim(process.env.TASKS_URL ?? 'http://tasks.hanzo.svc.cluster.local')

// ── Short-lived user-token cache (mirrors the /ai proxy) ─────────────────────
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

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }): Promise<NextResponse> {
  const rel = (await ctx.params).path.join('/')

  const user = await resolveUser(req)
  if (!user) {
    return NextResponse.json({ error: 'Sign in to view tasks.', code: 401 }, { status: 401 })
  }

  let token: string
  try {
    token = await tokenFor(user)
  } catch (e) {
    return NextResponse.json(
      { error: `Could not authorize the request: ${e instanceof Error ? e.message : String(e)}`, code: 502 },
      { status: 502 },
    )
  }

  const url = `${TASKS_URL}/v1/tasks/${rel}${req.nextUrl.search}`
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        // tasksd mints org from the JWT and strips this, but send the active org so
        // it is correct in any topology (a gateway that re-injects overwrites it).
        'X-Org-Id': user.owner,
      },
      cache: 'no-store',
      signal: req.signal,
    })
    const text = await res.text()
    return new NextResponse(text, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('content-type') ?? 'application/json' },
    })
  } catch (e) {
    return NextResponse.json(
      { error: `Task engine unreachable: ${e instanceof Error ? e.message : String(e)}`, code: 502 },
      { status: 502 },
    )
  }
}
