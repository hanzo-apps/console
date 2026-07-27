'use client'

/**
 * `useList` — one list's search, sort and facets, persisted per user.
 *
 * The thin React binding over the pure `list/core` model and the ONE account-backed
 * preferences store, exactly as `pins.tsx` binds `pins-core`. A surface asks for
 * `useList('models')` and gets back the same value it left behind: the ordering it
 * chose and the narrowing it typed, on this device and the next one.
 *
 * Why persist it at all: a list you have to re-sort every time you arrive is a list
 * you stop sorting. The state is small, it is the user's own, and it already has a
 * home — so it goes there, not into a component's `useState` that a navigation
 * throws away, and not into localStorage that another product can't read.
 *
 * SCOPE, said plainly: preferences are per USER, not per user-per-org. A SuperAdmin
 * who masquerades into another org keeps their own sorts and filters. That reads as
 * correct to me — these are YOUR tools, not the tenant's data — but it is a product
 * call, so it is written down here rather than buried.
 */
import { useCallback, useMemo } from 'react'

import { usePreferences } from '~/lib/products/preferences'
import {
  EMPTY_VIEW,
  activeCount,
  isDefaultView,
  nextSort,
  normalizeView,
  viewKey,
  type ListView,
  type Sort,
} from './core'

export type List = {
  /** The persisted view — what to search by, order by, and narrow to. */
  view: ListView
  q: string
  setQ: (q: string) => void
  /** The active column order, or null for the surface's natural order. */
  sort: Sort | null
  /** Header click: ascending → descending → back to natural order. */
  toggleSort: (key: string) => void
  /** The selected value of one facet, or '' when it isn't narrowed. */
  filter: (name: string) => string
  /** Select a facet value; '' (or the caller's own "all") clears it. */
  setFilter: (name: string, value: string) => void
  /** Clear every narrowing at once. */
  reset: () => void
  /** How many narrowings are active — 0 means the list is showing everything. */
  active: number
  /** False until the account has been read (the cache may paint first). */
  ready: boolean
}

/**
 * The persisted view for the list identified by `id` (use the product/surface id,
 * or `<product>.<table>` when one surface owns several tables).
 */
export function useList(id: string): List {
  const { get, set, ready } = usePreferences()
  const stored = get<unknown>(viewKey(id), undefined)
  const view = useMemo(() => (stored === undefined ? EMPTY_VIEW : normalizeView(stored)), [stored])

  // ONE write path: every mutator is `write(pureOp(view, …))`, so the persisted
  // value can never drift from what the surface is rendering.
  const write = useCallback((next: ListView) => set(viewKey(id), next), [set, id])

  return useMemo<List>(
    () => ({
      view,
      q: view.q,
      setQ: (q) => write({ ...view, q }),
      sort: view.sort,
      toggleSort: (key) => write({ ...view, sort: nextSort(view.sort, key) }),
      filter: (name) => view.filters[name] ?? '',
      setFilter: (name, value) => {
        const filters = { ...view.filters }
        // An empty selection is the ABSENCE of a facet, never a stored ''. Keeps
        // `isDefaultView`/`active` honest and the stored blob free of noise.
        if (value) filters[name] = value
        else delete filters[name]
        write({ ...view, filters })
      },
      reset: () => write(EMPTY_VIEW),
      active: activeCount(view),
      ready,
    }),
    [view, write, ready],
  )
}

export { isDefaultView, viewKey, type ListView, type Sort }
