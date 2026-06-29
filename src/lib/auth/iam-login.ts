'use client'

/**
 * Direct IAM credential sign-in — the multi-tenant login wire (HIP-0111).
 *
 * The console is white-labelled per brand, but a USER'S ORG is a property of the
 * user, not of the console: a customer in org `maxpower` signs into the
 * Hanzo-branded console with their email and IAM resolves THEIR org. So we POST
 * the canonical `/v1/iam/login` with an EMPTY `organization` — IAM matches the
 * user across every org by email — and get back an OAuth code, which the
 * existing `completeSignIn` → `/v1/signin` exchange turns into the session
 * cookie. Pinning the brand's own org (the old SDK `organizationName`) is the
 * bug this replaces: it makes a non-brand-org user un-signinable.
 *
 * This speaks the exact wire `@hanzo/id-auth` does (verified against live IAM);
 * it lives here, bound to console2's `config`, because that package is not
 * published. OAuth params ride the query string; the auth fields ride the body.
 *
 * MFA is part of the contract: a correct credential check answers with a STRING
 * in `data` — `"NextMfa"` (enrolled; answer a challenge) or `"RequiredMfa"` (org
 * mandates MFA; enroll first) — BEFORE any code is minted. Those steps need the
 * IAM session cookie, which IAM sets `SameSite=Lax` and therefore does NOT send
 * on a cross-site fetch from this host — so MFA cannot complete inline here.
 * console2 hands MFA off to IAM's same-site hosted flow (see SignInForm); this
 * module only handles the credential step and reports the MFA signal.
 */
import { config } from '~/config'
import { CALLBACK_PATH } from './iam'

/** Outcome of the credential step. */
export type LoginResult =
  | { kind: 'code'; code: string }
  | { kind: 'mfa' }
  | { kind: 'error'; message: string }

type IamEnvelope = { status?: string; msg?: string; data?: unknown }

/**
 * The `state` carried through the code → `/v1/signin` exchange. The application
 * name satisfies every IAM path (the password path performs no state check; the
 * provider path requires this exact app-name prefix) and the backend accepts it
 * verbatim — verified against live IAM.
 */
export const loginState = (): string => config.iamAppName

function loginUrl(): string {
  const u = new URL(`${config.iamUrl}/v1/iam/login`)
  u.searchParams.set('clientId', config.iamClientId)
  u.searchParams.set('responseType', 'code')
  u.searchParams.set('redirectUri', `${window.location.origin}${CALLBACK_PATH}`)
  u.searchParams.set('scope', 'openid profile email')
  u.searchParams.set('state', loginState())
  u.searchParams.set('type', 'code')
  return u.toString()
}

/**
 * Sign in with email + password, resolving the user's org by email
 * (`organization: ""`). Returns the OAuth `code` on success, an `mfa` signal
 * when the account needs two-factor (completed on the hosted flow), or an
 * `error` message.
 */
export async function loginWithPassword(username: string, password: string): Promise<LoginResult> {
  let res: Response
  try {
    res = await fetch(loginUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // The MFA signal rides a Set-Cookie; harmless for the password path.
      credentials: 'include',
      body: JSON.stringify({
        type: 'code',
        application: config.iamAppName,
        organization: '', // resolve the user's org across all orgs by email
        username,
        password,
        signinMethod: 'Password',
        autoSignin: true,
      }),
    })
  } catch (e) {
    return { kind: 'error', message: e instanceof Error ? e.message : 'Network error.' }
  }

  const env = (await res.json().catch(() => null)) as IamEnvelope | null
  if (!env) return { kind: 'error', message: `Unexpected response (HTTP ${res.status}).` }
  if (env.status !== 'ok') return { kind: 'error', message: env.msg || 'Incorrect email or password.' }

  const data = env.data
  if (data === 'RequiredMfa' || data === 'NextMfa') return { kind: 'mfa' }
  if (typeof data === 'string' && data) return { kind: 'code', code: data }
  return { kind: 'error', message: env.msg || 'Sign-in failed.' }
}
