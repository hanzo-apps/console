/** Account/session API — `/v1/get-account`, `/v1/signin`, `/v1/signout`. */
import { get, post } from './client'
import { type Account } from './types'

export const AccountApi = {
  /** Current signed-in account, or null when no valid session.
   *
   * The casibase backend auto-creates an "anonymous-user" session for the chat
   * product, so get-account returns status:ok even when nobody is really signed
   * in. This is an ADMIN console — an anonymous session is NOT authenticated
   * (admin endpoints reject it with "Please sign in first"), so we treat it as
   * logged-out and force a real IAM sign-in. */
  current: async (): Promise<Account | null> => {
    try {
      const account = await get<Account>('get-account')
      if (!account || account.type === 'anonymous-user') return null
      return account
    } catch {
      return null
    }
  },

  /**
   * Exchange the IAM OAuth code+state for a backend session cookie.
   *
   * `codeVerifier` is the PKCE verifier (sent only when PKCE is enabled); the
   * cloud `/v1/signin` forwards it to IAM to complete the S256 exchange. State is
   * validated on the client BEFORE this call (see `app/auth/callback`).
   */
  signin: (code: string, state: string, codeVerifier?: string) =>
    post<Account>('signin', undefined, {
      code,
      state,
      ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
    }),

  signout: () => post('signout'),

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
    const r = await post<Record<string, unknown>>('update-preferences', partial)
    return r.data ?? {}
  },
}
