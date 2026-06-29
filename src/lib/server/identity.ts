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

const trim = (s: string) => s.replace(/\/+$/, '')

/** IAM OIDC issuer host that serves the privileged primitives (/v1/iam/*). */
const IAM_URL = trim(process.env.IAM_URL ?? 'https://iam.hanzo.ai')
/** Cloud `/v1` backend (hanzoai/ai) — resolves the session cookie to a user. */
const CLOUD_API_URL = trim(process.env.CLOUD_API_URL ?? 'http://cloud-api.hanzo.svc.cluster.local:8000')
/** Confidential client used for app-on-behalf mint/issue/revoke. */
const MINT_CLIENT_ID = process.env.IAM_MINT_CLIENT_ID ?? ''
const MINT_CLIENT_SECRET = process.env.IAM_MINT_CLIENT_SECRET ?? ''

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
}

type AccountClaims = {
  owner?: string
  name?: string
  type?: string
  accessKey?: string
  User?: { owner?: string; name?: string; type?: string; accessKey?: string }
}

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

  return { owner, name, id: `${owner}/${name}`, accessKey }
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
