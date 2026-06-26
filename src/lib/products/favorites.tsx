'use client'

/**
 * Pinned favorites — products the user keeps one click away in the sidebar.
 *
 * A thin, typed view over account-backed `usePreferences` (the `favorites`
 * key). Because preferences persist to the IAM account, pins follow the user
 * across every device and login — no per-browser drift.
 */
import { useCallback } from 'react'

import { usePreferences } from './preferences'

/** Sensible first-run pins so the Pinned section isn't empty for new users. */
const DEFAULT_PINNED = ['chat', 'billing']

export type Favorites = {
  /** Pinned product ids, in pin order. */
  pinned: string[]
  /** Pin/unpin a product id (persisted to the account immediately). */
  toggle: (id: string) => void
  isPinned: (id: string) => boolean
  ready: boolean
}

export function useFavorites(): Favorites {
  const { get, set, ready } = usePreferences()
  const pinned = get<string[]>('favorites', DEFAULT_PINNED)

  const toggle = useCallback(
    (id: string) => {
      const next = pinned.includes(id) ? pinned.filter((p) => p !== id) : [...pinned, id]
      set('favorites', next)
    },
    [pinned, set],
  )

  const isPinned = useCallback((id: string) => pinned.includes(id), [pinned])

  return { pinned, toggle, isPinned, ready }
}
