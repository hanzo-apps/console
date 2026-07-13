/**
 * /auth/device — QR device login (RFC 8628) for the console (BFF).
 *
 * The console IS the "device": the user opens console.<brand> on ANY machine, scans the
 * QR with their phone, signs in + approves at the brand IAM, and this tab's session
 * starts — no password typed on the machine at hand.
 *
 *   POST { action: 'start' }              request a device authorization from IAM and
 *                                         return { deviceCode, userCode, the QR target,
 *                                         expiresIn, interval }.
 *   POST { action: 'poll', deviceCode }   redeem the (once-approved) device_code; on
 *                                         success SET the sealed session cookies (the
 *                                         EXACT cookie-set path /auth/session uses), else
 *                                         report the RFC 8628 polling state.
 *
 * SECURITY. The device grant is a PUBLIC-client flow — no secret rides the browser; the
 * device_code + client_id authenticate the poll, exactly like a native device app. The
 * approving human authenticates + approves interactively at the verification URI (that
 * IS the authentication). Tokens live ONLY inside the sealed httpOnly cookies — never
 * returned to the browser, never logged, never in a URL. START hits the PUBLIC issuer so
 * the emitted verification_uri is the public SPA URL a phone can actually reach.
 */
import { type NextRequest, NextResponse } from 'next/server'

import { resolveConfig } from '~/config'
import { csrfRefusal } from '~/lib/server/bearer-proxy'
import { fetchWithTimeout } from '~/lib/server/fetch-timeout'
import {
  accountOf,
  applyCookies,
  deviceCodeGrant,
  sessionConfigured,
  setCookies,
  SessionError,
} from '~/lib/server/session'

export const runtime = 'nodejs'

/** The scope the QR login requests — a display session (no offline_access; the QR flow
 *  is an interactive sign-in, not a long-lived background grant). */
const DEVICE_SCOPE = 'openid profile email'

const hostOf = (req: NextRequest): string => req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? ''

export async function POST(req: NextRequest): Promise<NextResponse> {
  // CSRF: refuse a cross-origin login (login-CSRF fixes a victim into an attacker's
  // session) before starting or redeeming a device authorization.
  const csrf = csrfRefusal(req)
  if (csrf) return csrf

  if (!sessionConfigured()) {
    // The QR login mints the durable hz_session, whose seal key rests on the
    // confidential-client secret; without it the cookie can't be minted stably across
    // replicas — report "not configured" honestly (the email path still works).
    return NextResponse.json({ error: 'session not configured' }, { status: 501 })
  }

  let body: { action?: unknown; deviceCode?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'bad request' }, { status: 400 })
  }

  // The device client is the brand's cloud client (`<brand>-cloud`), resolved from the
  // host — start and poll resolve the SAME client, satisfying RFC 8628 §3.4 (the
  // device_code is bound to the client that requested it).
  const cfg = resolveConfig(hostOf(req))
  if (body.action === 'start') return startDeviceAuth(cfg.iamUrl, cfg.iamClientId)
  if (body.action === 'poll') {
    const deviceCode = typeof body.deviceCode === 'string' ? body.deviceCode : ''
    if (!deviceCode) return NextResponse.json({ error: 'missing device_code' }, { status: 400 })
    return pollDeviceAuth(deviceCode, cfg.iamClientId)
  }
  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}

/** START — request a device authorization from IAM at the PUBLIC issuer (so the emitted
 *  verification_uri is the public SPA URL a phone scans), and hand the browser the codes
 *  + poll cadence. */
async function startDeviceAuth(iamUrl: string, clientId: string): Promise<NextResponse> {
  const url = new URL(`${iamUrl}/v1/iam/oauth/device`)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('scope', DEVICE_SCOPE)

  let res: Response
  try {
    res = await fetchWithTimeout(url.toString(), {
      method: 'POST',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
  } catch {
    return NextResponse.json({ error: 'device endpoint unavailable' }, { status: 502 })
  }
  const j = (await res.json().catch(() => null)) as {
    device_code?: string
    user_code?: string
    verification_uri?: string
    verification_uri_complete?: string
    expires_in?: number
    interval?: number
    error?: string
  } | null
  if (!j?.device_code || !j.user_code) {
    return NextResponse.json({ error: j?.error || 'device authorization failed' }, { status: 502 })
  }
  return NextResponse.json({
    deviceCode: j.device_code,
    userCode: j.user_code,
    verificationUri: j.verification_uri ?? '',
    verificationUriComplete: j.verification_uri_complete ?? j.verification_uri ?? '',
    expiresIn: typeof j.expires_in === 'number' ? j.expires_in : 0,
    interval: typeof j.interval === 'number' && j.interval > 0 ? j.interval : 5,
  })
}

/** POLL — redeem the approved device_code. On success set the sealed session cookies
 *  (the exact writer /auth/session uses); pending/expired report the polling state. */
async function pollDeviceAuth(deviceCode: string, clientId: string): Promise<NextResponse> {
  let result
  try {
    result = await deviceCodeGrant(deviceCode, clientId)
  } catch (e) {
    const status = e instanceof SessionError ? e.status : 502
    return NextResponse.json({ error: 'grant failed' }, { status })
  }
  if (result.status !== 'ok') return NextResponse.json({ status: result.status })

  const res = NextResponse.json({
    status: 'ok',
    account: accountOf(result.claims),
    expiresIn: Math.floor(result.expiresInMs / 1000),
  })
  return applyCookies(res, setCookies(result.identity, result.refresh))
}
