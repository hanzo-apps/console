'use client'

/**
 * PKCE (RFC 7636) — the ONE place the console derives a `code_verifier` + its S256
 * `code_challenge`.
 *
 * Used ONLY on an admin host (admin.<brand>): there the credential login mints the
 * OAuth code for the PUBLIC `admin-console` client, which the console redeems ITSELF
 * (server-side BFF, no client secret) — so it authorizes with PKCE and the verifier
 * authenticates the exchange. Browser-only by construction (Web Crypto + btoa).
 *
 * The challenge is base64url, UNPADDED — byte-for-byte what IAM's `pkceChallenge`
 * (base64.URLEncoding.WithPadding(NoPadding) of SHA-256(verifier)) recomputes, so the
 * two always agree.
 */

/** base64url (unpadded) of raw bytes — the encoding IAM verifies against. */
function b64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export type Pkce = { verifier: string; challenge: string }

/** A fresh high-entropy verifier and its S256 challenge. */
export async function createPkce(): Promise<Pkce> {
  const random = new Uint8Array(32)
  crypto.getRandomValues(random)
  const verifier = b64url(random)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: b64url(new Uint8Array(digest)) }
}
