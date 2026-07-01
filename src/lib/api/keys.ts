/**
 * Cloud API key client — the per-user `hk-` credential, via the console's OWN
 * same-origin `/keys` server route (NOT the cloud `/v1` backend). The server
 * resolves the user from the session cookie and mints/revokes through IAM as the
 * confidential console client; the browser only ever sends its cookie.
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

async function keysReq<T>(method: 'GET' | 'POST' | 'DELETE'): Promise<T> {
  let res: Response
  try {
    res = await fetch('/keys', {
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
