'use client'

/**
 * User preferences — the ONE account-backed store for every console/product
 * customization (pinned favorites, layout, and anything added later).
 *
 * Source of truth is the signed-in user's IAM account (`properties` →
 * `hanzo.preferences`), so customizations follow the user across every product
 * and every device/login. localStorage is the fast-paint cache that avoids a
 * flash before the account loads, AND the fallback for keys the account has not
 * told us about yet — see `mergePrefs` in `preferences-core` for exactly why
 * that second role is load-bearing (without it, a pin made after sign-in was
 * wiped on the next reload, because the account's claims come off a token minted
 * before the pin existed).
 *
 * Writes are optimistic + write-through: the local view updates immediately and
 * `update-preferences` persists to the account (self-scoped, shallow-merged
 * server-side so concurrent products/devices don't clobber each other).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import { AccountApi } from '~/lib/api'
import { useSession } from '~/lib/auth/session'
import { mergePrefs, parsePrefs, type Preferences } from './preferences-core'

/** Must match the backend `preferencesKey` (controllers/account.go). */
const PREFS_PROPERTY = 'hanzo.preferences'

type PreferencesState = {
  prefs: Preferences
  /** False until the account has been read (the fast-paint cache may show first). */
  ready: boolean
  /** Read a typed preference with a fallback. */
  get: <T>(key: string, fallback: T) => T
  /** Set a preference (optimistic; persisted to the account across devices). */
  set: (key: string, value: unknown) => void
}

const PreferencesContext = createContext<PreferencesState | null>(null)

const cacheKey = (name: string | undefined) => `hanzo.console2.prefs.${name ?? 'anon'}`

const readCache = (name: string | undefined): Preferences =>
  typeof window === 'undefined' ? {} : parsePrefs(window.localStorage.getItem(cacheKey(name)))

export function Preferences({ children }: { children: ReactNode }) {
  const { account } = useSession()
  const name = account?.name
  const [prefs, setPrefs] = useState<Preferences>({})
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // Fast-paint from the local cache so pins don't flash on a cold load…
    const cached = readCache(name)
    if (!account) {
      setPrefs(cached)
      return
    }
    // …then reconcile: the account wins for every key it CARRIES, and the cache
    // keeps the keys it is silent about. Writing the MERGE back to the cache is
    // what makes a customization survive the next reload — overwriting the cache
    // with the account's view alone is precisely what used to lose it.
    const merged = mergePrefs(cached, parsePrefs(account.properties?.[PREFS_PROPERTY]))
    setPrefs(merged)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(cacheKey(name), JSON.stringify(merged))
    }
    setReady(true)
  }, [account, name])

  const set = useCallback(
    (key: string, value: unknown) => {
      setPrefs((prev) => {
        const next = { ...prev, [key]: value }
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(cacheKey(name), JSON.stringify(next))
        }
        // Write-through to the account (self-scoped server-side). Optimistic:
        // a failure leaves the local + cache view; the next load reconciles.
        void AccountApi.updatePreferences({ [key]: value }).catch(() => {})
        return next
      })
    },
    [name],
  )

  const get = useCallback(
    <T,>(key: string, fallback: T): T => {
      const v = prefs[key]
      return v === undefined ? fallback : (v as T)
    },
    [prefs],
  )

  const value = useMemo<PreferencesState>(() => ({ prefs, ready, get, set }), [prefs, ready, get, set])
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>
}

export function usePreferences(): PreferencesState {
  const ctx = useContext(PreferencesContext)
  if (!ctx) throw new Error('usePreferences must be used within <Preferences>')
  return ctx
}
