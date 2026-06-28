'use client'

/**
 * Session context — the one source of auth truth for the console.
 *
 * On mount it asks the backend `/v1/get-account`. `signIn()` redirects to IAM
 * (with CSRF state + optional PKCE — see `./iam`); `completeSignIn(code, state)`
 * (used by the callback route, AFTER it validates state) posts to `/v1/signin` to
 * mint the session cookie, then reloads the account. `signOut()` revokes the
 * session AND wipes the local preferences cache so a shared browser never leaks
 * the previous user's pins/layout.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

import { AccountApi, type Account } from '~/lib/api'
import { clearPreferencesCache } from '~/lib/products/preferences-cache'
import { consumeCodeVerifier, startSignIn } from './iam'

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
    void startSignIn()
  }, [])

  const signInWith = useCallback((provider: string) => {
    void startSignIn(provider)
  }, [])

  const completeSignIn = useCallback(async (code: string, state: string) => {
    // The callback validated `state` before calling us; pair the code with its
    // one-time PKCE verifier (null when PKCE is off) for the backend exchange.
    const codeVerifier = consumeCodeVerifier()
    const res = await AccountApi.signin(code, state, codeVerifier ?? undefined)
    setAccount(res.data ?? (await AccountApi.current()))
  }, [])

  const signOut = useCallback(async () => {
    try {
      await AccountApi.signout()
    } finally {
      // Always clear local state, even if the revoke call failed.
      clearPreferencesCache()
      setAccount(null)
    }
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
