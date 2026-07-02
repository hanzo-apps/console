/**
 * /auth/session — the console's OWN durable, refreshable OAuth session (BFF).
 *
 *   POST   establish the console session for the SIGNED-IN user (first-party
 *          confidential-client password grant WITH offline_access → access +
 *          rotating refresh token, sealed into the httpOnly `hz_session` cookie).
 *   GET    the current account resolved from that session (what the AuthGate reads
 *          FIRST — durable + silently refreshed, so it survives the casibase
 *          session's own lifetime and never bounces the user mid-task).
 *   DELETE sign out — best-effort revoke the refresh token + clear the cookie.
 *
 * SECURITY. POST is GATED: it mints a console session ONLY for a caller who is
 * ALREADY authenticated (a valid casibase/console session, i.e. they completed the
 * full login incl. any MFA), AND only when the password grant resolves to the SAME
 * principal — so it can never be driven standalone with a stolen password, and it
 * never bypasses MFA (an MFA account never reaches this call; it finishes on the
 * hosted flow and falls back to the casibase session). The refresh token is written
 * only inside the sealed httpOnly cookie — never returned to the browser, never
 * logged, never in a URL.
 */
import { type NextRequest, NextResponse } from 'next/server'

import { type Account } from '~/lib/api/types'
import { resolveUser } from '~/lib/server/identity'
import {
  accessClaims,
  clearSessionCookie,
  consoleSession,
  passwordGrant,
  readConsoleSession,
  revokeRefreshToken,
  sameSubject,
  sealTokens,
  sessionConfigured,
  sessionCookie,
  SessionError,
  type ConsoleClaims,
  type CookieDirective,
} from '~/lib/server/session'

export const runtime = 'nodejs'

/** Build the client-facing Account from console claims (display + admin fields only;
 *  never the secret material Casdoor also packs into the token). `isGlobalAdmin` is
 *  carried so the client nav/org gates (`isGlobalAdminAccount`) match the casibase
 *  path; `owner === 'admin'` also implies it. */
function accountOf(c: ConsoleClaims): Account {
  return {
    owner: c.owner ?? '',
    name: c.name ?? '',
    type: c.type,
    displayName: c.displayName,
    email: c.email,
    avatar: c.avatar,
    isAdmin: c.isAdmin,
    isGlobalAdmin: c.isGlobalAdmin || c.owner === 'admin',
    properties: c.properties,
  }
}

/** Apply a cookie directive to a NextResponse. */
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

/** GET — the account + remaining access lifetime from the live console session, or
 *  401 when there is none (the client then falls back to the casibase session). The
 *  `expiresIn` lets the client (re)arm its proactive refresh timer after a reload. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const sess = consoleSession(req)
  if (!sess || !sess.claims.name) {
    return NextResponse.json({ error: 'no session' }, { status: 401 })
  }
  return NextResponse.json({ account: accountOf(sess.claims), expiresIn: sess.expiresInSec })
}

/** POST { username, password } — establish the console session for the signed-in user. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!sessionConfigured()) {
    // No confidential client wired: the console still runs on the casibase session;
    // just report "not configured" so the client silently skips the console session.
    return NextResponse.json({ error: 'session not configured' }, { status: 501 })
  }

  let body: { username?: unknown; password?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'bad request' }, { status: 400 })
  }
  const username = typeof body.username === 'string' ? body.username.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  if (!username || !password) {
    return NextResponse.json({ error: 'missing credentials' }, { status: 400 })
  }

  // GATE: the caller must already be authenticated (they just completed the casibase
  // login incl. any MFA). This binds the console session to a real, MFA-cleared
  // session and blocks standalone password abuse.
  const authed = await resolveUser(req)
  if (!authed) {
    return NextResponse.json({ error: 'not authenticated' }, { status: 401 })
  }

  let tokens
  try {
    tokens = await passwordGrant(username, password)
  } catch (e) {
    const status = e instanceof SessionError ? e.status : 502
    return NextResponse.json({ error: 'grant failed' }, { status })
  }

  // The grant MUST resolve to the same principal as the established session — the
  // console session is for the already-authenticated user, never a third party.
  const gc = accessClaims(tokens.accessToken)
  const grantId = gc && gc.owner && gc.name ? `${gc.owner}/${gc.name}` : ''
  if (!gc || !grantId || !sameSubject(grantId, authed.id)) {
    return NextResponse.json({ error: 'identity mismatch' }, { status: 401 })
  }

  const { sealed, expiresInMs } = sealTokens(tokens)
  const res = NextResponse.json({ account: accountOf(gc), expiresIn: Math.floor(expiresInMs / 1000) })
  return withCookie(res, sessionCookie(sealed))
}

/** DELETE — sign out: best-effort revoke the refresh token, then clear the cookie. */
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const s = readConsoleSession(req)
  if (s?.r) await revokeRefreshToken(s.r)
  return withCookie(NextResponse.json({ ok: true }), clearSessionCookie())
}
