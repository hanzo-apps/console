/**
 * Cloud API key management — the per-user `hk-` credential, minted server-side.
 *
 * Same-origin (`/keys`): the browser sends only its first-party session cookie;
 * this server handler resolves the user from that cookie and calls IAM as the
 * confidential `hanzo-console` client on the user's behalf. The `hk-` secret is
 * returned to the browser ONLY at creation (POST) — standard show-once handling —
 * and is otherwise never echoed. Authorization is the user's own session: a
 * caller can only ever mint/revoke their OWN key (IAM binds the id to the
 * resolved session), never another tenant's.
 *
 *   POST   /keys  → mint (or rotate) the key; returns { accessKey } once.
 *   DELETE /keys  → revoke the key (the old key stops working).
 *   GET    /keys  → whether a key exists (no secret material).
 */
import { type NextRequest, NextResponse } from 'next/server'

import { resolveUser, mintUserKey, revokeUserKey, mintConfigured } from '~/lib/server/identity'

export const runtime = 'nodejs'

const unauthorized = () =>
  NextResponse.json({ error: 'Sign in to manage API keys.' }, { status: 401 })

const notConfigured = () =>
  NextResponse.json(
    { error: 'API key minting is not configured on this deployment (IAM client unset).' },
    { status: 501 },
  )

export async function GET(req: NextRequest): Promise<NextResponse> {
  const user = await resolveUser(req)
  if (!user) return unauthorized()
  // No secret material on GET — only whether a key exists and its public prefix.
  const hasKey = Boolean(user.accessKey)
  return NextResponse.json({
    hasKey,
    keyPrefix: hasKey ? user.accessKey.slice(0, 11) : '',
  })
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const user = await resolveUser(req)
  if (!user) return unauthorized()
  if (!mintConfigured()) return notConfigured()
  try {
    const accessKey = await mintUserKey(user)
    return NextResponse.json({ accessKey })
  } catch (e) {
    return NextResponse.json(
      { error: `Could not mint an API key: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    )
  }
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const user = await resolveUser(req)
  if (!user) return unauthorized()
  if (!mintConfigured()) return notConfigured()
  try {
    await revokeUserKey(user)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json(
      { error: `Could not revoke the API key: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    )
  }
}
