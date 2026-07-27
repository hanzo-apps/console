/**
 * Pins model — the pure, account-persisted structure behind the sidebar's pinned
 * products: an ORDERED, GROUPED list the user curates (pin/unpin, drag to reorder,
 * organize into named groups). Kept dependency-free (no React, no registry) so all
 * the array surgery is unit-testable in isolation; `pins.tsx` binds it to the
 * account-backed `usePreferences` store.
 *
 * Representation (what persists):
 *   - `pins`   : ordered `PinEntry[]` — the master order, group-sorted (all of one
 *                group's pins are contiguous, groups in `order`). Deriving the
 *                display is just a filter, and a reorder is a rebuild — one source
 *                of truth for order, so the sidebar and the manage view can never
 *                disagree.
 *   - `groups` : ordered NAMED group labels (the default/ungrouped bucket is the
 *                empty string `''` and is always first; it is implicit, never in
 *                this list). Lets a group exist while empty.
 *
 * Every operation returns a NEW normalized model (immutable) — safe to hand
 * straight to a React state setter / preference write.
 */

/** The default (ungrouped) bucket. Rendered as "Pinned". */
export const DEFAULT_GROUP = ''
/** Display label for the default bucket. */
export const DEFAULT_GROUP_LABEL = 'Pinned'

/** One pinned product: its id and the group it lives in (`''` = ungrouped). */
export type PinEntry = { id: string; group: string }

/** The persisted model: the ordered pins + the ordered named groups. */
export type PinModel = { pins: PinEntry[]; groups: string[] }

/** A display bucket: a group with its ordered entries. */
export type PinGroupView = { name: string; label: string; entries: PinEntry[] }


/** Sensible first-run pins so the section isn't empty (must be real catalog ids). */
export const DEFAULT_PINNED_IDS = ['models', 'chat']

const asString = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

/**
 * Coerce whatever is stored (legacy `favorites: string[]`, a `PinEntry[]`, or the
 * `{pins,groups}` model) into a clean, group-sorted `PinModel`. Dedupes ids
 * (first wins), drops blanks, and ensures every group a pin references exists in
 * `groups`. Idempotent.
 */
export function normalizeModel(input: {
  pins?: unknown
  groups?: unknown
  legacy?: unknown
}): PinModel {
  // Named groups first (defines group order); the default bucket '' is implicit.
  const groups: string[] = []
  const pushGroup = (g: string | undefined) => {
    if (g && g !== DEFAULT_GROUP && !groups.includes(g)) groups.push(g)
  }
  if (Array.isArray(input.groups)) for (const g of input.groups) pushGroup(asString(g))

  // Collect raw entries from the richest source available.
  const raw: PinEntry[] = []
  const seen = new Set<string>()
  const add = (id: string | undefined, group: string | undefined) => {
    if (!id || seen.has(id)) return
    seen.add(id)
    const g = group && group !== DEFAULT_GROUP ? group : DEFAULT_GROUP
    raw.push({ id, group: g })
    pushGroup(g)
  }

  if (Array.isArray(input.pins)) {
    for (const p of input.pins) {
      if (typeof p === 'string') add(p, DEFAULT_GROUP)
      else if (p && typeof p === 'object') add(asString((p as PinEntry).id), asString((p as PinEntry).group))
    }
  } else if (Array.isArray(input.legacy)) {
    // Migrate the old flat favorites (`string[]`) — all ungrouped, in order.
    for (const id of input.legacy) add(asString(id), DEFAULT_GROUP)
  }

  return groupSort({ pins: raw, groups })
}

/** Group order = the default bucket, then the named groups in their stored order. */
const groupOrder = (m: PinModel): string[] => [DEFAULT_GROUP, ...m.groups]

/** Re-sort `pins` so every group's entries are contiguous and in group order,
 *  preserving each entry's existing relative order within its group. */
function groupSort(m: PinModel): PinModel {
  const order = groupOrder(m)
  const rank = new Map(order.map((g, i) => [g, i]))
  const pins = [...m.pins].sort((a, b) => (rank.get(a.group) ?? 999) - (rank.get(b.group) ?? 999))
  return { pins, groups: m.groups }
}

/** Is `id` currently pinned? */
export const isPinned = (m: PinModel, id: string): boolean => m.pins.some((p) => p.id === id)

/** Pin `id` (ungrouped, at the end of the default bucket) if not already pinned. */
export function pin(m: PinModel, id: string): PinModel {
  if (isPinned(m, id)) return m
  return groupSort({ pins: [...m.pins, { id, group: DEFAULT_GROUP }], groups: m.groups })
}

/** Unpin `id` (no-op if absent). Groups are left intact (an empty group survives). */
export function unpin(m: PinModel, id: string): PinModel {
  if (!isPinned(m, id)) return m
  return { pins: m.pins.filter((p) => p.id !== id), groups: m.groups }
}

/** Toggle `id` pinned/unpinned. */
export const toggle = (m: PinModel, id: string): PinModel => (isPinned(m, id) ? unpin(m, id) : pin(m, id))

/** The ordered display buckets. `includeEmpty` keeps groups with no pins (for the
 *  manage view); the sidebar passes false so an empty group doesn't show a header. */
export function groupedView(m: PinModel, includeEmpty = false): PinGroupView[] {
  const out: PinGroupView[] = []
  for (const name of groupOrder(m)) {
    const entries = m.pins.filter((p) => p.group === name)
    if (entries.length === 0 && !(includeEmpty && name !== DEFAULT_GROUP)) continue
    out.push({ name, label: name === DEFAULT_GROUP ? DEFAULT_GROUP_LABEL : name, entries })
  }
  return out
}

/**
 * Move `id` to `group` at position `index` within that group (clamped). Adds the
 * group if it is new. This is the single reorder/regroup primitive — a same-group
 * reorder and a cross-group move are the same operation. Pure rebuild.
 */
export function move(m: PinModel, id: string, group: string, index: number): PinModel {
  if (!isPinned(m, id)) return m
  const target = group || DEFAULT_GROUP
  const groups = target !== DEFAULT_GROUP && !m.groups.includes(target) ? [...m.groups, target] : m.groups

  const moving = { id, group: target }
  const others = m.pins.filter((p) => p.id !== id)
  const inTarget = others.filter((p) => p.group === target)
  const clamped = Math.max(0, Math.min(index, inTarget.length))

  // Rebuild the target bucket with `moving` inserted at `clamped`, then stitch the
  // full list back together in group order (groupSort makes the result canonical).
  const rebuilt: PinEntry[] = []
  for (const name of [DEFAULT_GROUP, ...groups]) {
    if (name === target) {
      const bucket = others.filter((p) => p.group === target)
      bucket.splice(clamped, 0, moving)
      rebuilt.push(...bucket)
    } else {
      rebuilt.push(...others.filter((p) => p.group === name))
    }
  }
  return groupSort({ pins: rebuilt, groups })
}

/** Assign `id` to `group` (append at the end of that group). Convenience over `move`. */
export function assign(m: PinModel, id: string, group: string): PinModel {
  const target = group || DEFAULT_GROUP
  const count = m.pins.filter((p) => p.group === target && p.id !== id).length
  return move(m, id, target, count)
}

/** Create an empty named group (no-op for blank/default/duplicate). */
export function addGroup(m: PinModel, name: string): PinModel {
  const g = name.trim()
  if (!g || g === DEFAULT_GROUP || m.groups.includes(g)) return m
  return { pins: m.pins, groups: [...m.groups, g] }
}

/** Remove a named group; its pins fall back to the default bucket (kept pinned). */
export function removeGroup(m: PinModel, name: string): PinModel {
  if (!m.groups.includes(name)) return m
  const pins = m.pins.map((p) => (p.group === name ? { ...p, group: DEFAULT_GROUP } : p))
  return groupSort({ pins, groups: m.groups.filter((g) => g !== name) })
}

/**
 * Float the pinned items of any list to the front, in the user's own PIN order,
 * leaving everything else in the order it arrived. Generic over the item, because
 * "pinned first" is one rule that must read the same in the sidebar, in search
 * results and in a product grid — a second implementation is a second answer.
 *
 * Stable in both partitions: search relevance still decides the tail's order, and
 * the head reads exactly like the user's own Pinned section. An id that is pinned
 * but absent from `items` is simply not there — this reorders, it never injects.
 */
export function pinnedFirst<T>(items: T[], id: (item: T) => string, pinned: string[]): T[] {
  if (pinned.length === 0) return items
  const rank = new Map(pinned.map((p, i) => [p, i]))
  const head: { item: T; r: number }[] = []
  const tail: T[] = []
  for (const item of items) {
    const r = rank.get(id(item))
    if (r === undefined) tail.push(item)
    else head.push({ item, r })
  }
  if (head.length === 0) return items
  head.sort((a, b) => a.r - b.r)
  return [...head.map((h) => h.item), ...tail]
}

/** Rename a named group, preserving its order and its pins (no-op on collisions). */
export function renameGroup(m: PinModel, from: string, to: string): PinModel {
  const t = to.trim()
  if (!m.groups.includes(from) || !t || t === from || m.groups.includes(t) || t === DEFAULT_GROUP) return m
  return {
    pins: m.pins.map((p) => (p.group === from ? { ...p, group: t } : p)),
    groups: m.groups.map((g) => (g === from ? t : g)),
  }
}
