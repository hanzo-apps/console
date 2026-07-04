'use client'

/**
 * Direct IAM credential sign-in — the multi-tenant login wire (HIP-0111).
 *
 * The console is white-labelled per brand, but a USER'S ORG is a property of the
 * user, not of the console: a customer in org `maxpower` signs into the
 * Hanzo-branded console with their email and IAM resolves THEIR org. So on a
 * TENANT host we POST the canonical `/v1/iam/login` with an EMPTY `organization`
 * — IAM matches the user across every org by email — and get back an OAuth code,
 * which the existing `completeSignIn` → `/v1/iam/signin` exchange turns into the
 * session cookie. Pinning the brand's own org (the old SDK `organizationName`) is
 * the bug this replaces: it makes a non-brand-org user un-signinable.
 *
 * An ADMIN host (admin.<brand>) is the ONE exception: it is single-org, so we pin
 * `organization` to the reserved `admin` org (config.iamOrgName resolves there),
 * making the operator authenticate INTO the org where the `admin-console` app is
 * registered — an empty org would mint the code in the wrong org and the token
 * audience would mismatch.
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
import { config, isAdminHost } from '~/config'
import { CALLBACK_PATH } from './iam'
import { createPkce } from './pkce'

/** Outcome of the credential step. On an admin host a successful `code` also carries the
 *  PKCE `verifier` the console's BFF needs to redeem it as the public admin-console client. */
export type LoginResult =
  | { kind: 'code'; code: string; verifier?: string }
  | { kind: 'mfa' }
  | { kind: 'error'; message: string }

type IamEnvelope = { status?: string; msg?: string; data?: unknown }

/**
 * The `state` carried through the code → `/v1/iam/signin` exchange. The application
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
  const admin = isAdminHost(window.location.hostname)
  // On an admin host the console redeems the code ITSELF as the public `admin-console`
  // client (no secret), so it authorizes with PKCE (RFC 7636): send the S256
  // code_challenge now and keep the verifier to authenticate the exchange. A tenant host
  // sends no challenge — the cloud backend redeems its code with a confidential client.
  const pkce = admin ? await createPkce() : null
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
        // A TENANT host resolves the user's org across ALL orgs by email (a customer
        // in org `maxpower` signs into the Hanzo-branded console) — hence empty. An
        // ADMIN host is single-org: the operator authenticates INTO the reserved
        // `admin` org where `admin-console` lives (config.iamOrgName is `admin` there),
        // so pin it — otherwise the code is minted in the wrong org and the token
        // audience mismatches (application.Name:[hanzo-cloud] vs token.Application:[admin-console]).
        organization: admin ? config.iamOrgName : '',
        username,
        password,
        signinMethod: 'Password',
        autoSignin: true,
        // PKCE (admin only) — IAM stores the challenge with the code; the BFF then
        // presents the verifier to redeem it without the admin-console secret.
        ...(pkce ? { codeChallenge: pkce.challenge, codeChallengeMethod: 'S256' } : {}),
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
  if (typeof data === 'string' && data) return { kind: 'code', code: data, verifier: pkce?.verifier }
  return { kind: 'error', message: env.msg || 'Sign-in failed.' }
}
