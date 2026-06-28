/**
 * Server-side session reader — the ONE place a privileged server route verifies
 * the caller's IAM session and authority.
 *
 * console2 keeps no session state of its own: the unified cloud `/v1` backend is
 * the session authority (it mints the first-party session cookie at `/v1/signin`
 * and answers `/v1/get-account`). So a server handler verifies the caller by
 * FORWARDING the request's own cookies to `/v1/get-account` and reading the
 * account back. Deny-by-default: no cookie, an anonymous session, a non-2xx, or
 * an unparseable body all resolve to "no account" (the caller returns 401).
 *
 * AUTHORITY IS PINNED (never request-derived). The `/v1/get-account` URL comes
 * from server-only `CLOUD_URL` (the in-cluster cloud-api), NOT from the request
 * origin/Host. A request-derived authority would let a `Host`/`X-Forwarded-Host`
 * spoof point the session check at an attacker host that forges an admin account
 * and defeats the gate. When no authority is pinned we FAIL SECURE (treat the
 * caller as unauthenticated) rather than trust the request.
 */

export type ServerAccount = {
  owner: string
  name: string
  isAdmin: boolean
  /** Backend's explicit global-admin verdict, if it ever serializes one. */
  isGlobalAdmin: boolean
  organization?: string
  type?: string
}

/**
 * Orgs whose members are GLOBAL platform admins (Hanzo staff). This mirrors the
 * IAM backend's own rule — `object.User.IsGlobalAdmin() == (Owner == conf.AdminOrg)`,
 * default admin org `"admin"`. `built-in` is casdoor's reserved system org (never
 * a tenant) kept as defense-in-depth. A tenant org (hanzo, lux, zoo, maxpower, …)
 * is NEVER global admin here — even when its member holds `isAdmin` (org-scoped
 * admin). The global platform control plane (`/paas`) requires THIS, not `isAdmin`.
 */
const GLOBAL_ADMIN_ORGS: ReadonlySet<string> = new Set(['admin', 'built-in'])

/**
 * The pinned cloud `/v1` base for a server-side session check. Server-only env
 * ONLY — never the request origin. `CLOUD_URL` is the canonical in-cluster
 * cloud-api (e.g. `http://cloud-api.hanzo.svc:8000`); `NEXT_PUBLIC_CLOUD_URL` is
 * a fixed fallback for dev/split-origin. Returns `''` when neither is set, which
 * makes `getServerAccount` fail secure.
 */
function backendBase(): string {
  return (process.env.CLOUD_URL ?? process.env.NEXT_PUBLIC_CLOUD_URL ?? '').replace(/\/+$/, '')
}

/**
 * The signed-in account for this request, or `null`. Never throws — every failure
 * (missing cookie, no pinned authority, network error, non-2xx, bad body,
 * anonymous casibase session) is treated as unauthenticated (fail secure). Makes
 * NO network call when there is no cookie or no pinned authority.
 */
export async function getServerAccount(cookie: string | null): Promise<ServerAccount | null> {
  if (!cookie) return null

  const base = backendBase()
  if (!base) return null // fail secure: no pinned authority → never trust the request

  let res: Response
  try {
    res = await fetch(`${base}/v1/get-account`, {
      headers: { cookie, accept: 'application/json' },
      cache: 'no-store',
    })
  } catch {
    return null
  }
  if (!res.ok) return null

  let env: unknown
  try {
    env = await res.json()
  } catch {
    return null
  }

  const data = (env as { data?: Record<string, unknown> } | null)?.data
  // casibase auto-creates an "anonymous-user" session — NOT a real sign-in.
  if (!data || typeof data.name !== 'string' || data.type === 'anonymous-user') return null

  return {
    owner: typeof data.owner === 'string' ? data.owner : '',
    name: data.name,
    isAdmin: data.isAdmin === true,
    isGlobalAdmin: data.isGlobalAdmin === true,
    organization: typeof data.organization === 'string' ? data.organization : undefined,
    type: typeof data.type === 'string' ? data.type : undefined,
  }
}

/**
 * Deny-by-default GLOBAL-admin predicate (also narrows the type for callers).
 * GLOBAL admin ⟺ the backend's own rule: member of the admin org, or an explicit
 * `isGlobalAdmin` verdict. NOT satisfied by org-scoped `isAdmin` — that is the C1
 * fix: a tenant org admin must never reach the global control plane.
 */
export const isGlobalAdminAccount = (a: ServerAccount | null): a is ServerAccount =>
  a != null && (a.isGlobalAdmin === true || GLOBAL_ADMIN_ORGS.has(a.owner))
