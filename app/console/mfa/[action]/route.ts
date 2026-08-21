/**
 * /console/mfa/<action> — console-native two-factor (TOTP) enrollment BFF.
 *
 * WHY console-native: the console delegated 2FA to hanzo.id's account page, but the
 * custom hanzo.id login worker doesn't establish an IAM account session, so a
 * user who signed in through it lands on an account page that can't manage MFA
 * (setup returns "Unauthorized operation"). This closes that gap: the user enrolls
 * 2FA IN the console. We forward each IAM MFA op as the caller's OWN user bearer
 * (the authz filter authenticates the JWT and Casbin authorizes self-service MFA),
 * with owner/name PINNED to the resolved session user — so a caller can only ever
 * manage THEIR OWN 2FA, never another account's.
 *
 * Actions (POST): initiate · verify · enable · disable — the standard TOTP flow.
 */
import { type NextRequest, NextResponse } from 'next/server'

import { resolveUser, adminBearer, iamBaseUrl } from '~/lib/server/identity'
import { csrfRefusal } from '~/lib/server/bearer-proxy'
import { fetchWithTimeout } from '~/lib/server/fetch-timeout'

export const runtime = 'nodejs'

const TOTP = 'app' // IAM TotpType

/**
 * IAM endpoint + the params each action sends. owner/name are ALWAYS included and
 * pinned to the resolved session user for TWO reasons: (1) the handler targets that
 * user, and (2) the IAM authz filter derives the request OBJECT from `owner`/`name`
 * (query) and grants self-access when it equals the bearer subject — the SAME rule
 * that lets `users?owner=<me>` through. We send these as the QUERY STRING with an
 * EMPTY body: the authz filter's object-derivation reads a form body as JSON, so a
 * form-encoded body yields an empty object (→ no self-match → denied); with the
 * params in the query and no body it reads owner/name and the self grant applies.
 */
const ACTIONS: Record<string, { path: string; params: (u: { owner: string; name: string }, b: Body) => Record<string, string> }> = {
  initiate: {
    path: '/v1/iam/mfa/setup/initiate',
    params: (u) => ({ owner: u.owner, name: u.name, mfaType: TOTP }),
  },
  verify: {
    path: '/v1/iam/mfa/setup/verify',
    params: (u, b) => ({ owner: u.owner, name: u.name, mfaType: TOTP, passcode: b.passcode ?? '', secret: b.secret ?? '' }),
  },
  enable: {
    path: '/v1/iam/mfa/setup/enable',
    params: (u, b) => ({ owner: u.owner, name: u.name, mfaType: TOTP, secret: b.secret ?? '', recoveryCodes: b.recoveryCodes ?? '' }),
  },
  disable: {
    path: '/v1/iam/delete-mfa',
    params: (u) => ({ owner: u.owner, name: u.name }),
  },
}

type Body = { passcode?: string; secret?: string; recoveryCodes?: string }

export async function POST(req: NextRequest, ctx: { params: Promise<{ action: string }> }): Promise<NextResponse> {
  const csrf = csrfRefusal(req)
  if (csrf) return csrf

  const { action } = await ctx.params
  const spec = ACTIONS[action]
  if (!spec) return NextResponse.json({ error: 'unknown action' }, { status: 404 })

  const user = await resolveUser(req)
  if (!user) return NextResponse.json({ error: 'not authenticated' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as Body

  let bearer: string
  try {
    bearer = await adminBearer(user)
  } catch {
    return NextResponse.json({ status: 'error', msg: 'Could not authorize the request.' }, { status: 502 })
  }

  // Params ride the QUERY STRING (see ACTIONS doc) with an EMPTY body so the IAM
  // authz filter derives owner/name for the self-access grant.
  const qs = new URLSearchParams(spec.params({ owner: user.owner, name: user.name }, body)).toString()
  try {
    const res = await fetchWithTimeout(`${iamBaseUrl()}${spec.path}?${qs}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bearer}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
    })
    const text = await res.text()
    return new NextResponse(text, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('content-type') ?? 'application/json' },
    })
  } catch {
    return NextResponse.json({ status: 'error', msg: 'Identity service is unavailable.' }, { status: 502 })
  }
}
