/**
 * Cloud API key client — the per-user `hk-` credential, via the console's OWN
 * same-origin `/keys` route (`app/keys/route.ts`). The server resolves the user
 * from the first-party session cookie and mints/reads/revokes through IAM as the
 * confidential `hanzo-console` client; the browser only ever sends its cookie.
 *
 * SAME-ORIGIN by construction (the fix for the money crack): the old client hit
 * `config.cloudUrl/v1/console/keys` — a DIFFERENT origin than console.hanzo.ai — so
 * the browser `fetch` was blocked by CORS ("Failed to fetch"), and cloud-api's own
 * `/v1/console/keys` handler 501s on this deployment regardless. Addressing the
 * console's own `/keys` route (which uses the working IAM `mint-user-keys` path)
 * keeps the request same-origin and the credential entirely server-side.
 *
 * The secret is returned ONLY by `create()` (show once). `status()` reports
 * existence + the public prefix, never secret material.
 */
import { ApiError } from './client'

export type KeyStatus = {
  hasKey: boolean
  keyPrefix: string
  /** When the key row last changed in IAM (mint/rotate), ISO; '' when unknown. */
  createdAt?: string
}

/** The console's OWN same-origin key route (`<origin>/keys`); root-relative on the server. */
const keysUrl = (): string => (typeof window !== 'undefined' ? `${window.location.origin}/keys` : '/keys')

async function keysReq<T>(method: 'GET' | 'POST' | 'DELETE'): Promise<T> {
  let res: Response
  try {
    res = await fetch(keysUrl(), {
      method,
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
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
  /** Mint (or rotate) the key; returns the full `hk-` key ONCE. */
  create: () => keysReq<{ accessKey: string }>('POST'),
  /** Revoke the key (the old key stops working). */
  revoke: () => keysReq<{ ok: boolean }>('DELETE'),
}
