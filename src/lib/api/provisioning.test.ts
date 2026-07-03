import { describe, expect, it } from 'vitest'

import { normalizeResourceList } from './provisioning'

/**
 * The provisioning list must ALWAYS reduce to a `Resource[]`. A managed backend
 * that 200s with a wrapper object (the Vector regression) would otherwise reach
 * the list view's `for…of` / `.length` as a non-iterable and blank the module.
 * These pin the honest unwrap-or-empty contract at the transport boundary.
 */
describe('normalizeResourceList', () => {
  const row = { id: '1', name: 'a', kind: 'vector', status: 'ready', host: 'h', port: 6333 }

  it('passes a bare array through', () => {
    expect(normalizeResourceList([row])).toEqual([row])
  })

  it('unwraps common envelope keys', () => {
    expect(normalizeResourceList({ data: [row] })).toEqual([row])
    expect(normalizeResourceList({ items: [row] })).toEqual([row])
    expect(normalizeResourceList({ results: [row] })).toEqual([row])
    expect(normalizeResourceList({ collections: [row] })).toEqual([row])
    expect(normalizeResourceList({ rows: [row] })).toEqual([row])
  })

  it('unwraps one level of nesting (e.g. Qdrant `result.collections`)', () => {
    expect(normalizeResourceList({ result: { collections: [row] } })).toEqual([row])
  })

  it('keeps an honest empty array for wrapped-but-empty', () => {
    expect(normalizeResourceList({ data: [] })).toEqual([])
    expect(normalizeResourceList({ result: {} })).toEqual([])
  })

  it('never crashes on a non-list body — degrades to []', () => {
    expect(normalizeResourceList(null)).toEqual([])
    expect(normalizeResourceList(undefined)).toEqual([])
    expect(normalizeResourceList('oops')).toEqual([])
    expect(normalizeResourceList(42)).toEqual([])
    expect(normalizeResourceList({})).toEqual([])
    expect(normalizeResourceList({ error: 'boom' })).toEqual([])
  })

  it('drops non-object elements defensively', () => {
    expect(normalizeResourceList([row, null, 'x', 3, row])).toEqual([row, row])
  })
})
