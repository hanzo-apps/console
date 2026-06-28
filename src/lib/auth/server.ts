/**
 * Server-side session reader — the ONE place a privileged server route verifies
 * the caller's IAM session and authority.
 *
 * console2 keeps no session state of its own: the unified cloud `/v1` backend is
 * the session authority (it mints the first-party session cookie at `/v1/signin`
 * and answers `/v1/get-account`). So a server handler verifies the caller by
 * FORWARDING the request's own cookies to `/v1/get-account` and reading the
 * account back. Deny-by-default: no cookie, an anonymous session, a non-2xx, or
 * an unparseable body all resolve to "no account" (the caller returns 401), and a
 * non-admin account is rejected with 403 — never the other way round.
 *
 * Same-origin by default (each console host's ingress proxies `/v1` to the cloud
 * backend, so the session cookie is first-party — matches `src/config` cloudUrl).
 * `CLOUD_URL` / `NEXT_PUBLIC_CLOUD_URL` override for split-origin/dev.
 */

export type ServerAccount = {
  owner: string
  name: string
  isAdmin: boolean
  organization?: string
  type?: string
}

/** Resolve the cloud `/v1` base for a server-side call (same-origin by default). */
function backendBase(origin: string): string {
  const env = process.env.CLOUD_URL ?? process.env.NEXT_PUBLIC_CLOUD_URL
  return (env ?? origin).replace(/\/+$/, '')
}

/**
 * The signed-in account for this request, or `null`. Never throws — every failure
 * (missing cookie, network error, non-2xx, bad body, anonymous casibase session)
 * is treated as unauthenticated (fail secure). Makes NO network call when there
 * is no cookie at all.
 */
export async function getServerAccount(
  cookie: string | null,
  origin: string,
): Promise<ServerAccount | null> {
  if (!cookie) return null

  let res: Response
  try {
    res = await fetch(`${backendBase(origin)}/v1/get-account`, {
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
    organization: typeof data.organization === 'string' ? data.organization : undefined,
    type: typeof data.type === 'string' ? data.type : undefined,
  }
}

/** Deny-by-default admin predicate (also narrows the type for callers). */
export const isAdminAccount = (a: ServerAccount | null): a is ServerAccount => a?.isAdmin === true
