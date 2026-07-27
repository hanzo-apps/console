import { describe, expect, it } from 'vitest'

import {
  EMPTY_VIEW,
  activeCount,
  applySort,
  distinctValues,
  isDefaultView,
  nextSort,
  normalizeView,
  searchRows,
  sortRows,
  viewKey,
} from './core'

describe('sortRows — one comparator for every list', () => {
  const rows = [
    { name: 'node-10', cents: 900, on: false, tags: ['a', 'b'] },
    { name: 'node-2', cents: 1200, on: true, tags: [] },
    { name: 'Node-1', cents: 900, on: false, tags: ['a'] },
  ]

  it('collates strings numerically and case-insensitively (node-2 before node-10)', () => {
    expect(sortRows(rows, 'name', 'asc').map((r) => r.name)).toEqual(['Node-1', 'node-2', 'node-10'])
  })

  it('compares numbers as numbers, not as text', () => {
    expect(sortRows([{ n: 9 }, { n: 100 }, { n: 20 }], 'n', 'asc').map((r) => r.n)).toEqual([9, 20, 100])
  })

  it('ranks booleans and array lengths without a bespoke comparator', () => {
    expect(sortRows(rows, 'on', 'desc')[0].on).toBe(true)
    expect(sortRows(rows, 'tags', 'desc')[0].tags).toHaveLength(2)
  })

  it('is stable — equal cells keep the caller order', () => {
    expect(sortRows(rows, 'cents', 'asc').map((r) => r.name)).toEqual(['node-10', 'Node-1', 'node-2'])
  })

  it('does not mutate the input', () => {
    const input = [{ n: 2 }, { n: 1 }]
    sortRows(input, 'n', 'asc')
    expect(input.map((r) => r.n)).toEqual([2, 1])
  })

  it('never crashes on an absent or non-finite cell, and invents no rank', () => {
    const odd = [{ n: undefined }, { n: NaN }, { n: 5 }] as { n: unknown }[]
    expect(() => sortRows(odd, 'n', 'asc')).not.toThrow()
    expect(sortRows(odd, 'missing', 'asc')).toHaveLength(3)
  })
})

describe('applySort', () => {
  it('hands rows back untouched when the view has no sort', () => {
    const rows = [{ n: 2 }, { n: 1 }]
    expect(applySort(rows, null)).toBe(rows)
  })

  it('orders by the view sort when it has one', () => {
    expect(applySort([{ n: 2 }, { n: 1 }], { key: 'n', dir: 'asc' }).map((r) => r.n)).toEqual([1, 2])
  })
})

describe('nextSort — a superset of the reducer the infra board already shipped', () => {
  it('starts a new column ascending', () => {
    expect(nextSort(null, 'name')).toEqual({ key: 'name', dir: 'asc' })
    expect(nextSort({ key: 'cents', dir: 'desc' }, 'name')).toEqual({ key: 'name', dir: 'asc' })
  })

  it('flips the same column', () => {
    expect(nextSort({ key: 'name', dir: 'asc' }, 'name')).toEqual({ key: 'name', dir: 'desc' })
    expect(nextSort({ key: 'name', dir: 'desc' }, 'name')).toEqual({ key: 'name', dir: 'asc' })
  })
})

describe('searchRows — literal, never a compiled RegExp of user input', () => {
  const rows = [{ s: 'alpha' }, { s: 'BETA' }, { s: 'gamma' }]
  const hay = (r: { s: string }) => r.s

  it('matches a case-insensitive substring', () => {
    expect(searchRows(rows, 'et', hay)).toEqual([{ s: 'BETA' }])
  })

  it('returns everything for a blank or whitespace query', () => {
    expect(searchRows(rows, '   ', hay)).toBe(rows)
  })

  it('treats regex metacharacters as literal text (no ReDoS, no accidental wildcard)', () => {
    expect(searchRows(rows, '.*', hay)).toEqual([])
    expect(searchRows([{ s: 'a.*b' }], '.*', hay)).toHaveLength(1)
    expect(searchRows(rows, '(((((((', hay)).toEqual([])
  })
})

describe('distinctValues — a filter offers REAL options only', () => {
  it('dedupes, drops blanks and sorts', () => {
    const rows = [{ v: 'b' }, { v: 'a' }, { v: 'b' }, { v: '' }]
    expect(distinctValues(rows, (r) => r.v)).toEqual(['a', 'b'])
  })
})

describe('normalizeView — a stored blob outlives the code that wrote it', () => {
  it('round-trips a well-formed view', () => {
    const v = { q: 'zen', sort: { key: 'cost', dir: 'desc' }, filters: { status: 'live' } }
    expect(normalizeView(v)).toEqual(v)
  })

  it('degrades anything unrecognizable to the empty view rather than throwing', () => {
    for (const bad of [undefined, null, 0, 'nope', [], { q: 5 }]) {
      expect(() => normalizeView(bad)).not.toThrow()
      expect(normalizeView(bad).q).toBe('')
    }
  })

  it('drops a malformed sort instead of ordering by nonsense', () => {
    expect(normalizeView({ sort: { key: 'cost', dir: 'sideways' } }).sort).toBeNull()
    expect(normalizeView({ sort: { key: '', dir: 'asc' } }).sort).toBeNull()
    expect(normalizeView({ sort: 'cost' }).sort).toBeNull()
  })

  it('keeps only string facet values, so no sentinel or object leaks in', () => {
    expect(normalizeView({ filters: { a: 'x', b: '', c: 3, d: { n: 1 } } }).filters).toEqual({ a: 'x' })
  })
})

describe('the view value itself', () => {
  it('EMPTY_VIEW narrows nothing', () => {
    expect(isDefaultView(EMPTY_VIEW)).toBe(true)
    expect(activeCount(EMPTY_VIEW)).toBe(0)
  })

  it('counts search, sort and each facet as one narrowing', () => {
    const v = { q: 'a', sort: { key: 'n', dir: 'asc' as const }, filters: { x: '1', y: '2' } }
    expect(activeCount(v)).toBe(4)
    expect(isDefaultView(v)).toBe(false)
  })

  it('does not count whitespace as a search', () => {
    expect(activeCount({ ...EMPTY_VIEW, q: '  ' })).toBe(0)
    expect(isDefaultView({ ...EMPTY_VIEW, q: '  ' })).toBe(true)
  })

  it('namespaces every list into its own preference slot', () => {
    expect(viewKey('models')).toBe('list.models')
    expect(viewKey('infra.volumes')).not.toBe(viewKey('infra.nodes'))
  })
})
