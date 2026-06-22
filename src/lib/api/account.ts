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

  /** Exchange the IAM OAuth code+state for a backend session cookie. */
  signin: (code: string, state: string) => post<Account>('signin', undefined, { code, state }),

  signout: () => post('signout'),
}
