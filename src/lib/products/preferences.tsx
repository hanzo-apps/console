'use client'

/**
 * User preferences — the ONE cross-product store for every console/product
 * customization (pinned favorites, layout, and anything added later).
 *
 * Source of truth is cloud `/v1/prefs` (`clients/prefs`), a per-USER document
 * keyed on the identity the server derives from the validated token, so
 * customizations follow the person across every product and every device.
 * localStorage is ONLY a fast-paint cache to avoid a flash before the account
 * loads — it is never authoritative.
 *
 * PREVIOUSLY THIS DID NOT PERSIST. The write POSTed `/v1/update-preferences`, an
 * IAM endpoint that is not served, and the read recovered prefs from the IAM
 * account's `properties['hanzo.preferences']` blob — which nothing was writing.
 * Both sides of the loop were dead: a preference lived exactly as long as the
 * localStorage cache in front of it and never reached a second device. The
 * layer's design was right; it was pointed at an endpoint that did not exist.
 *
 * Writes are optimistic + write-through: the local view updates immediately and
 * the PATCH merges server-side, so two surfaces (or two tabs) saving DIFFERENT
 * keys both survive instead of the later one clobbering the earlier.
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

import { PrefsApi } from '~/lib/api/prefs'
import { useSession } from '~/lib/auth/session'

export type Preferences = Record<string, unknown>

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

function parsePrefs(raw: string | undefined | null): Preferences {
  if (!raw) return {}
  try {
    const p = JSON.parse(raw)
    return p && typeof p === 'object' && !Array.isArray(p) ? (p as Preferences) : {}
  } catch {
    return {}
  }
}

export function Preferences({ children }: { children: ReactNode }) {
  const { account } = useSession()
  const name = account?.name
  const [prefs, setPrefs] = useState<Preferences>({})
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // Fast-paint from the local cache so pins don't flash on a cold load…
    if (typeof window !== 'undefined' && !account) {
      setPrefs(parsePrefs(window.localStorage.getItem(cacheKey(name))))
      return
    }
    if (!account) return

    // …then the server becomes the source of truth once we have an identity to
    // read as. A failure LEAVES the cached view rather than blanking it: losing
    // the network should not look like losing your settings, and the next load
    // reconciles. Guarded against a late resolve landing after a user switch.
    let live = true
    void PrefsApi.get()
      .then((server) => {
        if (!live) return
        setPrefs(server)
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(cacheKey(name), JSON.stringify(server))
        }
      })
      .catch(() => {
        /* keep the cached view */
      })
      .finally(() => {
        if (live) setReady(true)
      })
    return () => {
      live = false
    }
  }, [account, name])

  const set = useCallback(
    (key: string, value: unknown) => {
      setPrefs((prev) => {
        const next = { ...prev, [key]: value }
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(cacheKey(name), JSON.stringify(next))
        }
        // Write-through to the server (self-scoped there). Optimistic: a failure
        // leaves the local + cache view and the next load reconciles. The PATCH
        // returns the MERGED document, so a key another surface or device wrote
        // meanwhile lands here instead of being invisible until reload.
        void PrefsApi.merge({ [key]: value })
          .then((merged) => {
            setPrefs(merged)
            if (typeof window !== 'undefined') {
              window.localStorage.setItem(cacheKey(name), JSON.stringify(merged))
            }
          })
          .catch(() => {
            /* keep the optimistic view */
          })
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
