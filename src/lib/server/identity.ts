/**
 * Server-only identity helpers — the trust boundary for privileged IAM ops.
 *
 * The browser never holds a long-lived credential or talks to IAM directly. The
 * console SERVER (this module, imported only by route handlers) resolves WHO the
 * caller is from their first-party cloud session cookie, then acts on their
 * behalf as the confidential `hanzo-console` client (clientId+clientSecret,
 * allowlisted in IAM_KEY_MINT_ALLOWED_APPS) — the same app-on-behalf pattern the
 * IAM mint/issue/revoke primitives are designed for.
 *
 * Two distinct credentials come out of IAM, never mixed:
 *   - the per-user `sk-` Cloud API key (mint/revoke) — the durable credential the
 *     user copies into SDKs/CLI; shown ONCE at creation, then revocable.
 *   - a short-lived, user-bound JWT (issue-user-token) — a forward-and-discard
 *     credential the AI proxy uses to call the gateway on the user's behalf, so
 *     no key ever reaches the browser and nothing is rotated on a chat turn.
 *
 * Every value here is server-only env (sourced from KMS via the deployment's
 * secret refs) — NEVER `NEXT_PUBLIC_`, never in the browser bundle.
 */
import { type NextRequest } from 'next/server'

import { brandFromHost } from '~/config'
import { BRANDS, type Brand } from '~/lib/branding/brands'
import { emailOnBrand, gateAllows } from './admin-policy'
import { fetchWithTimeout } from './fetch-timeout'
import { consoleClaims, type ConsoleClaims } from './session'

const trim = (s: string) => s.replace(/\/+$/, '')

/** IAM OIDC issuer host that serves the privileged primitives (/v1/iam/*). */
const IAM_URL = trim(process.env.IAM_URL ?? 'https://iam.hanzo.ai')
/** Cloud `/v1` backend (hanzoai/ai) — resolves the session cookie to a user. */
const CLOUD_API_URL = trim(process.env.CLOUD_API_URL ?? 'http://cloud.hanzo.svc.cluster.local:8000')
/**
 * Hanzo KMS backing the admin KMS proxy. Repointed to the EMBEDDED KMS in the
 * unified cloud binary (`hanzoai/cloud` clients/kms serves /v1/kms natively, per
 * HIP-0106) — the ClusterIP `Service cloud` (ns hanzo) on :8000 — replacing the
 * legacy standalone Infisical fork at `kms.hanzo.svc`. The proxy forwards to
 * `${KMS_URL}/v1/kms/orgs/{org}/secrets`, which the embedded KMS serves.
 * Override per-deploy with KMS_URL.
 *
 * DEPENDENCY (not a blocker): the embedded KMS is HEALTH-ONLY (secret ops 503)
 * until the operator provisions its master key (CLOUD_KMS_MASTER_KEY_REF) and the
 * secrets are migrated. So this repoint is correct, but the KMS module will show
 * its honest "backend not initialized" state until that lands — no fabricated
 * secrets, and the module is designed for exactly that state.
 */
const KMS_URL = trim(process.env.KMS_URL ?? 'http://cloud.hanzo.svc:8000')
/** Confidential client used for app-on-behalf mint/issue/revoke. */
const MINT_CLIENT_ID = process.env.IAM_MINT_CLIENT_ID ?? ''
const MINT_CLIENT_SECRET = process.env.IAM_MINT_CLIENT_SECRET ?? ''
/** THE SuperAdmin org — standardized as `admin` across the whole stack (IAM,
 *  commerce, ai, gateway all gate cross-tenant on owner=="admin"). A member-admin
 *  of `admin` is a SuperAdmin (cross-tenant). A tenant org owner (hanzo, maxpower,
 *  …) is NEVER a SuperAdmin, even with org-level isAdmin. One admin org, one way. */
const ADMIN_ORG = 'admin'
const isAdminOrg = (owner: string): boolean => owner === ADMIN_ORG

/** IAM base URL (the admin IAM proxy forwards `/v1/iam/*` here). */
export const iamBaseUrl = (): string => IAM_URL
/** KMS base URL (the admin KMS proxy forwards `/v1/kms/*` here). */
export const kmsBaseUrl = (): string => KMS_URL

/** True when the confidential client is wired (so routes can 501 honestly). */
export const mintConfigured = (): boolean => Boolean(MINT_CLIENT_ID && MINT_CLIENT_SECRET)

/** The authenticated caller, resolved from their own session — never the client. */
export type SessionUser = {
  /** Org slug (IAM owner / X-Org-Id). */
  owner: string
  /** Username within the org. */
  name: string
  /** `<owner>/<name>` — the IAM user id the privileged ops target. */
  id: string
  /** The user's current `sk-` Cloud API key, if one exists (else ''). */
  accessKey: string
  /** Email (get-account claim, else IAM get-user). '' when unknown. */
  email: string
  /** IAM-authoritative email-verified flag. The admin gate requires it. */
  emailVerified: boolean
  /** IAM-authoritative org-admin flag. */
  isAdmin: boolean
  /** SuperAdmin: an `admin`-org member — may act across any tenant org. */
  isSuperAdmin: boolean
}

type UserClaims = {
  id?: string
  owner?: string
  name?: string
  type?: string
  accessKey?: string
  email?: string
  emailVerified?: boolean
  isAdmin?: boolean
  /** Canonical SuperAdmin wire claim. */
  isSuperAdmin?: boolean
}

type AccountClaims = UserClaims & { User?: UserClaims }

/**
 * Resolve the signed-in user from the request's first-party cloud session cookie
 * by asking the cloud backend `/v1/iam/get-account` (which itself refreshes the user
 * from IAM). Returns null when there is no real session (no cookie, anonymous
 * casibase session, or a backend error) so callers fail CLOSED with 401.
 */
export async function resolveUser(req: NextRequest): Promise<SessionUser | null> {
  return resolveSessionUser(req, { requireOwner: true })
}

/**
 * Resolve an authenticated session even when IAM has not assigned the user to an
 * org yet. This is intentionally only for first-run org onboarding; normal
 * privileged routes must keep using resolveUser() so they never act unscoped.
 */
export async function resolveAuthenticatedUser(req: NextRequest): Promise<SessionUser | null> {
  return resolveSessionUser(req, { requireOwner: false })
}

/**
 * Map console-OAuth-session claims (the `hz_session` access token) to a SessionUser.
 * The console JWT carries the full user object, so this needs no IAM round-trip. An
 * anonymous/nameless claim yields null. Shares the exact id/owner/admin semantics as
 * the casibase branch below (ONE meaning of a principal, two credential sources).
 */
function sessionUserFromClaims(c: ConsoleClaims): SessionUser | null {
  const owner = c.owner ?? ''
  const name = c.name ?? ''
  if (!name || c.type === 'anonymous-user') return null
  // IAM's privileged ops parse `<owner>/<name>`; prefer it, fall back to sub/name.
  const id = owner && name ? `${owner}/${name}` : (c.sub || name)
  if (!id) return null
  return {
    owner,
    name,
    id,
    accessKey: c.accessKey ?? '',
    email: c.email ?? '',
    emailVerified: Boolean(c.emailVerified),
    isAdmin: Boolean(c.isAdmin),
    // Canonical: the `isSuperAdmin` claim OR an `admin`-org member is SuperAdmin.
    isSuperAdmin: Boolean(c.isSuperAdmin) || isAdminOrg(owner),
  }
}

async function resolveSessionUser(
  req: NextRequest,
  opts: { requireOwner: boolean },
): Promise<SessionUser | null> {
  // Prefer the console's OWN OAuth session (durable + silently refreshed): a live,
  // AEAD-sealed `hz_session` access token resolves the principal with no IAM
  // round-trip. This is what makes the AuthGate + every BFF proxy independent of the
  // casibase session cookie's lifetime (the fix for the mid-task bounce). When the
  // access token is stale/absent the client refreshes it (proactively + on a 401);
  // meanwhile we fall through to the casibase session so nothing is worse than today.
  const cc = consoleClaims(req)
  if (cc) {
    const u = sessionUserFromClaims(cc)
    if (u && (!opts.requireOwner || u.owner)) return u
  }

  const cookie = req.headers.get('cookie')
  if (!cookie) return null

  let res: Response
  try {
    res = await fetchWithTimeout(`${CLOUD_API_URL}/v1/iam/get-account`, {
      headers: { cookie, Accept: 'application/json' },
      cache: 'no-store',
    })
  } catch {
    return null
  }
  if (!res.ok) return null

  const json = (await res.json().catch(() => null)) as { status?: string; data?: AccountClaims } | null
  if (!json || json.status !== 'ok' || !json.data) return null

  const d = json.data
  const owner = d.owner ?? d.User?.owner ?? ''
  const name = d.name ?? d.User?.name ?? ''
  const type = d.type ?? d.User?.type ?? ''
  const accessKey = d.accessKey ?? d.User?.accessKey ?? ''
  const explicitId = d.id ?? d.User?.id ?? ''

  // An auto-created casibase "anonymous-user" is NOT authenticated.
  if (!name || type === 'anonymous-user') return null
  if (opts.requireOwner && !owner) return null

  // IAM's privileged ops (issue-user-token, mint/revoke-user-keys) parse this id
  // with GetOwnerAndNameFromId, which REQUIRES the `<owner>/<name>` composite key —
  // a bare UUID (e.g. 113d4dd4-…) makes it throw "wrong token
  // count" (the live Models-catalog failure for org-member accounts that carry an
  // `id`). So always prefer `<owner>/<name>` when both are present; the explicit
  // UUID is only a last-resort fallback for an owner-less account.
  const id = owner && name ? `${owner}/${name}` : (explicitId || name)
  if (!id) return null
  let email = d.email ?? d.User?.email ?? ''
  let emailVerified = Boolean(d.emailVerified ?? d.User?.emailVerified)
  let isAdmin = Boolean(d.isAdmin ?? d.User?.isAdmin)
  // Canonical: the `isSuperAdmin` claim OR an `admin`-org member is SuperAdmin.
  let isSuperAdmin =
    Boolean(d.isSuperAdmin ?? d.User?.isSuperAdmin) || isAdminOrg(owner)

  // get-account may not carry email/isAdmin (thin claims). When email is absent,
  // IAM is authoritative — fetch the user as the confidential client to resolve
  // email + admin flags before any gate decision. Fail-soft: a null lookup leaves
  // the fields empty and the @adminDomain gate refuses (fail-closed).
  if (!email) {
    const u = await iamGetUser(id)
    if (u) {
      email = u.email ?? ''
      emailVerified = Boolean(u.emailVerified)
      isAdmin = Boolean(u.isAdmin)
      // Canonical: the `isSuperAdmin` claim OR an `admin`-org member is SuperAdmin.
      isSuperAdmin = Boolean(u.isSuperAdmin) || isAdminOrg(owner)
    }
  }

  return { owner, name, id, accessKey, email, emailVerified, isAdmin, isSuperAdmin }
}

function basicAuth(): string {
  return 'Basic ' + Buffer.from(`${MINT_CLIENT_ID}:${MINT_CLIENT_SECRET}`).toString('base64')
}

/**
 * IAM's genuine-absence answer, verbatim (`internal/compat/aliases.go` getHandler).
 * It arrives as HTTP **200**: `httpx.Err` is 200 by contract — the SDK is told to
 * "branch on status, not HTTP code" — so absence is an ENVELOPE fact, never a 404.
 */
const ABSENT = 'the entity does not exist'

/** An IAM answer we could not act on. `absent` marks the ONE benign kind. */
class IamError extends Error {
  constructor(
    message: string,
    readonly absent = false,
  ) {
    super(message)
  }
}

/**
 * THE IAM call — one transport, one error convention: it returns data or throws.
 *
 * IAM answers three DIFFERENT things and they must stay three (v1.33.31 made org
 * scoping honour-or-refuse in `internal/authz/authz.go` `Scope`):
 *
 *   hit      200 `{status:"ok", data}`                       → the data
 *   absence  200 `{status:"error", msg:"<ABSENT>"}`          → throw, `absent`
 *   refusal  403 `{status:"error", msg:"forbidden: …"}`      → throw (authz.Deny)
 *
 * plus an unreachable IAM and a malformed envelope, which are also throws. Only a
 * caller for whom "no such row" is a legitimate answer may soften `absent`. A
 * refusal, a network error and an absence collapsed into one `null` is how a
 * caller decides a taken slug is free and writes over it, or tells an invitee
 * their membership was revoked when IAM merely would not answer — so this
 * function never collapses them.
 *
 * `method` is explicit because IAM has param-only POSTs (mint/revoke/issue take
 * their id in the query and no body). Same shape as cloud's Go client
 * (`apps/account/iam.go` `do`), so the fleet has ONE IAM call convention.
 */
async function iam<T>(
  method: 'GET' | 'POST',
  path: string,
  query: Record<string, string>,
  body?: unknown,
): Promise<T> {
  if (!mintConfigured()) {
    throw new IamError(`IAM ${path} refused: no confidential client is configured`)
  }
  const qs = new URLSearchParams(query).toString()
  let res: Response
  try {
    res = await fetchWithTimeout(`${IAM_URL}${path}${qs ? `?${qs}` : ''}`, {
      method,
      headers: {
        Authorization: basicAuth(),
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      cache: 'no-store',
    })
  } catch (e) {
    throw new IamError(`IAM ${path} unreachable: ${e instanceof Error ? e.message : String(e)}`)
  }
  const json = (await res.json().catch(() => null)) as
    | { status?: string; msg?: string; data?: T }
    | null
  // A non-2xx is an authorization or transport verdict, never a statement about
  // whether the row exists.
  if (!res.ok) throw new IamError(json?.msg || `IAM ${path} failed (HTTP ${res.status})`)
  if (!json || json.status !== 'ok') {
    const msg = json?.msg || `IAM ${path} returned an unreadable response`
    throw new IamError(msg, msg === ABSENT)
  }
  return (json.data ?? null) as T
}

/**
 * Read a row whose ABSENCE is a legitimate answer: the data, or `null` when IAM
 * says there is no such row. Every other failure — a refusal, an unreachable IAM,
 * a malformed envelope — propagates, so `null` here means "IAM says it does not
 * exist", never "we could not find out".
 */
async function iamGetOrAbsent<T>(path: string, query: Record<string, string>): Promise<T | null> {
  try {
    return await iam<T>('GET', path, query)
  } catch (e) {
    if (e instanceof IamError && e.absent) return null
    throw e
  }
}

/**
 * A user's authoritative identity claims (email + admin flags), read as the
 * confidential client. Fail-SOFT by design and safe: the admin gate needs
 * POSITIVE evidence (a verified brand-domain email AND an IAM admin flag), so
 * empty claims deny. Softening every failure here can only ever close the gate —
 * the opposite of the existence probes above, where a softened failure would
 * authorize a write.
 */
async function iamGetUser(id: string): Promise<UserClaims | null> {
  return iam<UserClaims>('GET', '/v1/iam/get-user', { id }).catch(() => null)
}

/** (Re)generate the user's `sk-` Cloud API key; returns the new key (shown once). */
export async function mintUserKey(user: SessionUser): Promise<string> {
  const data = await iam<{ accessKey?: string } | null>('POST', '/v1/iam/mint-user-keys', {
    id: user.id,
  })
  const key = data?.accessKey ?? ''
  if (!key) throw new Error('IAM did not return an access key')
  return key
}

/** Clear the user's `sk-` Cloud API key (immediate revoke; gateway cache ~5m). */
export async function revokeUserKey(user: SessionUser): Promise<void> {
  await iam('POST', '/v1/iam/revoke-user-keys', { id: user.id })
}

/**
 * The user's CURRENT `sk-` key state, read AUTHORITATIVELY from IAM (`get-user`),
 * not from the cloud `get-account` session claim.
 *
 * Why: the `sk-` key IS `User.AccessKey` in IAM. Minting sets it there (a
 * column-scoped write), but the console's cloud session (`get-account`) does NOT
 * carry the freshly-minted `accessKey` — it returns '' — so `GET /keys` reported
 * `hasKey:false` and the page reverted to the empty "Create" state, hiding an
 * active key (uncopyable, unrevocable, and re-minted as a duplicate). IAM
 * `get-user?id=<owner>/<name>` returns the real `accessKey` (+ the user's
 * `updatedTime`, the last time the key row changed). Basic-auth confidential
 * client.
 *
 * An unreadable IAM must NOT report "no key": that is the very bug above, and a
 * refusal would recreate it — the page falls back to "Create", the live key is
 * hidden, and the user mints a duplicate over a key they can no longer revoke. So
 * only a genuine absence is an honest empty; anything else throws and `GET /keys`
 * answers 502 (it already maps a throw that way).
 */
export async function getUserKey(user: SessionUser): Promise<{ accessKey: string; updatedAt: string }> {
  const u = await iamGetOrAbsent<{ accessKey?: string; updatedTime?: string }>(
    '/v1/iam/get-user',
    { id: user.id },
  )
  return { accessKey: u?.accessKey ?? '', updatedAt: u?.updatedTime ?? '' }
}

/**
 * Issue a short-lived, user-bound IAM JWT for a BFF proxy to forward.
 *
 * `audience` (RFC 8707 resource) binds the token to the resource server that will
 * consume it (e.g. the cloud API `aud=<brand>-cloud`), so that server's audience
 * allowlist accepts it INDEPENDENT of which app the target user calls home. This is
 * the keystone of the admin path: the reserved-admin operator's own app is
 * `admin-console`, which cloud does NOT trust — passing the cloud audience makes the
 * forwarded bearer (owner=admin, isAdmin=true) validate. Omitted → IAM defaults the
 * `aud` to the target user's own app (correct for a same-app consumer, and unchanged
 * for the tenant proxies).
 */
export async function issueUserToken(
  user: SessionUser,
  audience?: string,
): Promise<{ accessToken: string; expiresIn: number }> {
  const query: Record<string, string> = { id: user.id }
  if (audience) query.aud = audience
  const data = await iam<{ accessToken?: string; expiresIn?: number } | null>(
    'POST',
    '/v1/iam/issue-user-token',
    query,
  )
  if (!data?.accessToken) throw new Error('IAM did not return a token')
  return { accessToken: data.accessToken, expiresIn: data.expiresIn ?? 0 }
}

// ── Team-invite acceptance (activate a pending member) ───────────────────────
// An org admin's invite creates a real member row (owner=org, isAdmin=role) with
// NO password — it can't sign in yet ("pending"). The accept flow lets the invitee
// set that password themselves via a sealed invite token (see server/invite.ts).
// Both ops use the SAME confidential client as the key/token primitives (already
// allowlisted for user-admin), so no new IAM capability is required.

/** An IAM member row (only the fields the accept flow reads/writes). */
export type IamMember = {
  owner?: string
  name?: string
  email?: string
  displayName?: string
  password?: string
  signupApplication?: string
  isAdmin?: boolean
  [k: string]: unknown
}

/**
 * Read a member (`<owner>/<name>`) as the confidential client.
 *
 * `null` means IAM says there is no such member — the ONE thing the callers may
 * treat as "this invite no longer names anyone". A refusal or an unreachable IAM
 * throws instead, because reporting those as absence tells an invitee their
 * membership was revoked when IAM simply would not answer, and it is the same
 * `null` the activation guard reads.
 */
export async function getMember(id: string): Promise<IamMember | null> {
  return iamGetOrAbsent<IamMember>('/v1/iam/get-user', { id })
}

/**
 * True when the member already has a login credential set. IAM returns the stored
 * hash (or a masked `***`) for a set password, and `''` when none was ever set — so
 * a non-empty value (either form) means "already activated". This is what makes an
 * invite link single-use for activation and refuses to reset an active member.
 */
export function memberHasPassword(m: IamMember | null): boolean {
  const p = m?.password
  return typeof p === 'string' && p.length > 0
}

/**
 * Activate a pending member: set their initial password (IAM hashes it via the
 * org's policy — argon2id/bcrypt — and REFUSES to persist plaintext, see
 * object/user.go UpdateUser's passwordChanged path). Sends the FULL current row
 * with only password/displayName/signupApplication changed (update-user overwrites
 * the default column set, so a partial would blank fields). Throws on any failure.
 *
 * Idempotency/safety is the CALLER's: refuse when `memberHasPassword` is already
 * true, so an accept link can never overwrite an active member's credential.
 */
export async function activateMember(
  id: string,
  opts: { password: string; displayName?: string; signupApplication?: string },
): Promise<void> {
  const current = await iam<IamMember | null>('GET', '/v1/iam/get-user', { id })
  if (!current) throw new Error('Could not read the member from IAM')
  const updated: IamMember = {
    ...current,
    // Plaintext in — update-user hashes it (org policy) because it differs from the
    // empty stored password. Do NOT set passwordType, or hashing is skipped.
    password: opts.password,
  }
  // Pin the EXACT columns to write. Casibase's update-user default column set does
  // NOT include `password`, and it only auto-appends the password columns when a
  // non-empty `columns` is supplied — so with no columns, UpdateUserPassword hashes
  // the value in memory but the column is never persisted (the credential silently
  // stays empty). Naming the password columns explicitly guarantees the hashed
  // password + salt + type are written.
  const columns = ['password', 'password_salt', 'password_type']
  if (opts.displayName) {
    updated.displayName = opts.displayName
    columns.push('display_name')
  }
  if (opts.signupApplication) {
    updated.signupApplication = opts.signupApplication
    columns.push('signup_application')
  }
  await iam('POST', '/v1/iam/update-user', { id, columns: columns.join(',') }, updated)
}

// ── Admin gate ───────────────────────────────────────────────────────────────
// The trust boundary for the admin console (IAM + KMS proxies). Resolves WHO the
// caller is from their own session, then enforces TWO authoritative checks: the
// caller's verified email is on the host's brand admin domain, AND IAM marks them
// an admin. Returns the gate context, or null so the route returns 403.

/** The authorized admin context for the request's brand. */
export type AdminGate = {
  user: SessionUser
  /** Brand resolved from the request Host header (DRY: `brandFromHost`). */
  brand: Brand
  /** Org the operator acts on by default — their OWN org (`user.owner`), never a
   * blanket brand org. A SuperAdmin may override per-request (`?org=`). */
  orgScope: string
}

/**
 * Resolve + authorize the caller for the admin console of the request's brand.
 *
 * Requires ALL of: (1) a VERIFIED email ending `@<brand.adminDomain>` (a hanzo.ai
 * operator can't administer a lux host, and vice-versa), and (2) IAM marks them an
 * admin (`isAdmin`, or an admin-org SuperAdmin). The operator's default
 * `orgScope` is THEIR OWN org (`user.owner`) — the IAM/KMS proxies pin a
 * non-SuperAdmin to it so one tenant's admin can never read/write another's. Returns null
 * (→ caller 403s) on any miss — fail-closed.
 */
export async function getAdminGate(req: NextRequest): Promise<AdminGate | null> {
  let user = await resolveUser(req)
  if (!user) return null

  const brand = BRANDS[brandFromHost(req.headers.get('host'))]

  // get-account claims can be thin (email present, emailVerified absent). For a
  // brand-domain candidate that isn't already verified, confirm authoritatively
  // via IAM so a genuinely-verified admin isn't denied on a thin claim — and an
  // unverified one stays denied (fail-closed).
  if (!user.emailVerified && emailOnBrand(user.email, brand.adminDomain)) {
    const u = await iamGetUser(user.id)
    if (u?.emailVerified) user = { ...user, emailVerified: true }
  }

  // ONE policy, tested in admin-policy.test.ts: VERIFIED @<adminDomain> email AND
  // an IAM admin flag. Fail-closed (→ caller 403s) on any miss.
  if (!gateAllows(user, brand.adminDomain)) return null

  return { user, brand, orgScope: user.owner }
}

// ── Org member gate ──────────────────────────────────────────────────────────
// The trust boundary for the SELF-SERVICE org member proxy (/org/iam), which lets
// a CUSTOMER manage their OWN org — the /admin/iam gate above is SuperAdmin-only, so a
// tenant org owner (e.g. Dave/maxpower) could never reach it. Here any
// authenticated user with an org is admitted; the proxy then scopes reads to the
// caller's own org and requires org-admin for writes (fail-closed on either miss).

/** A resolved principal for the org proxy: who, whether SuperAdmin, and their org. */
export type IamGate = { user: SessionUser; isSuperAdmin: boolean; orgScope: string }

/**
 * Resolve the caller for the org member proxy. Returns null (→ 403) when there is
 * no authenticated session with an org. The proxy pins every reference to
 * `orgScope` (the caller's own org) unless the caller is a SuperAdmin, so one
 * tenant can never read or write another's members.
 */
export async function getOrgGate(req: NextRequest): Promise<IamGate | null> {
  const user = await resolveUser(req)
  if (!user) return null
  return { user, isSuperAdmin: user.isSuperAdmin, orgScope: user.owner }
}

// ── Admin bearer-token cache ─────────────────────────────────────────────────
// The BFF proxies forward as the user (not the confidential client) so the backend
// enforces tenant isolation from the verified `owner` claim. issue-user-token is an
// IAM round-trip; cache the JWT until ~60s before expiry (same shape as the AI proxy)
// so a console session reuses one token across calls. Keyed by (user, audience): a
// token minted for one resource server's audience must NOT be handed to a proxy that
// needs a different one — the admin-aggregate scopes its bearer to the cloud audience
// while the tenant proxies mint the default (target-app) audience, and both coexist.
type CachedToken = { token: string; expMs: number }
const adminTokenCache = new Map<string, CachedToken>()
const ADMIN_TOKEN_SKEW_MS = 60_000
const ADMIN_TOKEN_FALLBACK_TTL_MS = 5 * 60_000

/** A short-lived, user-bound IAM bearer for a BFF proxy, optionally scoped to a
 *  resource-server `audience` (RFC 8707). Cached per (user, audience). */
export async function adminBearer(user: SessionUser, audience?: string): Promise<string> {
  const key = `${user.id} ${audience ?? ''}`
  const hit = adminTokenCache.get(key)
  if (hit && hit.expMs > Date.now()) return hit.token
  const { accessToken, expiresIn } = await issueUserToken(user, audience)
  const ttl = expiresIn > 0 ? expiresIn * 1000 : ADMIN_TOKEN_FALLBACK_TTL_MS
  adminTokenCache.set(key, { token: accessToken, expMs: Date.now() + ttl - ADMIN_TOKEN_SKEW_MS })
  return accessToken
}
