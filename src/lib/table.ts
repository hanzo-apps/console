/**
 * Table VALUES — the ONE ordering and the ONE filtering every list surface uses.
 *
 * ONE generic comparator serves every column (string / number / boolean /
 * array-length), so adding a sortable column is declaring `sortable: true` — never
 * another sort function. ONE `searchRows` serves every filter; per-table filters
 * differ only in their state predicate and which fields they read.
 *
 * `sortRows` orders by `row[key]`, so a column's `key` must name the field it
 * DISPLAYS — a column that sorts by something other than what it shows is a lie.
 */
import { useCallback, useMemo, useState } from 'react'

export type SortDir = 'asc' | 'desc'
export type Sort = { key: string; dir: SortDir }

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
 * (Array#sort is), so equal cells keep the backend's own order.
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

/** Header-click reducer: the same key flips direction, a new key starts ascending. */
export function nextSort(cur: Sort, key: string): Sort {
  return cur.key === key ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
}

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

/** Search + an exact match on one status-ish field (`'all'` passes everything). */
export function filterByStatus<T>(rows: T[], q: string, status: string, pick: (row: T) => string, haystack: (row: T) => string): T[] {
  return searchRows(status === 'all' ? rows : rows.filter((r) => pick(r) === status), q, haystack)
}

/**
 * Header-click sorting for one table: state + the reducer, wired to `DataTable`.
 * The returned object is stable while the sort is, so a caller can depend on it whole
 * (`useMemo([rows, q, sort])`) instead of destructuring to keep its memo honest.
 */
export function useSort(key: string, dir: SortDir = 'asc') {
  const [sort, setSort] = useState<Sort>({ key, dir })
  const onSortChange = useCallback((k: string) => setSort((s) => nextSort(s, k)), [])
  const apply = useCallback(<T,>(rows: T[]): T[] => sortRows(rows, sort.key, sort.dir), [sort])
  return useMemo(() => ({ sort, onSortChange, apply }), [sort, onSortChange, apply])
}
