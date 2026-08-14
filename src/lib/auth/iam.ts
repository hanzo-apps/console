/**
 * Hanzo IAM (OIDC) client — the ONE credential source for the console.
 *
 * Built on `@hanzo/iam`'s browser SDK (the `IAM` class from `@hanzo/iam/browser`):
 * a single redirect + PKCE (RFC 7636) authorize flow where IAM (hanzo.id) owns every
 * credential step. There is NO inline password form, NO ROPC (`/v1/iam/login`), NO
 * confidential-client BFF code->cookie exchange — the browser drives one authorize
 * redirect to `${iamUrl}/v1/iam/oauth/authorize` and completes the token exchange
 * itself via PKCE (no client secret). Social providers, email-code, MFA and wallet
 * all live on IAM's hosted login; the console never reconstructs an IdP URL.
 *
 * The SDK owns the token store (`hanzo_iam_*`) and picks it: `localStorage`, so the
 * session belongs to the BROWSER and not to one tab. This module passes no `storage`
 * — that decision lives in `@hanzo/iam` alone, where every Hanzo surface inherits it.
 *
 * It used to pass `window.sessionStorage`, and that was the whole "a new tab is
 * signed out" defect: a middle-clicked link, a restored window or a `target=_blank`
 * opened a context that could not see the session the user had just established.
 * Note this is not a confidentiality trade — both Web Storage areas are readable by
 * any script on the origin. Credentials that must be unreadable by script belong in
 * an httpOnly cookie; `src/lib/server/session.ts` already defines that (`hz_session`,
 * AEAD-sealed) for the server-side half.
 *
 * This module exposes a browser-only singleton so the API client can read the bearer
 * synchronously and the session provider / callback route can start + complete the
 * flow. The React `<IamProvider>` (mounted at the root) constructs its OWN `IAM` from
 * the SAME `iamConfig()`, so it shares that token store — the two views stay
 * consistent.
 */
import { IAM, type IAMConfig } from '@hanzo/iam/browser'

import { config } from '~/config'

/** Path IAM redirects back to after authorize. */
export const CALLBACK_PATH = '/auth/callback'

/**
 * The IAM SDK configuration for this host's brand. Shared by the browser singleton
 * below AND the React `<IamProvider>` (Provider.tsx) so both drive the same PKCE
 * flow against the same token store. Per-brand issuer + client come from `config`
 * (resolved from the hostname); on an admin host `config` already switches to the
 * reserved `admin-console` app in the `admin` org.
 */
export function iamConfig(): IAMConfig {
  return {
    serverUrl: config.iamUrl,
    clientId: config.iamClientId,
    organization: config.iamOrgName,
    redirectUri: `${typeof window !== 'undefined' ? window.location.origin : ''}${CALLBACK_PATH}`,
    scope: 'openid profile email',
  }
}

let sdk: IAM | null = null

/** The browser IAM singleton (browser-only — the SDK touches `window`/`localStorage`). */
export function iamSdk(): IAM {
  if (typeof window === 'undefined') throw new Error('IAM SDK is browser-only')
  if (!sdk) sdk = new IAM(iamConfig())
  return sdk
}

/** Begin sign-in: redirect the browser to IAM's authorize endpoint (PKCE). */
export function signinRedirect(): Promise<void> {
  return iamSdk().signinRedirect()
}

/** Complete sign-in on the `/auth/callback` route — the PKCE token exchange. */
export async function handleIamCallback(): Promise<void> {
  await iamSdk().handleCallback()
}

/** The current IAM access token (bearer), or null when signed out / on the server. */
export function iamAccessToken(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return iamSdk().getAccessToken()
  } catch {
    return null
  }
}

/** The stored refresh token, or null when none / on the server. */
export function iamRefreshToken(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return iamSdk().getRefreshToken()
  } catch {
    return null
  }
}

/** The `exp` claim (seconds since the epoch) a token states, or null when it states none. */
export function tokenExp(token: string | null): number | null {
  if (!token) return null
  try {
    const part = token.split('.')[1]
    if (!part) return null
    const claims = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: unknown }
    return typeof claims.exp === 'number' ? claims.exp : null
  } catch {
    return null
  }
}

/**
 * True only when the token PROVES it is over — it states an `exp` that has passed.
 *
 * A token that states no `exp` is not expired here, deliberately: we end a session
 * only on evidence, never on an absence. That keeps the case this fallback was
 * written for (IAM answering the exchange without `expires_in`, so the SDK's own
 * `expires_at` bookkeeping reads as already-elapsed while IAM still accepts the
 * token) working, while making a genuinely dead credential unusable.
 */
export function expired(token: string | null, nowMs: number = Date.now()): boolean {
  const exp = tokenExp(token)
  return exp !== null && exp * 1000 <= nowMs
}

/**
 * True when the browser holds something worth refreshing — an access token that is
 * not provably expired, or a refresh token to redeem. Cheap + synchronous, no network.
 *
 * An expired access token ALONE is not a session, it is the residue of one. Counting
 * it kept the refresh retry looping over a credential no attempt could revive, and
 * kept the shell rendering as signed in.
 */
export function iamHasSession(): boolean {
  const token = iamAccessToken()
  return (token !== null && !expired(token)) || iamRefreshToken() !== null
}

/**
 * The current live access token, or null. READS — it never rotates.
 *
 * Reading and rotating used to be one call (`getValidAccessToken` silently POSTs the
 * refresh grant when it considers the token expired), and that braid is what made a
 * dead session cost five token POSTs a page: every caller that merely wanted to know
 * who you are started its own unclassified rotation, none of them aware of the others
 * or of IAM's answer. Rotation now lives in exactly one place — `iamRefresh`, behind
 * the single-flight in `refresh.ts` — and this stays a pure read.
 *
 * Callers already expect that shape: `AccountApi.session()` reads, and only then asks
 * for a refresh if the read came back empty.
 */
export async function iamValidAccessToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null
  // A token is usable until its own `exp` passes. The SDK's separate `expires_at`
  // bookkeeping is absent whenever the exchange answered without `expires_in`, and
  // reading THAT as authoritative is what discarded valid sessions; reading the raw
  // token as valid regardless is what kept dead ones. The claim settles it.
  const stored = iamAccessToken()
  return stored !== null && !expired(stored) ? stored : null
}

/** What IAM said about a refresh grant. */
export type Grant =
  /** A live access token is in hand. */
  | 'live'
  /** IAM was unreachable or answered 5xx — this grant may still work. */
  | 'transient'
  /** IAM refused the grant (4xx, e.g. `invalid_grant`) — it will never be redeemed. */
  | 'refused'

/**
 * Classify a failed refresh. OAuth 2 draws the line for us: a 4xx is the authorization
 * server's verdict on the GRANT, and repeating it changes nothing; a 5xx or a network
 * error says nothing about the credential and deserves another try.
 *
 * The SDK reports the status only inside its message ("Token refresh failed (400): …"),
 * so that is what we read. Anything unrecognized is TRANSIENT — an unclassifiable
 * failure must never cost someone a live session.
 */
export function classifyRefreshFailure(err: unknown): 'transient' | 'refused' {
  const status = /\((\d{3})\)/.exec(err instanceof Error ? err.message : String(err))?.[1]
  const code = status ? Number(status) : 0
  return code >= 400 && code < 500 ? 'refused' : 'transient'
}

/**
 * One refresh attempt, classified — exactly one token POST, never more.
 *
 * A refused grant ends the session HERE: the credential is dead, so it is cleared
 * rather than left in storage for the next caller to retry and for the shell to
 * re-read as "signed in". With the tokens gone the entry gate resolves anonymous
 * and starts the IAM hop — one redirect, owned by the gate.
 */
export async function iamRefresh(): Promise<Grant> {
  if (typeof window === 'undefined') return 'transient'
  const current = iamAccessToken()
  if (current !== null && !expired(current)) return 'live'
  if (iamRefreshToken() === null) {
    // Nothing left to redeem: an anonymous visitor, or a session already ended.
    iamSignOut()
    return 'refused'
  }
  try {
    await iamSdk().refreshAccessToken()
    const minted = iamAccessToken()
    if (minted !== null && !expired(minted)) return 'live'
    iamSignOut()
    return 'refused'
  } catch (e) {
    const outcome = classifyRefreshFailure(e)
    if (outcome === 'refused') iamSignOut()
    return outcome
  }
}

/** The signed-in user's OIDC claims (userinfo), or null. */
export async function iamUserInfo(): Promise<Record<string, unknown> | null> {
  if (typeof window === 'undefined') return null
  try {
    return await iamSdk().getUserInfo()
  } catch {
    return null
  }
}

/** Seconds until the current access token expires (null when absent/stateless/expired). */
export function iamExpiresInSeconds(): number | null {
  const exp = tokenExp(iamAccessToken())
  if (exp === null) return null
  const secs = exp - Math.floor(Date.now() / 1000)
  return secs > 0 ? secs : null
}

/** Clear all IAM tokens (sign out, client side). */
export function iamSignOut(): void {
  if (typeof window === 'undefined') return
  try {
    iamSdk().clearTokens()
  } catch {
    /* best-effort */
  }
}

/**
 * Where to send the browser to END THE SESSION AT THE ISSUER.
 *
 * `iamSignOut()` above drops this tab's tokens and nothing else, which is only
 * half of signing out and is the half nobody notices. The other half is the
 * `iam_session_id` cookie at hanzo.id: leave it and signing out does not stick,
 * because the very next thing the app does is bounce to `/signin`, and sign-in
 * asks the issuer for a code from the EXISTING session. Measured against prod —
 * clear the tokens the way this module did and silent SSO still answers
 * `status: ok` with a code, so the user lands straight back in the console they
 * just left. Clearing the whole session cookie jar is not an option either: it
 * is set on hanzo.id, and this origin cannot touch it.
 *
 * Only the issuer can end the issuer's session, so sign-out has to be a
 * NAVIGATION there. RP-initiated logout returns the browser to
 * `post_logout_redirect_uri`, which is why this replaces the `/signin` assign
 * rather than racing it: one navigation, and it lands where the old one did.
 *
 * Verified: after this URL, the same silent-SSO probe answers
 * "please sign in first" and mints nothing.
 */
export function iamSignOutUrl(origin: string, returnPath = '/signin'): string {
  // The origin is a PARAMETER, not `window.location.origin` read in here. Every
  // other function in this module guards `typeof window === 'undefined'` because
  // this file is imported by server-rendered code; one that reads `window`
  // unguarded throws the moment anything touches it during SSR. Taking it as an
  // argument removes the hazard instead of guarding it, and makes the URL a pure
  // function of its inputs — testable with no DOM, which is what this repo's
  // suite runs.
  const url = new URL('/v1/iam/oauth/logout', config.iamUrl)
  // Resolve the return against OUR origin, then require it to have stayed there.
  // An absolute URL wins over a base in `new URL`, so a caller passing a foreign
  // one would otherwise hand the IdP an open redirect to hand back. A return leg
  // that left this origin is never what sign-out meant, so it falls back to the
  // sign-in page rather than being honored.
  const back = new URL(returnPath, origin)
  const safe = back.origin === origin ? back : new URL('/signin', origin)
  url.searchParams.set('post_logout_redirect_uri', safe.toString())
  return url.toString()
}

// -- Graceful re-auth: return the user to their task after re-signing in --------
// A mid-task session expiry (a 401) should not dump the user on the home page — we
// stash where they were and the callback lands them back there.

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
  void signinRedirect()
}
