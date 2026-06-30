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
 *   - the per-user `hk-` Cloud API key (mint/revoke) — the durable credential the
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

const trim = (s: string) => s.replace(/\/+$/, '')

/** IAM OIDC issuer host that serves the privileged primitives (/v1/iam/*). */
const IAM_URL = trim(process.env.IAM_URL ?? 'https://iam.hanzo.ai')
/** Cloud `/v1` backend (hanzoai/ai) — resolves the session cookie to a user. */
const CLOUD_API_URL = trim(process.env.CLOUD_API_URL ?? 'http://cloud-api.hanzo.svc.cluster.local:8000')
/**
 * In-cluster Hanzo KMS (kmsd) — the admin KMS proxy forwards here. Default is the
 * ClusterIP `Service kms` (ns hanzo), whose port 80 targets the kmsd container's
 * :8080 (universe `infra/k8s/kms/deployment.yaml`). Override per-deploy with KMS_URL.
 */
const KMS_URL = trim(process.env.KMS_URL ?? 'http://kms.hanzo.svc')
/** Confidential client used for app-on-behalf mint/issue/revoke. */
const MINT_CLIENT_ID = process.env.IAM_MINT_CLIENT_ID ?? ''
const MINT_CLIENT_SECRET = process.env.IAM_MINT_CLIENT_SECRET ?? ''
/** casdoor's built-in admin org — a user in it is a global (cross-tenant) admin. */
const ADMIN_ORG = 'built-in'

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
  /** The user's current `hk-` Cloud API key, if one exists (else ''). */
  accessKey: string
  /** Email (get-account claim, else IAM get-user). '' when unknown. */
  email: string
  /** IAM-authoritative email-verified flag. The admin gate requires it. */
  emailVerified: boolean
  /** IAM-authoritative org-admin flag. */
  isAdmin: boolean
  /** True for built-in-org admins — may act across any tenant org. */
  isGlobalAdmin: boolean
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
  isGlobalAdmin?: boolean
}

type AccountClaims = UserClaims & { User?: UserClaims }

/**
 * Resolve the signed-in user from the request's first-party cloud session cookie
 * by asking the cloud backend `/v1/get-account` (which itself refreshes the user
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

async function resolveSessionUser(
  req: NextRequest,
  opts: { requireOwner: boolean },
): Promise<SessionUser | null> {
  const cookie = req.headers.get('cookie')
  if (!cookie) return null

  let res: Response
  try {
    res = await fetch(`${CLOUD_API_URL}/v1/get-account`, {
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
  // a bare UUID (casdoor's `id` field, e.g. 113d4dd4-…) makes it throw "wrong token
  // count" (the live Models-catalog failure for org-member accounts that carry an
  // `id`). So always prefer `<owner>/<name>` when both are present; the explicit
  // UUID is only a last-resort fallback for an owner-less account.
  const id = owner && name ? `${owner}/${name}` : (explicitId || name)
  if (!id) return null
  let email = d.email ?? d.User?.email ?? ''
  let emailVerified = Boolean(d.emailVerified ?? d.User?.emailVerified)
  let isAdmin = Boolean(d.isAdmin ?? d.User?.isAdmin)
  let isGlobalAdmin = Boolean(d.isGlobalAdmin ?? d.User?.isGlobalAdmin) || (owner === ADMIN_ORG && isAdmin)

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
      isGlobalAdmin = Boolean(u.isGlobalAdmin) || (owner === ADMIN_ORG && isAdmin)
    }
  }

  return { owner, name, id, accessKey, email, emailVerified, isAdmin, isGlobalAdmin }
}

/**
 * Read a user's authoritative identity claims (email + admin flags) from IAM as
 * the confidential client. GET, Basic auth — same credential the mint/issue
 * primitives use. Fail-soft (returns null) so a transient IAM error never opens
 * the admin gate.
 */
async function iamGetUser(id: string): Promise<UserClaims | null> {
  if (!mintConfigured()) return null
  let res: Response
  try {
    res = await fetch(`${IAM_URL}/v1/iam/get-user?id=${encodeURIComponent(id)}`, {
      headers: { Authorization: basicAuth(), Accept: 'application/json' },
      cache: 'no-store',
    })
  } catch {
    return null
  }
  const json = (await res.json().catch(() => null)) as { status?: string; data?: UserClaims } | null
  if (!res.ok || !json || json.status !== 'ok' || !json.data) return null
  return json.data
}

function basicAuth(): string {
  return 'Basic ' + Buffer.from(`${MINT_CLIENT_ID}:${MINT_CLIENT_SECRET}`).toString('base64')
}

/**
 * POST a privileged IAM primitive as the confidential client, on behalf of a
 * resolved user. Throws on any non-ok envelope so callers map it to a 5xx.
 */
async function iamCall<T = Record<string, unknown>>(
  path: string,
  query: Record<string, string>,
): Promise<T> {
  const qs = new URLSearchParams(query).toString()
  const res = await fetch(`${IAM_URL}${path}?${qs}`, {
    method: 'POST',
    headers: { Authorization: basicAuth(), Accept: 'application/json' },
    cache: 'no-store',
  })
  const json = (await res.json().catch(() => null)) as { status?: string; msg?: string; data?: T } | null
  if (!res.ok || !json || json.status !== 'ok') {
    throw new Error(json?.msg || `IAM ${path} failed (HTTP ${res.status})`)
  }
  return (json.data ?? ({} as T))
}

/** (Re)generate the user's `hk-` Cloud API key; returns the new key (shown once). */
export async function mintUserKey(user: SessionUser): Promise<string> {
  const data = await iamCall<{ accessKey?: string }>('/v1/iam/mint-user-keys', { id: user.id })
  const key = data.accessKey ?? ''
  if (!key) throw new Error('IAM did not return an access key')
  return key
}

/** Clear the user's `hk-` Cloud API key (immediate revoke; gateway cache ~5m). */
export async function revokeUserKey(user: SessionUser): Promise<void> {
  await iamCall('/v1/iam/revoke-user-keys', { id: user.id })
}

/** Issue a short-lived, user-bound IAM JWT for the AI proxy to forward. */
export async function issueUserToken(user: SessionUser): Promise<{ accessToken: string; expiresIn: number }> {
  const data = await iamCall<{ accessToken?: string; expiresIn?: number }>('/v1/iam/issue-user-token', {
    id: user.id,
  })
  if (!data.accessToken) throw new Error('IAM did not return a token')
  return { accessToken: data.accessToken, expiresIn: data.expiresIn ?? 0 }
}

// ── Org onboarding (create org + move the caller into it) ─────────────────────
// The confidential `hanzo-console` client is allowlisted for BOTH the org-admin
// (IAM_ORG_ADMIN_APPS) and user-admin (IAM_USER_ADMIN_APPS) capabilities, so it
// may create an organization and make the signed-in user that org's admin. The
// cloud backend scopes all data by the user's IAM `owner` (GetEffectiveOrg →
// session user.Owner), and a casdoor user belongs to exactly ONE org, so giving
// a zero-org user their own org means MOVING them into it (owner=slug,
// isAdmin=true). The user's password travels with the user row (verification
// uses user.PasswordType first — object/check.go), so the move never locks them
// out; we still clone the source org's password/locale settings so the new org
// is well-formed (and covers a user whose PasswordType is empty).

/** A casdoor organization as IAM returns it (only the fields we read/clone). */
type IamOrganization = {
  owner?: string
  name?: string
  displayName?: string
  passwordType?: string
  passwordSalt?: string
  passwordObfuscatorType?: string
  passwordObfuscatorKey?: string
  passwordOptions?: string[]
  countryCodes?: string[]
  languages?: string[]
  defaultAvatar?: string
  accountItems?: unknown[]
  [k: string]: unknown
}

/** GET an IAM resource as the confidential client; null when absent/unreadable. */
async function iamGetData<T>(path: string, query: Record<string, string>): Promise<T | null> {
  if (!mintConfigured()) return null
  const qs = new URLSearchParams(query).toString()
  let res: Response
  try {
    res = await fetch(`${IAM_URL}${path}?${qs}`, {
      headers: { Authorization: basicAuth(), Accept: 'application/json' },
      cache: 'no-store',
    })
  } catch {
    return null
  }
  const json = (await res.json().catch(() => null)) as { status?: string; data?: T } | null
  if (!res.ok || !json || json.status !== 'ok' || json.data == null) return null
  return json.data
}

/** POST a JSON body to an IAM primitive as the confidential client. */
async function iamPostBody<T = unknown>(
  path: string,
  query: Record<string, string>,
  body: unknown,
): Promise<T> {
  const qs = new URLSearchParams(query).toString()
  const res = await fetch(`${IAM_URL}${path}${qs ? `?${qs}` : ''}`, {
    method: 'POST',
    headers: { Authorization: basicAuth(), Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  })
  const json = (await res.json().catch(() => null)) as { status?: string; msg?: string; data?: T } | null
  if (!res.ok || !json || json.status !== 'ok') {
    throw new Error(json?.msg || `IAM ${path} failed (HTTP ${res.status})`)
  }
  return (json.data ?? ({} as T))
}

/** Read an organization (owned by casdoor's `admin`) by name; null when absent. */
export async function getOrganization(name: string): Promise<IamOrganization | null> {
  return iamGetData<IamOrganization>('/v1/iam/get-organization', { id: `admin/${name}` })
}

/**
 * Create a customer organization. Clones password + locale settings from the
 * caller's current org (so the org is well-formed and the moved user's login is
 * unaffected) and clears all instance-specific material (apps, logos, master
 * secrets, MFA). The org is owned by casdoor's `admin`; `isPersonal` marks a
 * personal org (the "skip" path).
 */
export async function createOrganization(opts: {
  name: string
  displayName: string
  personal: boolean
  /** The caller's current org, cloned for password/locale compatibility. */
  sourceOwner: string
}): Promise<void> {
  const src = await getOrganization(opts.sourceOwner)
  const org: IamOrganization = {
    owner: 'admin',
    name: opts.name,
    displayName: opts.displayName,
    createdTime: new Date().toISOString(),
    isPersonal: opts.personal,
    // Cloned for compatibility (best-effort; sane casdoor defaults otherwise).
    passwordType: src?.passwordType || 'bcrypt',
    passwordSalt: src?.passwordSalt || '',
    passwordObfuscatorType: src?.passwordObfuscatorType || 'Plain',
    passwordObfuscatorKey: src?.passwordObfuscatorKey || '',
    passwordOptions: src?.passwordOptions ?? ['AtLeast6'],
    countryCodes: src?.countryCodes ?? ['US'],
    languages: src?.languages ?? ['en'],
    defaultAvatar: src?.defaultAvatar || 'https://cdn.hanzo.ai/img/hanzo-cloud-user.png',
    accountItems: src?.accountItems ?? [],
    // Never inherited — each org gets its own (or none) of these.
    defaultApplication: '',
    logo: '',
    logoDark: '',
    favicon: '',
    masterPassword: '',
    defaultPassword: '',
    masterVerificationCode: '',
    mfaItems: [],
    tags: [],
    websiteUrl: '',
    enableSoftDeletion: false,
    isProfilePublic: false,
  }
  await iamPostBody('/v1/iam/add-organization', {}, org)
}

/**
 * Move a user into `org` as that org's admin. Sends the FULL current user object
 * (casdoor's update-user overwrites the default column set from the body, so a
 * partial object would blank fields) with owner + isAdmin changed. The caller is
 * always the signed-in user (the route binds the id to the session), so this can
 * only ever move oneself.
 */
export async function moveUserToOrg(user: SessionUser, org: string): Promise<void> {
  const current = await iamGetData<Record<string, unknown>>('/v1/iam/get-user', { id: user.id })
  if (!current) throw new Error('Could not read the current user from IAM')
  const moved = { ...current, owner: org, isAdmin: true }
  await iamPostBody('/v1/iam/update-user', { id: user.id }, moved)
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
   * blanket brand org. A global admin may override per-request (`?org=`). */
  orgScope: string
}

/**
 * Resolve + authorize the caller for the admin console of the request's brand.
 *
 * Requires ALL of: (1) a VERIFIED email ending `@<brand.adminDomain>` (a hanzo.ai
 * operator can't administer a lux host, and vice-versa), and (2) IAM marks them an
 * admin (`isAdmin`, or a built-in-org global admin). The operator's default
 * `orgScope` is THEIR OWN org (`user.owner`) — the IAM/KMS proxies pin a non-global
 * admin to it so one tenant's admin can never read/write another's. Returns null
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

// ── Admin bearer-token cache ─────────────────────────────────────────────────
// The admin proxies forward as the user (not the confidential client) so IAM/KMS
// enforce tenant isolation from the verified `owner` claim. issue-user-token is
// an IAM round-trip; cache the JWT per user until ~60s before expiry (same shape
// as the AI proxy) so a console session reuses one token across admin calls.
type CachedToken = { token: string; expMs: number }
const adminTokenCache = new Map<string, CachedToken>()
const ADMIN_TOKEN_SKEW_MS = 60_000
const ADMIN_TOKEN_FALLBACK_TTL_MS = 5 * 60_000

/** A short-lived, user-bound IAM bearer for the admin proxies (cached per user). */
export async function adminBearer(user: SessionUser): Promise<string> {
  const hit = adminTokenCache.get(user.id)
  if (hit && hit.expMs > Date.now()) return hit.token
  const { accessToken, expiresIn } = await issueUserToken(user)
  const ttl = expiresIn > 0 ? expiresIn * 1000 : ADMIN_TOKEN_FALLBACK_TTL_MS
  adminTokenCache.set(user.id, { token: accessToken, expMs: Date.now() + ttl - ADMIN_TOKEN_SKEW_MS })
  return accessToken
}
