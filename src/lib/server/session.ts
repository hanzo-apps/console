/**
 * Console OAuth session — THE ONE durable, refreshable token manager (server-only).
 *
 * WHY. The console's signed-in identity historically rested SOLELY on the cloud
 * casibase session cookie (`cloud_session_id`) — a session the console does not own
 * and cannot refresh, so it can lapse out from under a working tab and bounce the
 * user to /signin mid-task. There was no `grant_type=refresh_token` anywhere: nothing
 * kept a token warm.
 *
 * THE FIX (this module). On login the console ALSO obtains its OWN OAuth token set
 * for the signed-in user — a first-party confidential-client (`hanzo-console`) grant
 * WITH `offline_access`, so IAM returns an access token AND a rotating, revocable
 * refresh token. This is the PREFERRED identity source for the Auth (via
 * /auth/session) and the /v1 bearer-proxy (via resolveUser), silently refreshed
 * (proactively before expiry + reactively on a 401) via `grant_type=refresh_token`.
 * The casibase cookie stays exactly as-is underneath as the graceful FALLBACK.
 *
 * TWO COOKIES, by necessity (Casdoor tokens are ~3.6 KB full-user JWTs):
 *   - `hz_session` (Path=/, ~1 KB): the SEALED IDENTITY — {access-token expiry +
 *     the small projected claims the console reads}. resolveUser + every BFF proxy +
 *     /auth/session GET read this; it is small, so it rides every request with no
 *     header bloat and never trips a gateway header limit.
 *   - `hz_rt` (Path=/auth, chunked hz_rt0/hz_rt1/…): the SEALED REFRESH TOKEN. Scoped
 *     to /auth so the big blob is sent ONLY to /auth/refresh|session (never to /v1 or
 *     the BFF), and chunked because a sealed 3.6 KB token exceeds the browser 4 KB
 *     per-cookie cap. Both are sealed (AES-256-GCM) — a browser can neither read them
 *     (httpOnly) nor forge/inject them (AEAD), so a forged refresh cookie is refused.
 *
 * SECURITY POSTURE.
 *   - The refresh token NEVER reaches the browser's JS (httpOnly) and the refresh call
 *     is server-side (BFF). Sealed at rest in the cookie; rotation-aware (IAM rotates
 *     the refresh token one-time-use — we always persist the NEW one; a replay 400s).
 *   - The IAM access token (a Casdoor JWT that packs secret material — password hash,
 *     TOTP secret) is NEVER stored in a cookie, NEVER logged, NEVER returned to the
 *     client: `sealSession` projects it to the small display/authz claim set and
 *     discards the raw token.
 *   - The AEAD seal IS the integrity anchor: the sealed identity's claims are
 *     trustworthy without a JWKS round-trip (only `exp` is re-checked).
 */
// Server-only by construction: `node:crypto` + `next/server` cannot be bundled into a
// client chunk, so this module (and the tokens it seals) never reaches the browser.
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto'
import { type NextRequest, NextResponse } from 'next/server'

import { isAdminHost, isSuperAdminOwner, resolveConfig } from '~/config'
import { type Account } from '~/lib/api/types'
import { fetchWithTimeout } from './fetch-timeout'

const trim = (s: string) => s.replace(/\/+$/, '')

/** IAM OIDC host that serves the token endpoint. Server-side default is the
 *  in-cluster IAM service; the issuer inside the token stays `https://hanzo.id`. */
const IAM_OAUTH_URL = trim(process.env.IAM_OAUTH_URL?.trim() || process.env.IAM_URL?.trim() || 'https://hanzo.id')
const TOKEN_ENDPOINT = `${IAM_OAUTH_URL}/v1/iam/oauth/token`
const REVOKE_ENDPOINT = `${IAM_OAUTH_URL}/v1/iam/oauth/revoke`

/** The confidential first-party client (`hanzo-console`) — same creds the mint/
 *  issue-user-token primitives use. offline_access is required for a refresh token. */
const CLIENT_ID = process.env.IAM_MINT_CLIENT_ID ?? ''
const CLIENT_SECRET = process.env.IAM_MINT_CLIENT_SECRET ?? ''
const SCOPE = 'openid profile email offline_access'

/** True when the confidential client is wired (routes 501/skip cleanly otherwise). */
export const sessionConfigured = (): boolean => Boolean(CLIENT_ID && CLIENT_SECRET)

// ── Cookies ─────────────────────────────────────────────────────────────────────

/** Small sealed IDENTITY cookie (Path=/, read by resolveUser + every BFF proxy). */
export const SESSION_COOKIE = 'hz_session'
/** Sealed REFRESH-token cookie family (Path=/auth, chunked). */
export const REFRESH_COOKIE = 'hz_rt'
/** The refresh cookie is scoped here so the big blob rides ONLY the /auth routes. */
const REFRESH_PATH = '/auth'
/** Max refresh chunks we ever write/read/clear. 4 × ~3.6 KB ≫ any real token. */
const MAX_REFRESH_CHUNKS = 4
/** Value bytes per chunk — comfortably under the browser ~4 KB per-cookie cap. */
const CHUNK_BYTES = 3600
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

const cookie = (name: string, value: string, path: string, maxAge: number): CookieDirective => ({
  name,
  value,
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path,
  maxAge,
})

/** Split a sealed string into ≤CHUNK_BYTES pieces (Casdoor tokens exceed one cookie). */
function chunk(s: string): string[] {
  const out: string[] = []
  for (let i = 0; i < s.length; i += CHUNK_BYTES) out.push(s.slice(i, i + CHUNK_BYTES))
  return out.length ? out : ['']
}

/** The Set-Cookie directives that store an identity + a (chunked) refresh token. */
export function setCookies(sealedIdentity: string, sealedRefresh: string): CookieDirective[] {
  const parts = chunk(sealedRefresh)
  const dirs: CookieDirective[] = [cookie(SESSION_COOKIE, sealedIdentity, '/', COOKIE_MAX_AGE_S)]
  for (let i = 0; i < MAX_REFRESH_CHUNKS; i++) {
    // Write present chunks; blank+expire any stale higher chunk from a prior larger token.
    const present = i < parts.length
    dirs.push(cookie(`${REFRESH_COOKIE}${i}`, present ? parts[i] : '', REFRESH_PATH, present ? COOKIE_MAX_AGE_S : 0))
  }
  return dirs
}

/** The Set-Cookie directives that CLEAR every session cookie (sign-out). */
export function clearCookies(): CookieDirective[] {
  const dirs: CookieDirective[] = [cookie(SESSION_COOKIE, '', '/', 0)]
  for (let i = 0; i < MAX_REFRESH_CHUNKS; i++) dirs.push(cookie(`${REFRESH_COOKIE}${i}`, '', REFRESH_PATH, 0))
  return dirs
}

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
  // feature is simply inert there. When the secret IS present, HKDF derives a stable
  // key shared across replicas.
  cachedKey = ikm
    ? Buffer.from(hkdfSync('sha256', Buffer.from(ikm), Buffer.alloc(0), Buffer.from('hz-console-session-v1'), 32))
    : randomBytes(32)
  return cachedKey
}

/** Seal a JSON-serializable value into a compact base64url(iv|tag|ciphertext) string. */
export function seal(value: unknown): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', sealKey(), iv)
  const ct = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, ct]).toString('base64url')
}

/** Open a sealed string; null on any tamper/format/decrypt failure (fail-closed). */
export function open<T>(sealed: string | undefined | null): T | null {
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
    return JSON.parse(pt) as T
  } catch {
    return null
  }
}

// ── Identity + refresh (what the cookies carry) ──────────────────────────────────

/** The console-JWT claims the console reads. Casdoor packs the full user object; we
 *  extract ONLY display/authz fields — never the secret material it also carries. */
export type ConsoleClaims = {
  owner?: string
  name?: string
  sub?: string
  type?: string
  email?: string
  emailVerified?: boolean
  isAdmin?: boolean
  /** Canonical SuperAdmin wire claim. */
  isSuperAdmin?: boolean
  displayName?: string
  avatar?: string
  accessKey?: string
  properties?: Record<string, string>
}

/** The sealed IDENTITY cookie payload: access-token expiry + projected claims. */
type Identity = { e: number; c: ConsoleClaims }

/** Access-token skew: treat a token expiring within this window as already stale so
 *  a refresh happens before any downstream sees an expired credential. */
const ACCESS_SKEW_MS = 60_000

/** Decode + project a JWT payload to the claims the console reads, WITHOUT signature
 *  verification. Safe ONLY for a token whose authenticity is already established — a
 *  freshly-minted grant token here. Returns null on a malformed token; projects ONLY
 *  display/authz fields, never secret material. */
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
    // SuperAdmin ⟺ the principal's org (owner) IS the reserved `admin` org — the ONE
    // predicate, derived owner-canonically here too (matching accountOf), never read
    // from a JWT boolean claim. The gateway no longer mints an isSuperAdmin/
    // isGlobalAdmin boolean; owner==admin is the sole signal, so a token can't carry a
    // sudo bit its org doesn't earn.
    isSuperAdmin: isSuperAdminOwner(str(c.owner)),
    displayName: str(c.displayName),
    avatar: str(c.avatar),
    accessKey: str(c.accessKey),
    properties: c.properties && typeof c.properties === 'object' ? (c.properties as Record<string, string>) : undefined,
  }
}

/** Read the sealed identity cookie (null when absent/tampered). */
function readIdentity(req: NextRequest): Identity | null {
  const id = open<Identity>(req.cookies.get(SESSION_COOKIE)?.value)
  if (!id || typeof id.e !== 'number' || !id.c || typeof id.c !== 'object') return null
  return id
}

/** Read + reassemble + open the chunked refresh cookie (null when absent/tampered). */
export function readRefreshToken(req: NextRequest): string | null {
  let joined = ''
  for (let i = 0; i < MAX_REFRESH_CHUNKS; i++) {
    const part = req.cookies.get(`${REFRESH_COOKIE}${i}`)?.value
    if (!part) break
    joined += part
  }
  if (!joined) return null
  const obj = open<{ t: string }>(joined)
  return obj && typeof obj.t === 'string' ? obj.t : null
}

/** The live console session for a request — its claims + remaining access lifetime
 *  (seconds) — or null when there is none (absent/tampered cookie, or an access token
 *  at/near expiry). ONE place owns the freshness check. */
export function consoleSession(req: NextRequest): { claims: ConsoleClaims; expiresInSec: number } | null {
  const id = readIdentity(req)
  if (!id || id.e <= Date.now() + ACCESS_SKEW_MS || !id.c.name) return null
  return { claims: id.c, expiresInSec: Math.max(0, Math.floor((id.e - Date.now()) / 1000)) }
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

/** A grant/seal failure with the HTTP status a route should surface. `code` carries
 *  the OAuth error envelope value (`invalid_grant`, `authorization_pending`, …) when
 *  the failure is a definitive OAuth error — the device poll reads it to tell the
 *  RFC 8628 polling states (pending/slow_down/expired) apart from a hard failure. */
export class SessionError extends Error {
  readonly status: number
  readonly code?: string
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'SessionError'
    this.status = status
    this.code = code
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** POST the token endpoint with a form body. `confidential` (default) sends
 *  client_secret_basic — the first-party `hanzo-console` client. A PUBLIC grant sends
 *  NO Authorization header: it authenticates by `client_id` + `code_verifier`/
 *  `refresh_token` (RFC 7636/6749), so the public `admin-console` app is redeemed and
 *  refreshed WITHOUT provisioning its secret. Throws a redacted error on a non-ok /
 *  error-envelope response (the caller maps to 401/502). Never logs the body — tokens.
 *
 *  RESILIENCE: a TRANSIENT upstream failure — a network error OR a NON-JSON/empty body
 *  (IAM mid-roll on its Recreate strategy, a 5xx page, or the SPA-HTML catch-all) — is
 *  retried once with a short backoff before surfacing a 502, so a momentary IAM blip
 *  self-heals instead of bouncing a live session (the `/auth/refresh` 502). A definitive
 *  OAuth error ENVELOPE (`invalid_grant`, `server_error`, …) is NOT retried — it is the
 *  real answer (invalid_grant → 401, else 502). */
async function tokenRequest(form: Record<string, string>, confidential = true): Promise<Tokens> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  }
  if (confidential) headers.Authorization = basicAuth()
  const body = new URLSearchParams(form).toString()

  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await sleep(300)
    let res: Response
    try {
      res = await fetchWithTimeout(TOKEN_ENDPOINT, { method: 'POST', headers, body, cache: 'no-store' })
    } catch {
      continue // network error → transient, retry once then give up
    }
    const json = (await res.json().catch(() => null)) as
      | { access_token?: string; refresh_token?: string; expires_in?: number; error?: string }
      | null
    if (json?.access_token) {
      return {
        accessToken: json.access_token,
        refreshToken: json.refresh_token ?? '',
        expiresIn: typeof json.expires_in === 'number' ? json.expires_in : 0,
      }
    }
    // A real OAuth error envelope is definitive — do not retry. Carry the error code
    // so the device poll can map the RFC 8628 states (authorization_pending/slow_down/
    // expired_token) rather than treat them as hard failures.
    if (json?.error) throw new SessionError('token grant failed', json.error === 'invalid_grant' ? 401 : 502, json.error)
    // Non-JSON / empty body (a 5xx page or the SPA-HTML catch-all) → transient, retry.
  }
  throw new SessionError('token endpoint unavailable', 502)
}

/** Resource-Owner-Password grant for the FIRST-PARTY user (gated by the caller's
 *  already-established casibase session — see the /auth/session route). Confidential. */
export function passwordGrant(username: string, password: string): Promise<Tokens> {
  return tokenRequest({ grant_type: 'password', client_id: CLIENT_ID, username, password, scope: SCOPE })
}

/**
 * Refresh grant — rotates the refresh token (IAM returns a NEW one; persist it).
 * `publicClientId` set (admin hosts) refreshes the PUBLIC `admin-console` session with
 * client_id only — no secret, since that is the app that MINTED the token; absent (tenant
 * hosts) refreshes the confidential `hanzo-console` session with client_secret_basic.
 */
export function refreshGrant(refreshToken: string, publicClientId?: string): Promise<Tokens> {
  return publicClientId
    ? tokenRequest({ grant_type: 'refresh_token', client_id: publicClientId, refresh_token: refreshToken, scope: SCOPE }, false)
    : tokenRequest({ grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: refreshToken, scope: SCOPE })
}

/**
 * PUBLIC authorization-code + PKCE grant (RFC 7636). No client secret: the
 * `codeVerifier` authenticates the exchange, so the PUBLIC `admin-console` app — the
 * client the admin credential login minted the code for — is redeemed WITHOUT its
 * secret. IAM verifies S256(codeVerifier) == the stored code_challenge and, the secret
 * being empty, admits the exchange. `clientId` is host-resolved by the caller
 * (`durableSessionClientId`), the ONE place host→client lives. Admin hosts only; tenant
 * hosts redeem via the cloud backend's confidential client.
 */
export function pkceCodeGrant(opts: {
  clientId: string
  code: string
  codeVerifier: string
  redirectUri: string
}): Promise<Tokens> {
  return tokenRequest(
    {
      grant_type: 'authorization_code',
      client_id: opts.clientId,
      code: opts.code,
      code_verifier: opts.codeVerifier,
      redirect_uri: opts.redirectUri,
    },
    false,
  )
}

/** RFC 8628 device authorization grant identifier. */
const DEVICE_CODE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'

/** Outcome of one device_code poll. `ok` carries the sealed session material (identity +
 *  refresh + claims + lifetime — the exact shape sealSession returns) ready for the cookie
 *  writer; `pending` = keep polling; `expired` = the code lapsed, restart the flow. */
export type DeviceGrantResult =
  | ({ status: 'ok' } & NonNullable<ReturnType<typeof sealSession>>)
  | { status: 'pending' }
  | { status: 'expired' }

/**
 * Redeem an APPROVED device authorization (RFC 8628) — the console is the "device".
 * PUBLIC client (no secret): the device_code + `clientId` authenticate the exchange,
 * mirroring how a native device app polls. Maps the polling states off the OAuth error
 * envelope: authorization_pending/slow_down → `pending`, expired_token → `expired`; a
 * hard error (invalid_client, unsupported_grant_type, …) still throws a SessionError.
 * On success it SEALS the session (reuses sealSession) so the caller just sets cookies.
 */
export async function deviceCodeGrant(deviceCode: string, clientId: string): Promise<DeviceGrantResult> {
  let tokens: Tokens
  try {
    tokens = await tokenRequest({ grant_type: DEVICE_CODE_GRANT, client_id: clientId, device_code: deviceCode }, false)
  } catch (e) {
    if (e instanceof SessionError) {
      if (e.code === 'authorization_pending' || e.code === 'slow_down') return { status: 'pending' }
      if (e.code === 'expired_token') return { status: 'expired' }
    }
    throw e
  }
  const sealed = sealSession(tokens)
  if (!sealed) throw new SessionError('device grant produced no identity', 502)
  return { status: 'ok', ...sealed }
}

/**
 * Turn a fresh token set into the cookie material. Projects the access token to the
 * small claim set (sealed into the identity cookie) and seals the rotating refresh
 * token separately (chunked into the /auth-scoped cookie). Returns the two sealed
 * strings + the claims + lifetime; null when the access token has no usable identity.
 */
export function sealSession(
  t: Tokens,
): { identity: string; refresh: string; claims: ConsoleClaims; expiresInMs: number } | null {
  const claims = accessClaims(t.accessToken)
  if (!claims || !claims.name) return null
  const expiresInMs = (t.expiresIn > 0 ? t.expiresIn : 3600) * 1000
  const identity = seal({ e: Date.now() + expiresInMs, c: claims } satisfies Identity)
  const refresh = seal({ t: t.refreshToken })
  return { identity, refresh, claims, expiresInMs }
}

/** Best-effort revoke of a refresh token on sign-out. Never throws (fail-open on the
 *  network — the cookies are cleared regardless; the token also expires on its own). */
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
    /* fail-open: the cookies are cleared and the token expires regardless */
  }
}

/** Constant-time compare of two owner/name pairs (defense-in-depth for the
 *  session-vs-grant identity match in the /auth/session route). */
export function sameSubject(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}


// ── Host-aware durable-session client + shared route helpers ─────────────────────

/**
 * Which OAuth client the console's DURABLE session uses on `host`. An admin host
 * (admin.<brand>) rests on the PUBLIC `admin-console` app — redeemed (`pkceCodeGrant`)
 * and refreshed (`refreshGrant`) with NO secret, matching how the code was authorized —
 * so this returns its client id. Every other host uses the confidential `hanzo-console`
 * client (returns null → the basic-auth path). ONE host→client decision, shared by the
 * /auth/signin redemption and the /auth/refresh rotation.
 */
export function durableSessionClientId(host?: string | null): string | null {
  return isAdminHost(host) ? resolveConfig(host ?? undefined).iamClientId : null
}

/** Project session claims to the client-facing Account (display + admin fields only —
 *  never the secret material Casdoor also packs). `owner === 'admin'` implies
 *  SuperAdmin. Shared by /auth/session (GET) and /auth/signin. */
export function accountOf(c: ConsoleClaims): Account {
  return {
    owner: c.owner ?? '',
    name: c.name ?? '',
    type: c.type,
    displayName: c.displayName,
    email: c.email,
    avatar: c.avatar,
    isAdmin: c.isAdmin,
    // THE predicate, one way: SuperAdmin ⟺ the principal's org IS the reserved
    // admin org (isSuperAdminOwner). IAM derives its `isSuperAdmin` claim from the
    // same equality, so reading the claim too would be two signals for one fact.
    isSuperAdmin: isSuperAdminOwner(c.owner),
    properties: c.properties,
  }
}

/** Apply cookie directives to a NextResponse — the ONE writer shared by every auth
 *  route that mints or clears the session cookies. */
export function applyCookies(res: NextResponse, dirs: CookieDirective[]): NextResponse {
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
