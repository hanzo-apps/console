/**
 * /auth/refresh — silently renew the console session (server-side, BFF).
 *
 * The browser calls this with just its httpOnly cookies (no token in the body, none
 * in the URL). The route reassembles + reads the sealed refresh token, calls IAM with
 * `grant_type=refresh_token`, and re-seals the ROTATED token set (IAM issues a new
 * one-time-use refresh token every refresh — we always persist the NEW one). It
 * returns only the new lifetime, never a token.
 *
 * Called two ways, both single-flight on the client (`lib/auth/refresh`): proactively
 * on a timer at ~80% of the access lifetime, and reactively on a 401 from any cloud/BFF
 * call. On failure (the refresh token is truly expired/revoked, or a replay of a
 * rotated one) it 401s WITHOUT clearing the cookies (multi-tab rotating-token race
 * safety — a lost-race 401 must not nuke another tab's freshly-rotated cookie); the
 * client then re-reads the session (seeing a winner's fresh cookie if any) or falls
 * through to graceful re-auth. Only explicit sign-out clears the cookies.
 */
import { type NextRequest, NextResponse } from 'next/server'

import { readRefreshToken, refreshGrant, sealSession, setCookies, SessionError, type CookieDirective } from '~/lib/server/session'
import { csrfRefusal } from '~/lib/server/bearer-proxy'

export const runtime = 'nodejs'

function withCookies(res: NextResponse, dirs: CookieDirective[]): NextResponse {
  for (const d of dirs) {
    res.cookies.set(d.name, d.value, {
      httpOnly: d.httpOnly,
      secure: d.secure,
      sameSite: d.sameSite,
      path: d.path,
      maxAge: d.maxAge,
    })
  }
  return res
}

/** 401 WITHOUT clearing the cookies (see the multi-tab note above). */
const fail = () => NextResponse.json({ error: 'refresh failed' }, { status: 401 })

export async function POST(req: NextRequest): Promise<NextResponse> {
  // CSRF: uniform same-origin gate on every mutating BFF route (the hz_rt cookie is
  // already SameSite=lax + Path=/auth, so this is belt-and-suspenders).
  const csrf = csrfRefusal(req)
  if (csrf) return csrf

  const rt = readRefreshToken(req)
  if (!rt) return fail()

  let tokens
  try {
    tokens = await refreshGrant(rt)
  } catch (e) {
    // A 502 (endpoint unreachable) is transient — surface it distinctly so the client
    // can retry, and never touch the cookies.
    if (e instanceof SessionError && e.status === 502) {
      return NextResponse.json({ error: 'refresh unavailable' }, { status: 502 })
    }
    return fail()
  }
  // A rotated set with no new refresh token would strand us next cycle — require it
  // (fail-closed: never persist a session we cannot refresh again).
  if (!tokens.refreshToken) return fail()

  const sealed = sealSession(tokens)
  if (!sealed) return fail()
  const res = NextResponse.json({ expiresIn: Math.floor(sealed.expiresInMs / 1000) })
  return withCookies(res, setCookies(sealed.identity, sealed.refresh))
}
