/** Account/session API.
 *
 * Identity resolves from the console's OWN durable, silently-refreshed OAuth session
 * FIRST (`/auth/session` — the `hz_session` cookie), falling back to the casibase
 * session (`/v1/iam/get-account`) for social/MFA logins and the pre-console path. The
 * AuthGate reads `account` from here, so a signed-in user is never bounced while
 * either session is valid.
 */
import { ApiError, get, post } from './client'
import { refreshSession } from '~/lib/auth/refresh'
import { IS_EMBED } from '~/lib/embed'
import { type Account } from './types'

/** The console session route is same-origin (the console's OWN BFF), not `/v1/*`. */
const SESSION_URL = '/auth/session'
/** The console's OWN OAuth code-exchange route (admin PKCE redemption), same-origin. */
const SIGNIN_URL = '/auth/signin'

/** Result of resolving the current session: the account + the console-session
 *  lifetime (seconds) when the console session is the source (null on the casibase
 *  fallback), so the provider can arm its proactive refresh timer. */
export type SessionResult = { account: Account | null; expiresIn: number | null }

/** Read the console OAuth session (GET /auth/session); null when there is none. */
async function consoleGet(): Promise<SessionResult | null> {
  // No BFF in the static embed — /auth/session isn't served; use the casibase session.
  if (IS_EMBED) return null
  try {
    const res = await fetch(SESSION_URL, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
    if (!res.ok) return null
    const j = (await res.json().catch(() => null)) as { account?: Account; expiresIn?: number } | null
    if (!j?.account?.name) return null
    return { account: j.account, expiresIn: typeof j.expiresIn === 'number' ? j.expiresIn : null }
  } catch {
    return null
  }
}

/** The casibase session account, or null. The backend auto-creates an
 *  "anonymous-user" for the chat product; an anonymous session is NOT signed in. */
async function casibaseAccount(): Promise<Account | null> {
  try {
    const account = await get<Account>('iam/get-account')
    if (!account || account.type === 'anonymous-user') return null
    return account
  } catch {
    return null
  }
}

export const AccountApi = {
  /**
   * Resolve the current session: the console OAuth session first (durable +
   * refreshed), then the casibase session. Returns the account and, when the console
   * session is the source, its remaining access lifetime.
   *
   * Self-heals on read: if the console access token is stale but the refresh token
   * is still valid (e.g. after a browser restart — the 30-day cookie outlives the
   * access token), it refreshes ONCE and retries before falling back — so a user
   * with a live refresh token is never dropped to /signin.
   */
  session: async (): Promise<SessionResult> => {
    let r = await consoleGet()
    if (!r && (await refreshSession())) r = await consoleGet()
    if (r) return r
    return { account: await casibaseAccount(), expiresIn: null }
  },

  /** The current signed-in account, or null (console session first, else casibase). */
  current: async (): Promise<Account | null> => (await AccountApi.session()).account,

  /**
   * Establish the console's durable OAuth session for the just-signed-in user
   * (server-side password grant, gated by the casibase session). Best-effort: a
   * failure leaves the user signed in on the casibase session (returns null), so the
   * login is never blocked by this enhancement. Returns the account + lifetime on
   * success so the caller can arm the proactive refresh.
   */
  establishSession: async (username: string, password: string): Promise<SessionResult | null> => {
    // No BFF in the static embed — the durable console session can't be minted there;
    // the user stays signed in on the casibase session (POST /auth/session → 405).
    if (IS_EMBED) return null
    try {
      const res = await fetch(SESSION_URL, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ username, password }),
      })
      if (!res.ok) return null
      const j = (await res.json().catch(() => null)) as { account?: Account; expiresIn?: number } | null
      if (!j?.account?.name) return null
      return { account: j.account, expiresIn: typeof j.expiresIn === 'number' ? j.expiresIn : null }
    } catch {
      return null
    }
  },

  /** Exchange the IAM OAuth code+state for a casibase session cookie (redirect flow). */
  signin: (code: string, state: string) => post<Account>('iam/signin', undefined, { code, state }),

  /**
   * Redeem an ADMIN credential login's OAuth code into the console's OWN durable session
   * (BFF `/auth/signin`, admin hosts only). The code was minted for the PUBLIC
   * `admin-console` client, so the console redeems it here via authorization_code + PKCE
   * (no secret) — the cloud backend's `/v1/iam/signin` would redeem with the wrong
   * (confidential `hanzo-cloud`) client and IAM rejects the mismatch. Throws on failure
   * so sign-in surfaces a real error (never a silent bounce).
   */
  consoleSignin: async (code: string, codeVerifier: string): Promise<SessionResult> => {
    const res = await fetch(SIGNIN_URL, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({ code, codeVerifier }),
    })
    const j = (await res.json().catch(() => null)) as { account?: Account; expiresIn?: number; error?: string } | null
    if (!res.ok || !j?.account?.name) {
      throw new ApiError(j?.error || `Sign-in failed (HTTP ${res.status}).`, res.status)
    }
    return { account: j.account, expiresIn: typeof j.expiresIn === 'number' ? j.expiresIn : null }
  },

  /** Sign out of BOTH sessions: clear the console session (revoke + clear cookie),
   *  then the casibase session. Both best-effort so one failing still signs out. */
  signout: async (): Promise<void> => {
    // The console-session cookie only exists behind the BFF; in the embed there's
    // nothing to revoke here — go straight to the casibase sign-out.
    if (!IS_EMBED) {
      try {
        await fetch(SESSION_URL, { method: 'DELETE', credentials: 'include', cache: 'no-store' })
      } catch {
        /* best-effort */
      }
    }
    try {
      await post('iam/signout')
    } catch {
      /* best-effort */
    }
  },

  /**
   * Persist a partial set of cross-product user preferences onto the account.
   * Self-scoped on the backend (writes ONLY the caller's own IAM-user
   * properties, derived from the session — never the body). Top-level keys are
   * shallow-merged server-side. Returns the merged preferences object so other
   * products' keys are preserved in the local view.
   */
  updatePreferences: async (
    partial: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const r = await post<Record<string, unknown>>('iam/update-preferences', partial)
    return r.data ?? {}
  },
}
