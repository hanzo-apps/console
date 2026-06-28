/**
 * Hanzo IAM (OIDC) client — sign-in start + callback helpers.
 *
 * Authentication is a standard authorize-code redirect to IAM (hanzo.id):
 * `startSignIn()` -> IAM login -> our `/auth/callback?code&state` -> the cloud
 * `/v1/signin` exchanges code+state for the first-party session cookie.
 *
 * Two anti-CSRF / anti-interception controls live here:
 *  - **state** (always): a fresh, cryptographically-random value is stamped on the
 *    authorize URL and persisted; the callback MUST match it before exchanging the
 *    code, defeating login-CSRF / authorization-code injection. (The previous flow
 *    posted code+state to `/v1/signin` and never checked state.)
 *  - **PKCE S256** (gated on `config.iamPkce`): a per-attempt `code_verifier` is
 *    stored and its S256 challenge is sent on the authorize URL; the verifier is
 *    handed to `/v1/signin` so the backend completes the PKCE exchange. It is
 *    gated because the deployed casibase `/v1/signin` exchanges the code WITHOUT a
 *    verifier today (`casdoorsdk.GetOAuthToken(code, state)`) — emitting a
 *    challenge before the backend forwards the verifier would break the exchange.
 *    Flip `NEXT_PUBLIC_IAM_PKCE=1` once the backend forwards `code_verifier`.
 *
 * The SDK is retained only for the signup URL.
 */
import Sdk from '@hanzo/iam-js-sdk'

import { config } from '~/config'

/** Path IAM redirects back to after authorize. */
export const CALLBACK_PATH = '/auth/callback'

const STATE_KEY = 'console2.oauth.state'
const VERIFIER_KEY = 'console2.oauth.verifier'

let sdk: Sdk | null = null
function iam(): Sdk {
  if (typeof window === 'undefined') throw new Error('IAM SDK is browser-only')
  if (!sdk) {
    sdk = new Sdk({
      serverUrl: config.iamUrl,
      clientId: config.iamClientId,
      appName: config.iamAppName,
      organizationName: config.iamOrgName,
      redirectPath: CALLBACK_PATH,
      scope: 'openid profile email',
    })
  }
  return sdk
}

/** Full IAM signup URL. */
export const getSignupUrl = (): string => iam().getSignupUrl()

// ── OAuth helpers (state + PKCE) ─────────────────────────────────────────────

/** URL-safe base64 (no padding) of raw bytes. */
function base64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** A cryptographically-random URL-safe token (default 256 bits of entropy). */
function randomToken(bytes = 32): string {
  const a = new Uint8Array(bytes)
  crypto.getRandomValues(a)
  return base64url(a)
}

/** The PKCE S256 challenge for a verifier: BASE64URL(SHA-256(verifier)). */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64url(new Uint8Array(digest))
}

const redirectUri = (): string => `${window.location.origin}${CALLBACK_PATH}`

/**
 * Build the IAM authorize URL with a fresh CSRF `state` (always persisted) and a
 * PKCE S256 challenge when enabled (verifier persisted). `provider` hints a
 * social IdP (`provider-github`, `provider-google`); IAM owns each provider's
 * OAuth, so the console never reconstructs the IdP URLs.
 */
export async function buildAuthorizeUrl(
  opts: { provider?: string; pkce?: boolean } = {},
): Promise<string> {
  const usePkce = opts.pkce ?? config.iamPkce
  const state = randomToken()
  sessionStorage.setItem(STATE_KEY, state)

  const u = new URL(`${config.iamUrl}/login/oauth/authorize`)
  u.searchParams.set('client_id', config.iamClientId)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('redirect_uri', redirectUri())
  u.searchParams.set('scope', 'openid profile email')
  u.searchParams.set('state', state)

  if (usePkce) {
    const verifier = randomToken()
    sessionStorage.setItem(VERIFIER_KEY, verifier)
    u.searchParams.set('code_challenge', await pkceChallenge(verifier))
    u.searchParams.set('code_challenge_method', 'S256')
  } else {
    sessionStorage.removeItem(VERIFIER_KEY)
  }

  if (opts.provider) u.searchParams.set('provider_hint', opts.provider)
  return u.toString()
}

/** Begin sign-in by redirecting to IAM (optionally hinting a social provider). */
export async function startSignIn(provider?: string): Promise<void> {
  window.location.assign(await buildAuthorizeUrl({ provider }))
}

/** Read + clear the persisted CSRF state (one-time use). */
export function consumeState(): string | null {
  const s = sessionStorage.getItem(STATE_KEY)
  sessionStorage.removeItem(STATE_KEY)
  return s
}

/** Read + clear the persisted PKCE verifier (one-time; null when PKCE was off). */
export function consumeCodeVerifier(): string | null {
  const v = sessionStorage.getItem(VERIFIER_KEY)
  sessionStorage.removeItem(VERIFIER_KEY)
  return v
}

/** A human-readable explanation for an IdP `?error` returned on the callback. */
export function describeAuthError(code: string, description?: string | null): string {
  if (description) return description
  const map: Record<string, string> = {
    access_denied: 'Sign-in was cancelled.',
    invalid_request: 'The sign-in request was invalid. Please try again.',
    invalid_scope: 'The sign-in request asked for an invalid scope.',
    unauthorized_client: 'This application is not authorized to sign you in.',
    server_error: 'The identity provider hit an error. Please try again.',
    temporarily_unavailable: 'The identity provider is temporarily unavailable. Please try again.',
  }
  return map[code] ?? `Sign-in failed (${code}).`
}
