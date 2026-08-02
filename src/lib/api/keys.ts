/**
 * Cloud API key client — the per-user `sk-` credential, via the console's OWN
 * same-origin `/keys` route (`app/keys/route.ts`). The server resolves the user
 * from the first-party session cookie and mints/reads/revokes through IAM as the
 * confidential `hanzo-console` client; the browser only ever sends its cookie.
 *
 * SAME-ORIGIN by construction (the fix for the money crack): the old client hit
 * `config.cloudUrl/v1/iam/keys` — a DIFFERENT origin than console.hanzo.ai — so
 * the browser `fetch` was blocked by CORS ("Failed to fetch"), and cloud-api's own
 * `/v1/iam/keys` handler 501s on this deployment regardless. Addressing the
 * console's own `/keys` route (which uses the working IAM `mint-user-keys` path)
 * keeps the request same-origin and the credential entirely server-side.
 *
 * The secret is returned ONLY by `create()` (show once). `status()` reports
 * existence + the public prefix, never secret material.
 */
import { ApiError, originV1Url } from './client'
import { IS_EMBED } from '~/lib/embed'
import { csrfRequired, csrfToken, clearCsrfToken, CSRF_HEADER } from './csrf'

export type KeyStatus = {
  hasKey: boolean
  keyPrefix: string
  /** When the key row last changed in IAM (mint/rotate), ISO; '' when unknown. */
  createdAt?: string
}

/**
 * The console's OWN same-origin key route (`<origin>/keys`); root-relative on the server.
 *
 * In the go:embed console (`IS_EMBED`) the `app/keys/route.ts` handler is stripped (no
 * Next server → the request falls through to the SPA shell), and the cloud binary serves
 * the canonical `sk-` key surface at `/v1/iam/keys` (clients/account/account.go — GET
 * status, POST mint, DELETE revoke), resolving the caller from the first-party IAM
 * session cookie. So the embed addresses `<origin>/v1/iam/keys` directly. Non-embed
 * hosts keep the Next `/keys` proxy (confidential mint client).
 */
const keysUrl = (): string =>
  IS_EMBED
    ? originV1Url('iam/keys')
    : typeof window !== 'undefined'
      ? `${window.location.origin}/keys`
      : '/keys'

async function keysReq<T>(method: 'GET' | 'POST' | 'DELETE'): Promise<T> {
  // In the embed build the mint/revoke write hits the cloud binary's ambient-cookie
  // `/v1/iam/keys` (requireCSRF), so echo the anti-CSRF token; a 403 = an
  // expired/rotated token → re-mint once and retry (blue's re-fetch-on-403 contract).
  const send = async (): Promise<Response> => {
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (csrfRequired(method)) {
      const token = await csrfToken()
      if (token) headers[CSRF_HEADER] = token
    }
    return fetch(keysUrl(), { method, credentials: 'include', headers })
  }
  let res: Response
  try {
    res = await send()
    if (res.status === 403 && csrfRequired(method)) {
      clearCsrfToken()
      res = await send()
    }
  } catch (e) {
    throw new ApiError(e instanceof Error ? e.message : 'Network request failed')
  }
  const json = (await res.json().catch(() => null)) as { error?: string } | null
  if (!res.ok) {
    throw new ApiError(json?.error || `Request failed (HTTP ${res.status})`, res.status)
  }
  return json as T
}

export const KeysApi = {
  /** Whether the account has a key, plus its public prefix (no secret). */
  status: () => keysReq<KeyStatus>('GET'),
  /** Mint (or rotate) the key; returns the full `sk-` key ONCE. */
  create: () => keysReq<{ accessKey: string }>('POST'),
  /** Revoke the key (the old key stops working). */
  revoke: () => keysReq<{ ok: boolean }>('DELETE'),
}
