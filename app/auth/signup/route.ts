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
 * onboard" is not possible against casibase; the org is minted here). The new user's
 * `owner` is their OWN personal org (never the reserved `admin` org), so a public
 * signup is always a self-service customer org — never a platform SuperAdmin.
 *
 * Email uniqueness without a global user-lookup endpoint: the org slug is a
 * DETERMINISTIC, injective function of the email (`personalOrgFromEmail`), so a
 * repeat signup with the same email resolves to the same slug and is caught by
 * `getOrganization` (409); two different emails never false-collide.
 *
 * PUBLIC-LAUNCH ABUSE PROTECTIONS (this route mints an account + org from the open
 * internet — but NO credit; a new account is $0 until granted/paid — so the open
 * path is guarded, in order):
 *   - same-origin CSRF gate (a scripted cross-origin signup is refused),
 *   - Turnstile bot wall (`verifyTurnstile`, enforced when the secret is provisioned),
 *   - per-IP sliding-window rate limit (`signupLimiter`, default 5/IP/hr),
 *   - disposable-email block (`isDisposableEmail`).
 * On success the account is JOINED to the brand waitlist (best-effort) so it holds a
 * position immediately — product access is then waitlist-gated (see WaitlistGate),
 * NOT signup. Honest states: 501 unwired, 400 bad input, 403 captcha, 409 exists,
 * 429 rate-limited, 502 IAM failure.
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
import { isDisposableEmail } from '~/lib/server/disposable'
import { csrfRefusal } from '~/lib/server/bearer-proxy'
import { clientIp, signupLimiter } from '~/lib/server/rate-limit'
import { verifyTurnstile } from '~/lib/server/turnstile'
import { joinWaitlist } from '~/lib/server/waitlist'

export const runtime = 'nodejs'

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Same-origin gate: the console's own signup form is same-origin; refuse scripted
  // cross-origin signups before doing any work.
  const csrf = csrfRefusal(req)
  if (csrf) return csrf

  if (!mintConfigured()) {
    return NextResponse.json(
      { error: 'Account creation is not configured on this deployment (IAM client unset).' },
      { status: 501 },
    )
  }

  const body = (await req.json().catch(() => ({}))) as {
    email?: string
    password?: string
    turnstileToken?: string
    ref?: string
  }
  const v = validateSignup(body.email ?? '', body.password ?? '')
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })
  if (isDisposableEmail(v.email)) {
    return NextResponse.json({ error: 'Please use a non-disposable email address.' }, { status: 400 })
  }

  // Bot wall (no-op until Turnstile is provisioned) BEFORE the per-IP throttle, so a
  // solved challenge is what a legitimate user spends their attempts on.
  const ip = clientIp(req.headers)
  const captcha = await verifyTurnstile((body.turnstileToken ?? '').trim(), ip)
  if (!captcha.ok) {
    return NextResponse.json({ error: 'Captcha verification failed. Please try again.' }, { status: 403 })
  }

  // Per-IP rate limit — the open-internet spam/cost floor.
  if (!signupLimiter.allow(`signup:${ip}`)) {
    return NextResponse.json(
      { error: 'Too many sign-up attempts. Please try again later.' },
      { status: 429, headers: { 'Retry-After': '3600' } },
    )
  }

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
  const username = deriveUsername(v.email)
  try {
    await createOrganization({ name: orgSlug, displayName, personal: true, sourceOwner: brandOrg })
    await createUser({
      org: orgSlug,
      username,
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

  // No automatic credit on signup — a new account starts at $0 until an admin
  // grants credit (admin.hanzo.ai) or the user adds funds. (Credit-granting is the
  // one mint-gated commerce primitive; signup never mints.)

  // Join the brand waitlist so the account holds a POSITION immediately — product
  // access is waitlist-gated (WaitlistGate), and a `?ref=` from the landing link
  // credits the referrer's position. Best-effort, service-authed; never blocks signup.
  await joinWaitlist(v.email, { host: req.headers.get('host'), referrerCode: (body.ref ?? '').trim() })

  return NextResponse.json({ ok: true, org: orgSlug })
}
