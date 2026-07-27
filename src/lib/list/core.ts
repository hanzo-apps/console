/**
 * List view — the pure model behind "sort, filter, find" on every list in the
 * console. No React, no registry, no network, so every ordering and predicate is
 * unit-testable in the node env.
 *
 * A LIST VIEW is a value: what the user typed, which column they ordered by, and
 * which facets they narrowed to. It is the same value for a table of clusters, a
 * catalog of models and a storefront of apps — so there is ONE of it, and it is
 * the thing that gets persisted per user (see `useList`). Rows stay the caller's;
 * this module only decides ORDER and MEMBERSHIP.
 *
 * The comparator, the reducer and the search predicate here were previously a
 * private copy inside the Infrastructure board. They are promoted verbatim (same
 * semantics, same tests) so a sibling list never reaches into an admin module for
 * ordering — the move `ui/Filters` already made for the controls themselves.
 */

export type SortDir = 'asc' | 'desc'
export type Sort = { key: string; dir: SortDir }

/**
 * One list's view state. `filters` is an open map so a surface declares its own
 * facets (status, category, provider, …) without this model knowing their names;
 * an absent facet means "not narrowed", which is why the default is `{}` and not
 * a set of `'all'` sentinels.
 */
export type ListView = {
  /** The user's search text. */
  q: string
  /** The active column order, or null for the surface's natural order. */
  sort: Sort | null
  /** Facet name → selected value. */
  filters: Record<string, string>
}

export const EMPTY_VIEW: ListView = { q: '', sort: null, filters: {} }

// ── ordering ──────────────────────────────────────────────────────────────────

/**
 * The ONE comparable projection of a cell: numbers/booleans/array-lengths compare
 * numerically, everything else as a string. Absent → '' (sorts first ascending), so a
 * missing datum never crashes the sort and never fabricates a rank.
 */
function cmpValue(v: unknown): string | number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (typeof v === 'boolean') return v ? 1 : 0
  if (Array.isArray(v)) return v.length
  if (v == null) return ''
  return String(v)
}

/**
 * Sort a copy of `rows` by `key`. Numeric-ish cells compare numerically; strings use a
 * numeric-aware, case-insensitive collation so `node-2` precedes `node-10`. Stable
 * (Array#sort is), so equal cells keep the caller's own order.
 */
export function sortRows<T>(rows: T[], key: string, dir: SortDir): T[] {
  const sign = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const x = cmpValue((a as Record<string, unknown>)[key])
    const y = cmpValue((b as Record<string, unknown>)[key])
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * sign
    return String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' }) * sign
  })
}

/** Apply a view's sort, or hand the rows back untouched when it has none. */
export const applySort = <T,>(rows: T[], sort: Sort | null): T[] =>
  sort ? sortRows(rows, sort.key, sort.dir) : rows

/**
 * Header-click reducer: the same key flips direction, a new key starts ascending.
 *
 * Deliberately a strict SUPERSET of the reducer the Infrastructure board already
 * ships (which this replaces) — it only additionally accepts `null` as "no sort
 * yet", for a surface whose natural order is meaningful until the user overrides
 * it. Same two states, same flips, so no shipped board changes behavior. Returning
 * to natural order is the job of Reset, which clears the whole view at once.
 */
export function nextSort(cur: Sort | null, key: string): Sort {
  return cur?.key === key ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
}

// ── membership ────────────────────────────────────────────────────────────────

/**
 * Literal, case-insensitive substring match over the fields `haystack` exposes — never
 * a compiled RegExp of user input (no ReDoS, no accidental metacharacters).
 */
export function searchRows<T>(rows: T[], q: string, haystack: (row: T) => string): T[] {
  const needle = q.trim().toLowerCase()
  if (!needle) return rows
  return rows.filter((r) => haystack(r).toLowerCase().includes(needle))
}

/** The distinct non-empty values of a field, sorted — so a filter offers REAL options only. */
export function distinctValues<T>(rows: T[], pick: (row: T) => string): string[] {
  return Array.from(new Set(rows.map(pick).filter(Boolean))).sort()
}

// ── persistence ───────────────────────────────────────────────────────────────

/**
 * The preference key one list's view is stored under. Namespaced so every list
 * owns its own slot in the ONE account-backed store and no two surfaces collide.
 */
export const viewKey = (id: string): string => `list.${id}`

/**
 * Coerce whatever is stored into a clean `ListView`. Written defensively because
 * the stored blob outlives the code that wrote it: a renamed sort key, a dropped
 * facet, or a hand-edited property must degrade to "no narrowing" rather than
 * throw inside a render. Unknown-shaped input → `EMPTY_VIEW`.
 */
export function normalizeView(raw: unknown): ListView {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return EMPTY_VIEW
  const o = raw as Record<string, unknown>

  const q = typeof o.q === 'string' ? o.q : ''

  let sort: Sort | null = null
  const s = o.sort
  if (s && typeof s === 'object' && !Array.isArray(s)) {
    const { key, dir } = s as Record<string, unknown>
    if (typeof key === 'string' && key && (dir === 'asc' || dir === 'desc')) sort = { key, dir }
  }

  const filters: Record<string, string> = {}
  const f = o.filters
  if (f && typeof f === 'object' && !Array.isArray(f)) {
    for (const [k, v] of Object.entries(f as Record<string, unknown>)) {
      if (typeof v === 'string' && v) filters[k] = v
    }
  }

  return { q, sort, filters }
}

/** True when a view narrows nothing — the state a "Reset" affordance returns to. */
export const isDefaultView = (v: ListView): boolean =>
  v.q.trim() === '' && v.sort === null && Object.keys(v.filters).length === 0

/**
 * How many narrowings are active, for the count a Reset control carries. Search
 * and sort each count as one, as does each facet — the user's mental model is
 * "three things are affecting this list", not "one query object".
 */
export const activeCount = (v: ListView): number =>
  (v.q.trim() ? 1 : 0) + (v.sort ? 1 : 0) + Object.keys(v.filters).length
