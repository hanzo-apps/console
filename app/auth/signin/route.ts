/**
 * /auth/signin — the console's OWN OAuth code exchange for ADMIN hosts (BFF).
 *
 * On admin.<brand> the credential login mints the code for the PUBLIC `admin-console`
 * client (the reserved `admin` org). The cloud backend's `/v1/iam/signin` redeems with
 * its CONFIDENTIAL `hanzo-cloud` client, so IAM rejects it ("the token is for wrong
 * application (client_id)"). This route redeems the code HERE as admin-console via
 * authorization_code + PKCE (RFC 7636 — the code_verifier authenticates the exchange,
 * NO client secret to provision), then seals the durable hz_session the AuthGate + the
 * admin gate read. Tenant hosts never call this — they keep the cloud-backend exchange.
 *
 * SECURITY. The code is single-use and IAM-minted only after a full credential (incl.
 * any MFA) check; PKCE binds this redemption to the browser that authorized it. Tokens
 * live ONLY inside the sealed httpOnly cookies — never returned to the browser, never
 * logged, never in a URL.
 */
import { type NextRequest, NextResponse } from 'next/server'

import { isAdminHost } from '~/config'
import { csrfRefusal } from '~/lib/server/bearer-proxy'
import {
  accountOf,
  applyCookies,
  durableSessionClientId,
  pkceCodeGrant,
  sealSession,
  sessionConfigured,
  setCookies,
  SessionError,
} from '~/lib/server/session'

export const runtime = 'nodejs'

/** The callback the admin credential login authorized against (mirrors iam.CALLBACK_PATH;
 *  inlined so this server route pulls in no browser-only IAM SDK). */
const CALLBACK_PATH = '/auth/callback'

export async function POST(req: NextRequest): Promise<NextResponse> {
  // CSRF: refuse a cross-origin login (login-CSRF fixes a victim into an attacker's
  // session) before touching the code.
  const csrf = csrfRefusal(req)
  if (csrf) return csrf

  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? ''
  const clientId = durableSessionClientId(host)
  // This exchange is the admin-console (public-client) redemption ONLY. A tenant host
  // redeems via the cloud backend with its confidential client — refuse it here.
  if (!isAdminHost(host) || !clientId) {
    return NextResponse.json({ error: 'not an admin host' }, { status: 400 })
  }
  if (!sessionConfigured()) {
    // The session seal key rests on the confidential-client secret; without it the
    // cookie can't be minted stably across replicas — report "not configured" honestly.
    return NextResponse.json({ error: 'session not configured' }, { status: 501 })
  }

  let body: { code?: unknown; codeVerifier?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'bad request' }, { status: 400 })
  }
  const code = typeof body.code === 'string' ? body.code : ''
  const codeVerifier = typeof body.codeVerifier === 'string' ? body.codeVerifier : ''
  if (!code || !codeVerifier) {
    return NextResponse.json({ error: 'missing code' }, { status: 400 })
  }

  let tokens
  try {
    tokens = await pkceCodeGrant({
      clientId,
      code,
      codeVerifier,
      redirectUri: `https://${host.replace(/:\d+$/, '')}${CALLBACK_PATH}`,
    })
  } catch (e) {
    const status = e instanceof SessionError ? e.status : 502
    return NextResponse.json({ error: 'grant failed' }, { status })
  }

  const sealed = sealSession(tokens)
  if (!sealed) return NextResponse.json({ error: 'no identity' }, { status: 401 })

  const res = NextResponse.json({
    account: accountOf(sealed.claims),
    expiresIn: Math.floor(sealed.expiresInMs / 1000),
  })
  return applyCookies(res, setCookies(sealed.identity, sealed.refresh))
}
