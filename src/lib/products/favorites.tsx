'use client'

/**
 * Pinned favorites — the flat, compat view over the richer grouped/ordered pins
 * model (`usePins`). Existing callers (the overview cards, and any simple
 * pin/unpin star) only need "is this pinned?" and "toggle it"; the sidebar uses
 * the full `usePins` for groups + drag-reorder + colors.
 *
 * ONE store, one source of truth: this is a thin adapter, not a second model —
 * both go through the same account-backed preferences, so a pin toggled on a card
 * shows up (grouped) in the sidebar and follows the user across devices.
 */
import { usePins } from './pins'

export type Favorites = {
  /** Pinned product ids, in pin order. */
  pinned: string[]
  /** Pin/unpin a product id (persisted to the account immediately). */
  toggle: (id: string) => void
  isPinned: (id: string) => boolean
  ready: boolean
}

export function useFavorites(): Favorites {
  const { pinnedIds, toggle, isPinned, ready } = usePins()
  return { pinned: pinnedIds, toggle, isPinned, ready }
}
