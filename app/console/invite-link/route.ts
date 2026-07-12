/**
 * POST /console/invite-link — mint a shareable ACCEPT LINK for a pending member.
 *
 * The Team module creates the member row via the `/org/iam` proxy (Dave's own
 * user bearer, Casbin-scoped to his org) — that path is unchanged. This route then
 * mints the sealed, TTL-bound invite token so the invitee can set a password and
 * sign in, WITHOUT any email/OTP (delivery is a link hand-off; IAM `send-invitation`
 * is a documented stub on this deployment).
 *
 * Gate: any authenticated ORG ADMIN, pinned to a member of their OWN org (a global
 * admin may target any org — same policy as the `/org/iam` proxy). The member must
 * actually EXIST in that org (verified via the confidential client) — so an admin
 * can never mint an activation link for someone else's tenant or a phantom user.
 */
import { type NextRequest, NextResponse } from 'next/server'

import { getOrgGate, getMember } from '~/lib/server/identity'
import { ownerAllowed, orgWriteAllowed } from '~/lib/server/admin-policy'
import { csrfRefusal } from '~/lib/server/bearer-proxy'
import { signInvite, acceptLink, type Invite } from '~/lib/server/invite'

export const runtime = 'nodejs'

const bad = (msg: string, status: number) => NextResponse.json({ error: msg }, { status })

/** The public origin the invitee will open — from the ingress-set Host header. */
function publicOrigin(req: NextRequest): string {
  const host = req.headers.get('host') ?? req.nextUrl.host
  const proto = req.headers.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const csrf = csrfRefusal(req)
  if (csrf) return csrf

  const gate = await getOrgGate(req)
  if (!gate) return bad('forbidden', 403)
  // Writes (an invite is one) require org admin — a member can view the roster only.
  if (!orgWriteAllowed({ isSuperAdmin: gate.isSuperAdmin, isAdmin: gate.user.isAdmin })) {
    return bad('forbidden', 403)
  }

  let body: { org?: unknown; name?: unknown; email?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return bad('bad request', 400)
  }
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const email = typeof body.email === 'string' ? body.email.trim() : ''
  // The org defaults to the caller's own scope; a SuperAdmin may pass another.
  const reqOrg = typeof body.org === 'string' && body.org.trim() ? body.org.trim() : gate.orgScope
  if (!name) return bad('missing member name', 400)

  // Pin the org to the caller's scope (a non-SuperAdmin can only ever mint a link
  // for their OWN org) — the SAME guard as the /org/iam proxy.
  if (!ownerAllowed(reqOrg, { isSuperAdmin: gate.isSuperAdmin, orgScope: gate.orgScope, orgMetadataOk: false })) {
    return bad('forbidden', 403)
  }

  const id = `${reqOrg}/${name}`
  const member = await getMember(id)
  if (!member || member.owner !== reqOrg) return bad('member not found', 404)

  const inv: Invite = { org: reqOrg, name, email: email || member.email || '' }
  const token = signInvite(inv)
  return NextResponse.json({ ok: true, org: reqOrg, name, email: inv.email, link: acceptLink(publicOrigin(req), token) })
}
