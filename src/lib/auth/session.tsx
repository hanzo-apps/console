'use client'

/**
 * Session context — the one source of auth truth for the console.
 *
 * On mount it asks the backend `/v1/iam/get-account`. `signIn()` redirects to IAM;
 * `completeSignIn(code, state)` (used by the callback route) posts to
 * `/v1/iam/signin` to mint the session cookie, then reloads the account.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

import { AccountApi, type Account } from '~/lib/api'
import { getProviderSigninUrl, getSigninUrl, stashReturnTo } from './iam'

type SessionState = {
  account: Account | null
  loading: boolean
  signIn: () => void
  signInWith: (provider: string) => void
  completeSignIn: (code: string, state: string) => Promise<void>
  signOut: () => Promise<void>
  reload: () => Promise<void>
}

const SessionContext = createContext<SessionState | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      setAccount(await AccountApi.current())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const signIn = useCallback(() => {
    // Remember the current task so re-auth returns here (graceful mid-task expiry).
    stashReturnTo()
    window.location.assign(getSigninUrl())
  }, [])

  const signInWith = useCallback((provider: string) => {
    stashReturnTo()
    window.location.assign(getProviderSigninUrl(provider))
  }, [])

  const completeSignIn = useCallback(
    async (code: string, state: string) => {
      const res = await AccountApi.signin(code, state)
      setAccount(res.data ?? (await AccountApi.current()))
    },
    [],
  )

  const signOut = useCallback(async () => {
    await AccountApi.signout()
    setAccount(null)
  }, [])

  return (
    <SessionContext.Provider value={{ account, loading, signIn, signInWith, completeSignIn, signOut, reload }}>
      {children}
    </SessionContext.Provider>
  )
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used within <SessionProvider>')
  return ctx
}
