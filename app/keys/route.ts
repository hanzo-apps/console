/**
 * Per-user `sk-` Cloud API key — the SAME-ORIGIN console route (the fix for the
 * API-keys "sign in to manage API keys" / CORS crack).
 *
 * The browser calls this OWN-origin route (`/keys`) with just its first-party
 * session cookie. This handler resolves the signed-in user from that cookie
 * (`resolveUser`) and mints/reads/revokes the key through IAM as the confidential
 * `hanzo-console` client (`identity.ts` `mintUserKey`/`getUserKey`/`revokeUserKey`,
 * over IAM `mint-user-keys`/`get-user`/`revoke-user-keys` — the WORKING key path,
 * verified live). No credential ever reaches the browser; the `sk-` secret is
 * returned ONLY by POST (show once).
 *
 * Why not `cloud.hanzo.ai/v1/iam/keys` (the old path): that is a DIFFERENT
 * ORIGIN than console.hanzo.ai, so a browser `fetch` is blocked by CORS ("Failed to
 * fetch") — and cloud-api's own keys handler 501s ("IAM client unset") on this
 * deployment anyway. The IAM confidential-client mint the console already uses for
 * `sk-` keys elsewhere (`app/ai` chat) is the ONE authoritative, same-origin,
 * always-working path — so the Org-Settings API-keys surface uses it too (DRY: the
 * exact primitives from `identity.ts`, no new IAM plumbing).
 *
 *   GET    → { hasKey, keyPrefix, createdAt }  (no secret)
 *   POST   → { accessKey }                       (mint/rotate; full sk- shown ONCE)
 *   DELETE → { ok: true }                        (revoke; the old key stops working)
 */
import { type NextRequest, NextResponse } from 'next/server'

import { resolveUser, mintUserKey, getUserKey, revokeUserKey, mintConfigured } from '~/lib/server/identity'
import { csrfRefusal } from '~/lib/server/bearer-proxy'

export const runtime = 'nodejs'

const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** 401 (not signed in) — the honest state the UI shows to sign in. */
function unauthorized() {
  return NextResponse.json({ error: 'Sign in to manage API keys.' }, { status: 401 })
}

/** GET — the user's current key state (existence + public prefix, NEVER the secret). */
export async function GET(req: NextRequest) {
  const user = await resolveUser(req)
  if (!user) return unauthorized()
  if (!mintConfigured()) {
    // Honest, non-leaking: the confidential client isn't wired on this deployment.
    return NextResponse.json({ error: 'API key management is not configured on this deployment.' }, { status: 501 })
  }
  try {
    const { accessKey, updatedAt } = await getUserKey(user)
    return NextResponse.json({
      hasKey: Boolean(accessKey),
      keyPrefix: accessKey ? accessKey.slice(0, 11) : '',
      createdAt: updatedAt || '',
    })
  } catch (e) {
    console.error('keys: could not read key state:', msgOf(e))
    return NextResponse.json({ error: 'Could not read the API key state.' }, { status: 502 })
  }
}

/** POST — mint (or rotate) the key. Returns the full `sk-` secret ONCE. */
export async function POST(req: NextRequest) {
  // CSRF: minting mutates (and is billable-adjacent) from the auto-sent cookie —
  // refuse a cross-origin request before any work.
  const csrf = csrfRefusal(req)
  if (csrf) return csrf
  const user = await resolveUser(req)
  if (!user) return unauthorized()
  if (!mintConfigured()) {
    return NextResponse.json({ error: 'API key management is not configured on this deployment.' }, { status: 501 })
  }
  try {
    const accessKey = await mintUserKey(user)
    return NextResponse.json({ accessKey })
  } catch (e) {
    console.error('keys: could not mint key:', msgOf(e))
    return NextResponse.json({ error: 'Could not create the API key.' }, { status: 502 })
  }
}

/** DELETE — revoke the key (the old key stops working; gateway cache ~5m). */
export async function DELETE(req: NextRequest) {
  const csrf = csrfRefusal(req)
  if (csrf) return csrf
  const user = await resolveUser(req)
  if (!user) return unauthorized()
  if (!mintConfigured()) {
    return NextResponse.json({ error: 'API key management is not configured on this deployment.' }, { status: 501 })
  }
  try {
    await revokeUserKey(user)
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('keys: could not revoke key:', msgOf(e))
    return NextResponse.json({ error: 'Could not revoke the API key.' }, { status: 502 })
  }
}
