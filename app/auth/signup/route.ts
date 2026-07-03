/**
 * Email self-serve signup (HIP-0111) — create a brand-new account + its own org.
 *
 * This is the ONE unauthenticated BFF route (the caller has no account yet). It
 * acts as the confidential `hanzo-console` client to mint, in one shot:
 *   1. a personal organization (owner=`admin`, password/locale cloned from the
 *      brand org so the account hashes with the brand's argon2id policy), and
 *   2. the user as that org's ADMIN (IAM hashes the password server-side).
 * The client then signs in with the same credentials and lands as admin — no
 * separate onboarding step (IAM users always belong to an org, so "create then
 * onboard" is not possible against casibase; the org is minted here).
 *
 * Email uniqueness without a global user-lookup endpoint: the org slug is a
 * DETERMINISTIC, injective function of the email (`personalOrgFromEmail`), so a
 * repeat signup with the same email resolves to the same slug and is caught by
 * `getOrganization` (409) — two different emails never false-collide.
 *
 * Honest states: 501 when the IAM client is unwired, 400 on bad input, 409 when
 * the account already exists, 502 on an IAM failure.
 *
 * NOTE (hardening, flagged not done here): this endpoint creates accounts from the
 * open internet. It validates input but has NO captcha / rate-limit / email-
 * verification gate yet — those are follow-ups (email verification especially
 * would add friction the go-live conversion goal explicitly avoids).
 */
import { createHash } from 'node:crypto'
import { type NextRequest, NextResponse } from 'next/server'

import { brandFromHost } from '~/config'
import { BRANDS } from '~/lib/branding/brands'
import { createOrganization, createUser, getOrganization, mintConfigured } from '~/lib/server/identity'
import {
  deriveUsername,
  displayNameFromEmail,
  personalOrgFromEmail,
  validateSignup,
} from '~/lib/server/onboarding'

export const runtime = 'nodejs'

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!mintConfigured()) {
    return NextResponse.json(
      { error: 'Account creation is not configured on this deployment (IAM client unset).' },
      { status: 501 },
    )
  }

  const body = (await req.json().catch(() => ({}))) as { email?: string; password?: string }
  const v = validateSignup(body.email ?? '', body.password ?? '')
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })

  const brand = BRANDS[brandFromHost(req.headers.get('host'))]
  const brandOrg = brand.id // hanzo/lux/zoo/pars — cloned for password/locale policy
  const signupApplication = `${brand.id}-cloud` // hanzo-cloud, lux-cloud, …

  const digest = createHash('sha256').update(v.email).digest('hex')
  const orgSlug = personalOrgFromEmail(v.email, digest)

  if (await getOrganization(orgSlug)) {
    return NextResponse.json(
      { error: 'An account with this email already exists. Sign in instead.' },
      { status: 409 },
    )
  }

  const displayName = displayNameFromEmail(v.email)
  try {
    await createOrganization({ name: orgSlug, displayName, personal: true, sourceOwner: brandOrg })
    await createUser({
      org: orgSlug,
      username: deriveUsername(v.email),
      email: v.email,
      password: v.password,
      displayName,
      signupApplication,
    })
  } catch (e) {
    return NextResponse.json(
      { error: `Could not create your account: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    )
  }

  return NextResponse.json({ ok: true, org: orgSlug })
}
