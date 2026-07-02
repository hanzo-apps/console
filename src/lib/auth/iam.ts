/**
 * Hanzo IAM (OIDC) client.
 *
 * Wraps `@hanzo/iam-js-sdk`. The SDK touches `window`/`sessionStorage`, so it is
 * constructed lazily and only in the browser. Sign-in is the standard authorize
 * redirect: `getSigninUrl()` -> IAM login -> our `/auth/callback?code&state` ->
 * the backend `/v1/iam/signin` exchanges code+state for a session cookie.
 */
import Sdk from '@hanzo/iam-js-sdk'

import { config } from '~/config'

/** Path IAM redirects back to after authorize. */
export const CALLBACK_PATH = '/auth/callback'

let sdk: Sdk | null = null

function iam(): Sdk {
  if (typeof window === 'undefined') {
    throw new Error('IAM SDK is browser-only')
  }
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

/** Full IAM authorize URL to begin sign-in. */
export const getSigninUrl = (): string => iam().getSigninUrl()

/**
 * Authorize URL that hints a specific social provider (IAM provider names, e.g.
 * `provider-github`, `provider-google`).
 *
 * The hint rides on the standard authorize redirect as `provider_hint`: IAM
 * (hanzo.id) owns each provider's OAuth — client id, scope, callback — so the
 * console never reconstructs github.com/accounts.google.com URLs. IAM advances
 * straight to the provider when it recognises the hint, and otherwise renders
 * its login page with the same providers; either way the console stays one
 * authorize call with no duplicated IdP config.
 */
export const getProviderSigninUrl = (provider: string): string =>
  `${getSigninUrl()}&provider_hint=${encodeURIComponent(provider)}`

/** Full IAM signup URL. */
export const getSignupUrl = (): string => iam().getSignupUrl()

// ── Graceful re-auth: return the user to their task after re-signing in ────────
// A mid-task session expiry (a proxy 401) should not dump the user on the home
// page — we stash where they were and the callback lands them back there.

const RETURN_TO_KEY = 'hz_return_to'

/** Remember the current in-app location (path + query) for post-sign-in return. */
export function stashReturnTo(): void {
  if (typeof window === 'undefined') return
  const { pathname, search } = window.location
  // Never round-trip back to the auth pages themselves.
  if (pathname.startsWith('/signin') || pathname.startsWith('/auth')) return
  try {
    window.sessionStorage.setItem(RETURN_TO_KEY, `${pathname}${search}`)
  } catch {
    /* sessionStorage may be unavailable (private mode) — best-effort only */
  }
}

/** Consume the stashed return location (default `/`), clearing it. */
export function takeReturnTo(): string {
  if (typeof window === 'undefined') return '/'
  try {
    const to = window.sessionStorage.getItem(RETURN_TO_KEY)
    window.sessionStorage.removeItem(RETURN_TO_KEY)
    // Only same-origin in-app paths — never an attacker-supplied absolute URL.
    if (to && to.startsWith('/') && !to.startsWith('//')) return to
  } catch {
    /* ignore */
  }
  return '/'
}

/**
 * Start a graceful re-authentication: remember the current task location, then
 * redirect to IAM. After sign-in the callback returns the user here. ONE entry
 * point for "your session expired — sign in again" across the honest-state cards.
 */
export function startReauth(): void {
  if (typeof window === 'undefined') return
  stashReturnTo()
  window.location.assign(getSigninUrl())
}
