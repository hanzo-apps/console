/**
 * Console OAuth session — THE ONE durable, refreshable token manager (server-only).
 *
 * WHY. The console's signed-in identity historically rested SOLELY on the cloud
 * casibase session cookie (`cloud_session_id`). That cookie is authoritative for
 * the casibase admin surfaces (providers/models/stores/chat/…), but it is a
 * *session* cookie the console does not own and cannot refresh — so it can lapse
 * out from under a working tab (browser-session end, an anonymous-session clobber,
 * or a shortened backend TTL) and bounce the user to /signin mid-task. There was
 * no `grant_type=refresh_token` anywhere in the console: nothing kept a token warm.
 *
 * THE FIX (this module). On login the console ALSO obtains its OWN OAuth token set
 * for the signed-in user — a first-party confidential-client (`hanzo-console`)
 * grant WITH `offline_access`, so IAM returns an access token AND a rotating,
 * revocable refresh token. Both are sealed (AES-256-GCM) into ONE httpOnly cookie
 * the console owns (`hz_session`), NEVER exposed to the browser JS and NEVER put in
 * a URL. This session is the PREFERRED identity source for the AuthGate (via
 * /auth/session) and the /cloud bearer-proxy (via resolveUser), and it is silently
 * refreshed (proactively before expiry + reactively on a 401) via
 * `grant_type=refresh_token`. The casibase cookie stays exactly as-is underneath —
 * it keeps authorizing the admin surfaces and is the graceful FALLBACK when no
 * console session is present (social/MFA logins). Nothing regresses; the user is
 * never bounced while a valid refresh token (or the casibase session) exists.
 *
 * SECURITY POSTURE (unchanged, hardened).
 *   - The refresh token NEVER reaches the browser: it lives only inside the sealed
 *     httpOnly cookie and is read only by these server routes. The refresh call is
 *     server-side (BFF), exactly as required.
 *   - The seal is authenticated (AES-256-GCM): a browser cannot forge or read the
 *     cookie's contents, so the access token inside it is trustworthy without a
 *     second JWKS round-trip — the AEAD seal IS the trust boundary. We still honor
 *     the token's own `exp` (a stale access token is treated as absent → refresh).
 *   - The IAM access token is an opaque, sensitive credential (Casdoor packs the
 *     whole user object — including secret material — into its JWT). It is NEVER
 *     logged, NEVER returned to the client, and only the display/authorization
 *     claims are read out of it.
 *   - Rotation-aware: IAM rotates the refresh token on every refresh (one-time
 *     use). We always persist the NEW refresh token; a replay of the old one 400s.
 */
// Server-only by construction: `node:crypto` + `next/server` cannot be bundled into a
// client chunk, so this module (and the tokens it seals) never reaches the browser.
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto'
import { type NextRequest } from 'next/server'

import { fetchWithTimeout } from './fetch-timeout'

const trim = (s: string) => s.replace(/\/+$/, '')

/** IAM OIDC host that serves the token endpoint. Server-side default is the
 *  in-cluster IAM service; the issuer inside the token stays `https://hanzo.id`. */
const IAM_OAUTH_URL = trim(process.env.IAM_OAUTH_URL?.trim() || process.env.IAM_URL?.trim() || 'https://hanzo.id')
const TOKEN_ENDPOINT = `${IAM_OAUTH_URL}/v1/iam/oauth/access_token`
const REVOKE_ENDPOINT = `${IAM_OAUTH_URL}/v1/iam/oauth/revoke`

/** The confidential first-party client (`hanzo-console`) — same creds the mint/
 *  issue-user-token primitives use. offline_access is required for a refresh token. */
const CLIENT_ID = process.env.IAM_MINT_CLIENT_ID ?? ''
const CLIENT_SECRET = process.env.IAM_MINT_CLIENT_SECRET ?? ''
const SCOPE = 'openid profile email offline_access'

/** True when the confidential client is wired (routes 501/skip cleanly otherwise). */
export const sessionConfigured = (): boolean => Boolean(CLIENT_ID && CLIENT_SECRET)

// ── Cookie ────────────────────────────────────────────────────────────────────

/** The console session cookie name (distinct from casibase's `cloud_session_id`). */
export const SESSION_COOKIE = 'hz_session'
/** Persist for the refresh-token lifetime (IAM: 30 days) so the session survives a
 *  browser restart — a *persistent* cookie, unlike the session-scoped casibase one. */
const COOKIE_MAX_AGE_S = 30 * 24 * 60 * 60

export type CookieDirective = {
  name: string
  value: string
  httpOnly: boolean
  secure: boolean
  sameSite: 'lax' | 'strict' | 'none'
  path: string
  maxAge: number
}

const baseCookie = (value: string, maxAge: number): CookieDirective => ({
  name: SESSION_COOKIE,
  value,
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/',
  maxAge,
})

/** The Set-Cookie directive that stores a sealed session. */
export const sessionCookie = (sealed: string): CookieDirective => baseCookie(sealed, COOKIE_MAX_AGE_S)
/** The Set-Cookie directive that clears the session (maxAge 0, empty value). */
export const clearSessionCookie = (): CookieDirective => baseCookie('', 0)

// ── AEAD seal (AES-256-GCM) ─────────────────────────────────────────────────────

/** 32-byte key derived from the confidential client secret via HKDF-SHA256, domain-
 *  separated by a fixed info label. An explicit CONSOLE_SESSION_KEY overrides. Reusing
 *  the (high-entropy, server-only) client secret means no new KMS entry to provision;
 *  HKDF keeps the session key independent of the raw secret. */
let cachedKey: Buffer | null = null
function sealKey(): Buffer {
  if (cachedKey) return cachedKey
  const override = process.env.CONSOLE_SESSION_KEY
  const ikm = override && override.length >= 16 ? override : CLIENT_SECRET
  // With NO stable secret (the confidential client isn't wired — a dev box or a
  // misconfigured deploy) fall back to a per-PROCESS random key, NEVER a hardcoded
  // constant: a known key would let a browser forge a session blob. A random key is
  // unforgeable and, since establishment is also gated on `sessionConfigured()`, the
  // feature is simply inert there — no console session is created OR trusted. When the
  // secret IS present, HKDF derives a stable key shared across replicas.
  cachedKey = ikm
    ? Buffer.from(hkdfSync('sha256', Buffer.from(ikm), Buffer.alloc(0), Buffer.from('hz-console-session-v1'), 32))
    : randomBytes(32)
  return cachedKey
}

/** What we persist in the cookie. Deliberately NOT the raw access token: a Casdoor
 *  access JWT packs the WHOLE user object (~5-10 KB — password hash, TOTP secret,
 *  every profile/social field), which blows past the browser's ~4 KB per-cookie limit
 *  AND needlessly seals secret material. Instead we seal the rotating refresh token,
 *  the access expiry, and the SMALL projected claims (`accessClaims`) the console
 *  actually reads — a compact, bounded cookie (~1 KB) that a browser accepts. */
export type SealedSession = {
  /** IAM refresh token (rotating, one-time-use). */
  r: string
  /** access_token expiry, ms epoch (when to refresh). */
  e: number
  /** Projected identity/authz claims (display fields only; never secret material). */
  c: ConsoleClaims
}

/** Seal a session into a compact base64url(iv|tag|ciphertext) string. */
export function seal(s: SealedSession): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', sealKey(), iv)
  const ct = Buffer.concat([cipher.update(JSON.stringify(s), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, ct]).toString('base64url')
}

/** Open a sealed string; null on any tamper/format/decrypt failure (fail-closed). */
export function open(sealed: string | undefined | null): SealedSession | null {
  if (!sealed) return null
  let raw: Buffer
  try {
    raw = Buffer.from(sealed, 'base64url')
  } catch {
    return null
  }
  if (raw.length < 12 + 16 + 1) return null
  const iv = raw.subarray(0, 12)
  const tag = raw.subarray(12, 28)
  const ct = raw.subarray(28)
  try {
    const decipher = createDecipheriv('aes-256-gcm', sealKey(), iv)
    decipher.setAuthTag(tag)
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
    const obj = JSON.parse(pt) as SealedSession
    if (typeof obj?.r !== 'string' || typeof obj?.e !== 'number' || !obj?.c || typeof obj.c !== 'object') return null
    return obj
  } catch {
    return null
  }
}

/** Read + open the console session from a request's cookies (null when absent/invalid). */
export function readConsoleSession(req: NextRequest): SealedSession | null {
  return open(req.cookies.get(SESSION_COOKIE)?.value)
}

// ── Access-token claims (AEAD-trusted; only `exp` is re-checked) ─────────────────

/** The console-JWT claims the console reads. Casdoor packs the full user object; we
 *  extract ONLY display/authorization fields — never the secret material it also carries. */
export type ConsoleClaims = {
  owner?: string
  name?: string
  sub?: string
  type?: string
  email?: string
  emailVerified?: boolean
  isAdmin?: boolean
  isGlobalAdmin?: boolean
  displayName?: string
  avatar?: string
  accessKey?: string
  properties?: Record<string, string>
}

/** Access-token skew: treat a token expiring within this window as already stale so
 *  a refresh happens before any downstream sees an expired credential. */
const ACCESS_SKEW_MS = 60_000

/** Decode + project a JWT payload to the claims the console reads, WITHOUT signature
 *  verification. Safe ONLY for a token whose authenticity is already established — a
 *  freshly-minted grant token (`accessClaims`) or the AEAD-sealed session
 *  (`consoleClaims`). Returns null on a malformed token; Casdoor packs the full user
 *  object, so we project ONLY the display/authorization fields, never secret material. */
export function accessClaims(jwt: string): ConsoleClaims | null {
  const parts = jwt.split('.')
  if (parts.length < 2) return null
  let c: Record<string, unknown>
  try {
    c = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>
  } catch {
    return null
  }
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
  const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined)
  return {
    owner: str(c.owner),
    name: str(c.name),
    sub: str(c.sub),
    type: str(c.type),
    email: str(c.email),
    emailVerified: bool(c.emailVerified) ?? bool(c.email_verified),
    isAdmin: bool(c.isAdmin),
    isGlobalAdmin: bool(c.isGlobalAdmin),
    displayName: str(c.displayName),
    avatar: str(c.avatar),
    accessKey: str(c.accessKey),
    properties: c.properties && typeof c.properties === 'object' ? (c.properties as Record<string, string>) : undefined,
  }
}

/** The live console session for a request — its claims + remaining access lifetime
 *  (seconds) — or null when there is none (absent cookie, tampered seal, or an access
 *  token at/near expiry). ONE place owns the freshness check. */
export function consoleSession(req: NextRequest): { claims: ConsoleClaims; expiresInSec: number } | null {
  const s = readConsoleSession(req)
  if (!s || s.e <= Date.now() + ACCESS_SKEW_MS) return null // absent/stale → caller refreshes
  if (!s.c.name) return null
  return { claims: s.c, expiresInSec: Math.max(0, Math.floor((s.e - Date.now()) / 1000)) }
}

/** The unexpired console claims for a request, or null when there is no live session. */
export function consoleClaims(req: NextRequest): ConsoleClaims | null {
  return consoleSession(req)?.claims ?? null
}

// ── OAuth grants (server-side, confidential client) ──────────────────────────────

export type Tokens = { accessToken: string; refreshToken: string; expiresIn: number }

function basicAuth(): string {
  return 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')
}

/** POST the token endpoint with a form body, client_secret_basic auth. Throws a
 *  redacted error on a non-ok / error-envelope response (the caller maps to 401/502).
 *  Never logs the body — it carries tokens. */
async function tokenRequest(form: Record<string, string>): Promise<Tokens> {
  const body = new URLSearchParams({ ...form, scope: SCOPE }).toString()
  let res: Response
  try {
    res = await fetchWithTimeout(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: basicAuth(),
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body,
      cache: 'no-store',
    })
  } catch {
    throw new SessionError('token endpoint unreachable', 502)
  }
  const json = (await res.json().catch(() => null)) as
    | { access_token?: string; refresh_token?: string; expires_in?: number; error?: string }
    | null
  if (!json || json.error || !json.access_token) {
    // `invalid_grant` (bad/expired/revoked credential) → 401; anything else → 502.
    throw new SessionError('token grant failed', json?.error === 'invalid_grant' ? 401 : 502)
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? '',
    expiresIn: typeof json.expires_in === 'number' ? json.expires_in : 0,
  }
}

/** A grant/seal failure with the HTTP status a route should surface. */
export class SessionError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'SessionError'
    this.status = status
  }
}

/** Resource-Owner-Password grant for the FIRST-PARTY user (gated by the caller's
 *  already-established casibase session — see the /auth/session route — so it can
 *  only mint a console session for an already-authenticated, MFA-cleared user). */
export function passwordGrant(username: string, password: string): Promise<Tokens> {
  return tokenRequest({ grant_type: 'password', client_id: CLIENT_ID, username, password })
}

/** Refresh grant — rotates the refresh token (IAM returns a NEW one; persist it). */
export function refreshGrant(refreshToken: string): Promise<Tokens> {
  return tokenRequest({ grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: refreshToken })
}

/**
 * Seal a fresh token set into a cookie-ready value. Projects the access token to the
 * small claim set (`accessClaims`) and seals ONLY {refresh, exp, claims} — a compact,
 * browser-safe cookie. Returns the claims too (the routes use them for the account +
 * the identity-match check). null when the access token has no usable identity.
 */
export function sealSession(t: Tokens): { sealed: string; expiresInMs: number; claims: ConsoleClaims } | null {
  const claims = accessClaims(t.accessToken)
  if (!claims || !claims.name) return null
  const expiresInMs = (t.expiresIn > 0 ? t.expiresIn : 3600) * 1000
  const sealed = seal({ r: t.refreshToken, e: Date.now() + expiresInMs, c: claims })
  return { sealed, expiresInMs, claims }
}

/** Best-effort revoke of a refresh token on sign-out. Never throws (fail-open on the
 *  network — the cookie is cleared regardless; the token also expires on its own). */
export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  if (!refreshToken || !sessionConfigured()) return
  try {
    await fetchWithTimeout(REVOKE_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: basicAuth(),
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({ token: refreshToken, token_type_hint: 'refresh_token', client_id: CLIENT_ID }).toString(),
      cache: 'no-store',
    })
  } catch {
    /* fail-open: the cookie is cleared and the token expires regardless */
  }
}

/** Constant-time compare of two owner/name pairs (defense-in-depth for the
 *  session-vs-grant identity match in the /auth/session route). */
export function sameSubject(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}
