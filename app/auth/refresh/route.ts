/**
 * /auth/refresh — silently renew the console session (server-side, BFF).
 *
 * The browser calls this with just its httpOnly `hz_session` cookie (no token in the
 * body, none in the URL). The route reads the sealed refresh token, calls IAM with
 * `grant_type=refresh_token`, and re-seals the ROTATED token set (IAM issues a new
 * one-time-use refresh token on every refresh — we always persist the NEW one). It
 * returns only the new lifetime, never a token.
 *
 * Called two ways, both single-flight on the client (`lib/auth/refresh`):
 *   - proactively, on a timer at ~80% of the access-token lifetime, and
 *   - reactively, on a 401 from any cloud/BFF call (refresh once, then retry).
 * On failure (the refresh token is truly expired/revoked, or a replay of a rotated
 * one) it clears the cookie and 401s, so the client falls through to the existing
 * graceful re-auth (stash return-to → land back after signing in).
 */
import { type NextRequest, NextResponse } from 'next/server'

import {
  readConsoleSession,
  refreshGrant,
  sealTokens,
  sessionCookie,
  SessionError,
  type CookieDirective,
} from '~/lib/server/session'

export const runtime = 'nodejs'

function withCookie(res: NextResponse, d: CookieDirective): NextResponse {
  res.cookies.set(d.name, d.value, {
    httpOnly: d.httpOnly,
    secure: d.secure,
    sameSite: d.sameSite,
    path: d.path,
    maxAge: d.maxAge,
  })
  return res
}

/**
 * 401 WITHOUT clearing the cookie. Rotating refresh tokens are one-time-use, so with
 * multiple tabs one tab can lose the race and get `invalid_grant` while ANOTHER tab
 * just rotated the cookie to a fresh, valid session — clearing here would nuke that
 * winner and cascade both tabs to a bounce. So a failed refresh leaves the cookie
 * alone: the client re-reads the session (`AccountApi.session`) — seeing the winner's
 * fresh access token if there is one — and otherwise the access token's own `exp`
 * lapses it into the casibase fallback / graceful re-auth. Only explicit sign-out
 * (DELETE /auth/session) clears the cookie.
 */
function fail(): NextResponse {
  return NextResponse.json({ error: 'refresh failed' }, { status: 401 })
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const s = readConsoleSession(req)
  if (!s?.r) return fail()

  let tokens
  try {
    tokens = await refreshGrant(s.r)
  } catch (e) {
    // A 502 (endpoint unreachable) is transient — surface it distinctly so the client
    // can retry, and never touch the cookie.
    if (e instanceof SessionError && e.status === 502) {
      return NextResponse.json({ error: 'refresh unavailable' }, { status: 502 })
    }
    return fail()
  }
  // A rotated set with no new refresh token would strand us next cycle — require it
  // (fail-closed: never persist a session we cannot refresh again).
  if (!tokens.refreshToken) return fail()

  const { sealed, expiresInMs } = sealTokens(tokens)
  const res = NextResponse.json({ expiresIn: Math.floor(expiresInMs / 1000) })
  return withCookie(res, sessionCookie(sealed))
}
