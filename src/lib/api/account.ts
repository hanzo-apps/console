/** Account/session API.
 *
 * Identity is @hanzo/iam ONLY. `session()` resolves the signed-in account from the
 * IAM SDK: it reads the (auto-refreshed) access token and projects the OIDC userinfo
 * claims into the console's `Account` shape. There is NO casibase cookie / BFF
 * code-exchange / durable-console-session path any more — the IAM PKCE token is the
 * single credential (the API client carries it as a Bearer on every `/v1` call).
 */
import { patch, post } from './client'
import {
  iamValidAccessToken,
  iamUserInfo,
  iamExpiresInSeconds,
  iamSignOut,
} from '~/lib/auth/iam'
import { config } from '~/config'
import { type Account } from './types'

/** Result of resolving the current session: the account + the IAM access-token
 *  lifetime (seconds) so the provider can arm its proactive refresh timer. */
export type SessionResult = { account: Account | null; expiresIn: number | null }

/** Project the IAM OIDC userinfo claims onto the console `Account` shape. */
function accountFromClaims(claims: Record<string, unknown>): Account | null {
  const str = (k: string): string | undefined => {
    const v = claims[k]
    return typeof v === 'string' && v ? v : undefined
  }
  // The deployed OIDC userinfo may omit `owner`, and `sub` is the user UUID (not
  // owner/name). Resolve owner: explicit claim -> sub-prefix (older owner/name
  // tokens) -> the console's configured IAM org. A valid session must NEVER
  // dead-end at account=null (that loops /signin).
  const sub = str('sub') ?? ''
  const owner =
    str('owner') ??
    str('organization') ??
    (sub.includes('/') ? sub.split('/')[0] : undefined) ??
    config.iamOrgName
  const name =
    str('name') ??
    str('preferred_username') ??
    str('email') ??
    (sub.includes('/') ? sub.split('/')[1] : sub)
  if (!owner || !name) return null
  const props = claims['properties']
  return {
    owner,
    name,
    type: str('type') ?? 'normal-user',
    displayName: str('displayName') ?? str('display_name'),
    email: str('email'),
    avatar: str('avatar') ?? str('picture'),
    organization: owner,
    isAdmin: claims['isAdmin'] === true || claims['is_admin'] === true,
    properties: props && typeof props === 'object' ? (props as Record<string, string>) : undefined,
  }
}

/** Decode a JWT payload's claims (base64url), or null if the token isn't a JWT. */
function decodeJwtClaims(token: string): Record<string, unknown> | null {
  try {
    const part = token.split('.')[1]
    if (!part) return null
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'))
    const c = JSON.parse(json)
    return c && typeof c === 'object' ? (c as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export const AccountApi = {
  /**
   * Resolve the current session from IAM: a valid access token (refreshed if
   * needed) + its userinfo claims projected onto `Account`. Returns null when
   * signed out. Self-heals: a stale access token with a live refresh token is
   * silently refreshed by the SDK before the claims are read.
   */
  session: async (): Promise<SessionResult> => {
    const token = await iamValidAccessToken()
    if (!token) return { account: null, expiresIn: null }
    // Resolve identity from the access-token JWT claims directly — self-contained
    // and immune to the SDK's getUserInfo() returning null on a 200 (which dead-ended
    // the session and looped /signin). Fall back to userinfo only if not a JWT.
    const claims = decodeJwtClaims(token) ?? (await iamUserInfo())
    if (!claims) return { account: null, expiresIn: null }
    return { account: accountFromClaims(claims), expiresIn: iamExpiresInSeconds() }
  },

  /** The current signed-in account, or null. */
  current: async (): Promise<Account | null> => (await AccountApi.session()).account,

  /** Sign out: clear the IAM tokens (client) and best-effort the casibase session. */
  signout: async (): Promise<void> => {
    iamSignOut()
    try {
      await post('signout')
    } catch {
      /* best-effort */
    }
  },

  /**
   * Persist a partial set of cross-product user preferences onto the account.
   * Self-scoped on the backend (writes ONLY the caller's own IAM-user
   * properties, derived from the token — never the body). Top-level keys are
   * shallow-merged server-side. Returns the merged preferences object so other
   * products' keys are preserved in the local view.
   */
  updatePreferences: async (
    partial: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const r = await patch<Record<string, unknown>>('auth/preferences', partial)
    return r.data ?? {}
  },
}
