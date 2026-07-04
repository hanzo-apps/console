/**
 * /console/accept — the invitee's side of the team-invite flow (UNAUTHENTICATED).
 *
 *   GET  ?t=<token>  → validate the sealed invite; report whether the member is
 *                      still PENDING (no password) or already ACTIVATED, plus the
 *                      org + email to show. Never leaks anything a token-holder
 *                      shouldn't already know (the admin put them in the org).
 *   POST { t, password, displayName? } → set the pending member's INITIAL password
 *                      (IAM hashes it — never plaintext) and mark them activated.
 *
 * The sealed token IS the authorization (it names exactly one `org/name`), so this
 * needs no session — the invitee has none yet. It refuses once the member already
 * has a password, so a link can never reset an active member's credential.
 */
import { type NextRequest, NextResponse } from 'next/server'

import { brandFromHost } from '~/config'
import { BRANDS } from '~/lib/branding/brands'
import { csrfRefusal } from '~/lib/server/bearer-proxy'
import { getMember, memberHasPassword, activateMember, mintConfigured } from '~/lib/server/identity'
import { readInvite, inviteUserId } from '~/lib/server/invite'
import { MIN_PASSWORD } from '~/lib/server/onboarding'

export const runtime = 'nodejs'

const bad = (error: string, status: number) => NextResponse.json({ error }, { status })

export async function GET(req: NextRequest): Promise<NextResponse> {
  const inv = readInvite(req.nextUrl.searchParams.get('t'))
  if (!inv) return bad('This invitation link is invalid or has expired.', 400)

  const member = await getMember(inviteUserId(inv))
  if (!member || member.owner !== inv.org) {
    return bad('This invitation is no longer valid — the member was removed.', 410)
  }
  return NextResponse.json({
    ok: true,
    org: inv.org,
    email: member.email || inv.email,
    displayName: member.displayName || member.name,
    role: member.isAdmin ? 'admin' : 'member',
    accepted: memberHasPassword(member),
  })
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const csrf = csrfRefusal(req)
  if (csrf) return csrf

  if (!mintConfigured()) {
    return bad('Invite acceptance is not configured on this deployment.', 501)
  }

  let body: { t?: unknown; password?: unknown; displayName?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return bad('bad request', 400)
  }
  const inv = readInvite(typeof body.t === 'string' ? body.t : null)
  if (!inv) return bad('This invitation link is invalid or has expired.', 400)

  const password = typeof body.password === 'string' ? body.password : ''
  if (password.length < MIN_PASSWORD) {
    return bad(`Use a password of at least ${MIN_PASSWORD} characters.`, 400)
  }
  if (/\s/.test(password)) return bad('Password cannot contain spaces.', 400)
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : ''

  const id = inviteUserId(inv)
  const member = await getMember(id)
  if (!member || member.owner !== inv.org) {
    return bad('This invitation is no longer valid — the member was removed.', 410)
  }
  // Single-use for activation: refuse if the member already has a credential, so a
  // stale/re-shared link can never reset an active member's password.
  if (memberHasPassword(member)) {
    return bad('This invitation was already accepted. Please sign in.', 409)
  }

  const brand = BRANDS[brandFromHost(req.headers.get('host'))]
  const signupApplication = `${brand.id}-cloud`

  try {
    await activateMember(id, { password, displayName: displayName || undefined, signupApplication })
  } catch (e) {
    return bad(`Could not activate the account: ${e instanceof Error ? e.message : String(e)}`, 502)
  }
  return NextResponse.json({ ok: true, org: inv.org, email: member.email || inv.email })
}
