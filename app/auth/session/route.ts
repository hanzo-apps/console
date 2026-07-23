/**
 * /auth/session — the console's OWN durable, refreshable OAuth session (BFF).
 *
 *   POST   establish the console session for the SIGNED-IN user (first-party
 *          confidential-client password grant WITH offline_access → access +
 *          rotating refresh token, sealed into the httpOnly cookies).
 *   GET    the current account resolved from that session (what the Auth reads
 *          FIRST — durable + silently refreshed, so it survives the casibase
 *          session's own lifetime and never bounces the user mid-task).
 *   DELETE sign out — best-effort revoke the refresh token + clear the cookies.
 *
 * SECURITY. POST is GATED: it mints a console session ONLY for a caller who is
 * ALREADY authenticated (a valid casibase/console session — the full login incl. any
 * MFA), AND only when the password grant resolves to the SAME principal — so it can
 * never be driven standalone with a stolen password, and never bypasses MFA (an MFA
 * account never reaches this call). Tokens live only inside the sealed httpOnly
 * cookies — never returned to the browser, never logged, never in a URL.
 */
import { type NextRequest, NextResponse } from 'next/server'

import { csrfRefusal } from '~/lib/server/bearer-proxy'
import { resolveUser } from '~/lib/server/identity'
import {
  accountOf,
  applyCookies,
  clearCookies,
  consoleSession,
  passwordGrant,
  readRefreshToken,
  revokeRefreshToken,
  sameSubject,
  sealSession,
  sessionConfigured,
  setCookies,
  SessionError,
} from '~/lib/server/session'

export const runtime = 'nodejs'

/** GET — the account + remaining access lifetime from the live console session, or
 *  401 when there is none (the client then falls back to the casibase session). */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const sess = consoleSession(req)
  if (!sess || !sess.claims.name) {
    return NextResponse.json({ error: 'no session' }, { status: 401 })
  }
  return NextResponse.json({ account: accountOf(sess.claims), expiresIn: sess.expiresInSec })
}

/** POST { username, password } — establish the console session for the signed-in user. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  // CSRF: refuse a cross-origin login (login-CSRF fixes the victim into an attacker's
  // session) before touching credentials.
  const csrf = csrfRefusal(req)
  if (csrf) return csrf

  if (!sessionConfigured()) {
    // No confidential client wired: the console still runs on the casibase session;
    // report "not configured" so the client silently skips the console session.
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

  const sealed = sealSession(tokens)
  // The grant MUST resolve to the same principal as the established session — the
  // console session is for the already-authenticated user, never a third party.
  const grantId =
    sealed && sealed.claims.owner && sealed.claims.name ? `${sealed.claims.owner}/${sealed.claims.name}` : ''
  if (!sealed || !grantId || !sameSubject(grantId, authed.id)) {
    return NextResponse.json({ error: 'identity mismatch' }, { status: 401 })
  }

  const res = NextResponse.json({
    account: accountOf(sealed.claims),
    expiresIn: Math.floor(sealed.expiresInMs / 1000),
  })
  return applyCookies(res, setCookies(sealed.identity, sealed.refresh))
}

/** DELETE — sign out: best-effort revoke the refresh token, then clear the cookies. */
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  // CSRF: refuse a cross-origin forced sign-out.
  const csrf = csrfRefusal(req)
  if (csrf) return csrf

  const rt = readRefreshToken(req)
  if (rt) await revokeRefreshToken(rt)
  return applyCookies(NextResponse.json({ ok: true }), clearCookies())
}
