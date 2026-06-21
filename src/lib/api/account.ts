/** Account/session API — `/v1/get-account`, `/v1/signin`, `/v1/signout`. */
import { get, post } from './client'
import { type Account } from './types'

export const AccountApi = {
  /** Current signed-in account, or null when no valid session. */
  current: async (): Promise<Account | null> => {
    try {
      return await get<Account>('get-account')
    } catch {
      return null
    }
  },

  /** Exchange the IAM OAuth code+state for a backend session cookie. */
  signin: (code: string, state: string) => post<Account>('signin', undefined, { code, state }),

  signout: () => post('signout'),
}
