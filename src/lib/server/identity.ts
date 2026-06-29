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
  /** Verified email (get-account claim, else IAM get-user). '' when unknown. */
  email: string
  /** IAM-authoritative org-admin flag. */
  isAdmin: boolean
  /** True for built-in-org admins — may act across any tenant org. */
  isGlobalAdmin: boolean
}

type UserClaims = {
  owner?: string
  name?: string
  type?: string
  accessKey?: string
  email?: string
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

  // An auto-created casibase "anonymous-user" is NOT authenticated.
  if (!owner || !name || type === 'anonymous-user') return null

  const id = `${owner}/${name}`
  let email = d.email ?? d.User?.email ?? ''
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
      isAdmin = Boolean(u.isAdmin)
      isGlobalAdmin = Boolean(u.isGlobalAdmin) || (owner === ADMIN_ORG && isAdmin)
    }
  }

  return { owner, name, id, accessKey, email, isAdmin, isGlobalAdmin }
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
  /** Org the operator acts on by default — the brand org (== brand id). */
  orgScope: string
}

/**
 * Resolve + authorize the caller for the admin console of the request's brand.
 *
 * Requires BOTH: (1) the caller's verified email ends with `@<brand.adminDomain>`
 * (a hanzo.ai operator can't administer a lux host, and vice-versa), and (2) IAM
 * marks them an admin (`isAdmin`, or a built-in-org global admin). A global admin
 * may target any org; a brand admin is pinned to their own `orgScope`. Returns
 * null (→ caller 403s) on any miss — fail-closed.
 */
export async function getAdminGate(req: NextRequest): Promise<AdminGate | null> {
  const user = await resolveUser(req)
  if (!user) return null

  const brand = BRANDS[brandFromHost(req.headers.get('host'))]
  const emailOnBrand = !!user.email && user.email.toLowerCase().endsWith('@' + brand.adminDomain)
  const isIamAdmin = user.isAdmin || user.isGlobalAdmin
  if (!emailOnBrand || !isIamAdmin) return null

  return { user, brand, orgScope: brand.id }
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
