import { describe, expect, it } from 'vitest'

import { distinctValues, filterByStatus, nextSort, searchRows, sortRows } from './table'

type Row = { name: string; cents: number; ok: boolean; tags: string[]; status: string }

const row = (over: Partial<Row>): Row => ({ name: 'a', cents: 0, ok: false, tags: [], status: 'active', ...over })

describe('sortRows — the ONE comparator for every column type', () => {
  it('sorts a string column, both directions', () => {
    const rows = [row({ name: 'charlie' }), row({ name: 'alpha' }), row({ name: 'bravo' })]
    expect(sortRows(rows, 'name', 'asc').map((r) => r.name)).toEqual(['alpha', 'bravo', 'charlie'])
    expect(sortRows(rows, 'name', 'desc').map((r) => r.name)).toEqual(['charlie', 'bravo', 'alpha'])
  })

  it('is NUMERIC-AWARE on strings: node-2 precedes node-10', () => {
    const rows = [row({ name: 'node-10' }), row({ name: 'node-2' }), row({ name: 'node-1' })]
    expect(sortRows(rows, 'name', 'asc').map((r) => r.name)).toEqual(['node-1', 'node-2', 'node-10'])
  })

  it('is case-insensitive on strings', () => {
    const rows = [row({ name: 'beta' }), row({ name: 'Alpha' })]
    expect(sortRows(rows, 'name', 'asc').map((r) => r.name)).toEqual(['Alpha', 'beta'])
  })

  it('sorts numbers numerically, booleans false-first, arrays by length', () => {
    const money = [row({ cents: 900 }), row({ cents: 10000 }), row({ cents: 1000 })]
    expect(sortRows(money, 'cents', 'asc').map((r) => r.cents)).toEqual([900, 1000, 10000])
    expect(sortRows(money, 'cents', 'desc').map((r) => r.cents)).toEqual([10000, 1000, 900])

    const flags = [row({ name: 'y', ok: true }), row({ name: 'n', ok: false })]
    expect(sortRows(flags, 'ok', 'asc').map((r) => r.name)).toEqual(['n', 'y'])

    const lists = [row({ name: 'two', tags: ['a', 'b'] }), row({ name: 'none' }), row({ name: 'one', tags: ['a'] })]
    expect(sortRows(lists, 'tags', 'asc').map((r) => r.name)).toEqual(['none', 'one', 'two'])
  })

  it('copies (never mutates), is stable, and tolerates an unknown key', () => {
    const rows = [row({ name: 'b', cents: 10 }), row({ name: 'a', cents: 10 })]
    const out = sortRows(rows, 'cents', 'asc')
    expect(out).not.toBe(rows)
    expect(rows.map((r) => r.name)).toEqual(['b', 'a'])
    expect(out.map((r) => r.name)).toEqual(['b', 'a'])
    expect(() => sortRows(rows, 'nope', 'asc')).not.toThrow()
    expect(sortRows(rows, 'nope', 'asc')).toHaveLength(2)
  })
})

describe('nextSort', () => {
  it('flips direction on the SAME key and starts ascending on a NEW key', () => {
    expect(nextSort({ key: 'name', dir: 'asc' }, 'name')).toEqual({ key: 'name', dir: 'desc' })
    expect(nextSort({ key: 'name', dir: 'desc' }, 'name')).toEqual({ key: 'name', dir: 'asc' })
    expect(nextSort({ key: 'name', dir: 'desc' }, 'cents')).toEqual({ key: 'cents', dir: 'asc' })
  })
})

describe('searchRows — literal, never a RegExp of user input', () => {
  const rows = ['Alpha', 'pvc-abc']

  it('matches a case-insensitive substring and passes everything for a blank query', () => {
    expect(searchRows(rows, 'alp', (r) => r)).toEqual(['Alpha'])
    expect(searchRows(rows, 'ALP', (r) => r)).toEqual(['Alpha'])
    expect(searchRows(rows, '   ', (r) => r)).toEqual(rows)
  })

  it('treats metacharacters LITERALLY — `.*` matches nothing, no ReDoS surface', () => {
    expect(searchRows(rows, '.*', (r) => r)).toEqual([])
    expect(searchRows(rows, 'pvc-', (r) => r)).toEqual(['pvc-abc'])
    expect(() => searchRows(rows, '(((((((((', (r) => r)).not.toThrow()
    expect(searchRows(['a.*b'], '.*', (r) => r)).toEqual(['a.*b']) // a literal '.*' DOES match
  })

  it('searches every field the haystack exposes', () => {
    const objs = [row({ name: 'pvc-logs', status: 'bound' }), row({ name: 'pvc-cache', status: 'attached' })]
    const hay = (r: Row) => `${r.name} ${r.status}`
    expect(searchRows(objs, 'attach', hay).map((r) => r.name)).toEqual(['pvc-cache'])
  })
})

describe('distinctValues / filterByStatus', () => {
  it('offers REAL options only — deduped, sorted, blanks dropped', () => {
    expect(distinctValues([{ s: 'b' }, { s: 'a' }, { s: 'b' }, { s: '' }], (r) => r.s)).toEqual(['a', 'b'])
    expect(distinctValues([], (r: { s: string }) => r.s)).toEqual([])
  })

  it('passes everything for "all", matches exactly otherwise, and composes with search', () => {
    const rows = [row({ name: 'a', status: 'running' }), row({ name: 'b', status: 'error' }), row({ name: 'bb', status: 'error' })]
    const pick = (r: Row) => r.status
    const hay = (r: Row) => r.name
    expect(filterByStatus(rows, '', 'all', pick, hay)).toHaveLength(3)
    expect(filterByStatus(rows, '', 'error', pick, hay).map((r) => r.name)).toEqual(['b', 'bb'])
    expect(filterByStatus(rows, 'bb', 'error', pick, hay).map((r) => r.name)).toEqual(['bb'])
    expect(filterByStatus(rows, 'a', 'error', pick, hay)).toEqual([])
  })
})
