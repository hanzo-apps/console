'use client'

/**
 * Pins + per-product colors — the account-backed customization the user controls
 * from the sidebar. A thin React binding over the pure `pins-core` model and the
 * pure `colors` palette, persisted through the ONE preferences store
 * (`usePreferences` → the IAM account), so a user's pins, pin-groups, order, and
 * icon colors follow them across every device and login.
 *
 * Persisted preference keys (all under the account's `hanzo.preferences`):
 *   - `pins`         : ordered `PinEntry[]` (the grouped, ordered pins)
 *   - `pinGroups`    : ordered named group labels
 *   - `productColors`: `Record<id, swatchKey>` — per-product color overrides
 *
 * Legacy `favorites: string[]` is migrated transparently on first read; a fresh
 * user is seeded with sensible defaults WITHOUT a write (nothing persists until
 * they actually pin/reorder/recolor something).
 */
import { useCallback, useMemo } from 'react'

import { usePreferences } from './preferences'
import * as core from './pins-core'
import { DEFAULT_PINNED_IDS, type PinEntry, type PinGroupView, type PinModel } from './pins-core'
import { productColorHex, productColorKey } from './colors'
import { findEntry } from './registry'

export type Pins = {
  /** The normalized model (order + groups). */
  model: PinModel
  /** Display buckets for the sidebar (groups with no pins are omitted). */
  view: PinGroupView[]
  /** Display buckets for the manage pane (empty groups included). */
  manageView: PinGroupView[]
  /** Flat pinned ids in display order (compat with the old favorites shape). */
  pinnedIds: string[]
  isPinned: (id: string) => boolean
  toggle: (id: string) => void
  pin: (id: string) => void
  unpin: (id: string) => void
  /** Move a pin to `group` at `index` (the reorder + regroup primitive). */
  move: (id: string, group: string, index: number) => void
  /** Assign a pin to a group (append). */
  assign: (id: string, group: string) => void
  addGroup: (name: string) => void
  removeGroup: (name: string) => void
  renameGroup: (from: string, to: string) => void
  ready: boolean
}

export function usePins(): Pins {
  const { get, set, ready } = usePreferences()
  const rawPins = get<unknown>('pins', undefined)
  const rawGroups = get<unknown>('pinGroups', undefined)
  const legacy = get<unknown>('favorites', undefined)

  const model = useMemo<PinModel>(() => {
    if (rawPins !== undefined) return core.normalizeModel({ pins: rawPins, groups: rawGroups })
    // No pins stored yet: migrate legacy favorites, or seed the defaults (no write).
    const legacyIds = Array.isArray(legacy) ? legacy : DEFAULT_PINNED_IDS
    return core.normalizeModel({ legacy: legacyIds, groups: rawGroups })
  }, [rawPins, rawGroups, legacy])

  const persist = useCallback(
    (next: PinModel) => {
      set('pins', next.pins)
      set('pinGroups', next.groups)
    },
    [set],
  )
  // Every mutator is `persist(pureOp(model, …))` — one write path, pure transforms.
  const mutate = useCallback((next: PinModel) => persist(next), [persist])

  return useMemo<Pins>(
    () => ({
      model,
      view: core.groupedView(model, false),
      manageView: core.groupedView(model, true),
      pinnedIds: model.pins.map((p: PinEntry) => p.id),
      isPinned: (id) => core.isPinned(model, id),
      toggle: (id) => mutate(core.toggle(model, id)),
      pin: (id) => mutate(core.pin(model, id)),
      unpin: (id) => mutate(core.unpin(model, id)),
      move: (id, group, index) => mutate(core.move(model, id, group, index)),
      assign: (id, group) => mutate(core.assign(model, id, group)),
      addGroup: (name) => mutate(core.addGroup(model, name)),
      removeGroup: (name) => mutate(core.removeGroup(model, name)),
      renameGroup: (from, to) => mutate(core.renameGroup(model, from, to)),
      ready,
    }),
    [model, mutate, ready],
  )
}

export type ProductColors = {
  /** The user's per-product overrides (id → swatch key). */
  overrides: Record<string, string>
  /** Effective hex for a product's icon (override → curated → hash). */
  colorOf: (id: string) => string
  /** Effective swatch key for a product. */
  keyOf: (id: string) => string
  /** Set a product's color override. */
  setColor: (id: string, key: string) => void
  /** Clear a product's override (back to the default color). */
  resetColor: (id: string) => void
}

export function useProductColors(): ProductColors {
  const { get, set } = usePreferences()
  const overrides = get<Record<string, string>>('productColors', {})
  return useMemo<ProductColors>(
    () => ({
      overrides,
      colorOf: (id) => productColorHex(id, overrides, findEntry(id)?.category),
      keyOf: (id) => productColorKey(id, overrides, findEntry(id)?.category),
      setColor: (id, key) => set('productColors', { ...overrides, [id]: key }),
      resetColor: (id) => {
        const next = { ...overrides }
        delete next[id]
        set('productColors', next)
      },
    }),
    [overrides, set],
  )
}
