import { describe, it, expect } from 'vitest'

import { normalizePrompt, normalizePrompts, normalizeMetricRows, normalizeCatalog, normalizeCatalogEntry } from './prompts'

describe('normalizePrompt', () => {
  it('drops a record with no name/id/slug', () => {
    expect(normalizePrompt({})).toBeNull()
    expect(normalizePrompt({ versions: [1] })).toBeNull()
    expect(normalizePrompt(null)).toBeNull()
  })

  it('reads the name from name, then id, then slug', () => {
    expect(normalizePrompt({ name: 'a' })?.name).toBe('a')
    expect(normalizePrompt({ id: 'b' })?.name).toBe('b')
    expect(normalizePrompt({ slug: 'c' })?.name).toBe('c')
  })

  it('coerces versions from numbers or numeric strings, else undefined', () => {
    expect(normalizePrompt({ name: 'p', versions: [1, '2', 'x', 3] })?.versions).toEqual([1, 2, 3])
    expect(normalizePrompt({ name: 'p', versions: [] })?.versions).toBeUndefined()
    expect(normalizePrompt({ name: 'p' })?.versions).toBeUndefined()
  })

  it('reads type / labels / tags defensively', () => {
    const p = normalizePrompt({ name: 'p', kind: 'chat', labels: ['prod', ''], tags: ['a'] })
    expect(p?.type).toBe('chat')
    expect(p?.labels).toEqual(['prod'])
    expect(p?.tags).toEqual(['a'])
  })

  it('reads the updated timestamp from any of several field names', () => {
    expect(normalizePrompt({ name: 'p', updatedTime: '2026-01-01' })?.lastUpdatedAt).toBe('2026-01-01')
    expect(normalizePrompt({ name: 'p', updated_at: '2026-02-02' })?.lastUpdatedAt).toBe('2026-02-02')
  })
})

describe('normalizePrompts', () => {
  it('reads a bare array', () => {
    expect(normalizePrompts([{ name: 'a' }, { name: 'b' }]).map((p) => p.name)).toEqual(['a', 'b'])
  })

  it('reads the list from any common envelope key', () => {
    expect(normalizePrompts({ data: [{ name: 'a' }] }).map((p) => p.name)).toEqual(['a'])
    expect(normalizePrompts({ prompts: [{ name: 'b' }] }).map((p) => p.name)).toEqual(['b'])
    expect(normalizePrompts({ items: [{ name: 'c' }] }).map((p) => p.name)).toEqual(['c'])
    expect(normalizePrompts({ rows: [{ name: 'd' }] }).map((p) => p.name)).toEqual(['d'])
  })

  it('drops un-named rows and never throws on junk', () => {
    expect(normalizePrompts({ data: [{ name: 'a' }, {}, null, 5] }).map((p) => p.name)).toEqual(['a'])
    expect(normalizePrompts(null)).toEqual([])
    expect(normalizePrompts('nope')).toEqual([])
  })
})

describe('normalizeMetricRows', () => {
  it('keeps raw fields and assigns a stable __rowId', () => {
    const rows = normalizeMetricRows({ data: [{ name: 'p', count: 5 }, { id: 'x' }, {}] })
    expect(rows[0]).toMatchObject({ name: 'p', count: 5, __rowId: 'p' })
    expect(rows[1].__rowId).toBe('x')
    expect(rows[2].__rowId).toBe('metric-2')
  })

  it('reads from metrics / rows / a bare array too', () => {
    expect(normalizeMetricRows({ metrics: [{ name: 'a' }] })[0].__rowId).toBe('a')
    expect(normalizeMetricRows([{ name: 'b' }])[0].__rowId).toBe('b')
  })

  it('never throws on junk', () => {
    expect(normalizeMetricRows(null)).toEqual([])
    expect(normalizeMetricRows(42)).toEqual([])
  })
})

describe('normalizeCatalogEntry', () => {
  it('drops an entry with no name or no body', () => {
    expect(normalizeCatalogEntry({})).toBeNull()
    expect(normalizeCatalogEntry({ name: 'a' })).toBeNull()
    expect(normalizeCatalogEntry({ prompt: 'x' })).toBeNull()
  })

  it('reads the body from prompt, then content; defaults type to text', () => {
    expect(normalizeCatalogEntry({ name: 'a', prompt: 'hi' })).toEqual({
      name: 'a', prompt: 'hi', type: 'text', labels: undefined, tags: undefined,
    })
    expect(normalizeCatalogEntry({ name: 'b', content: 'yo', type: 'chat', tags: ['t'] })).toMatchObject({
      name: 'b', prompt: 'yo', type: 'chat', tags: ['t'],
    })
  })
})

describe('normalizeCatalog', () => {
  it('reads the data envelope and drops invalid entries', () => {
    const out = normalizeCatalog({ data: [{ name: 'a', prompt: 'x' }, { name: 'b' }, { prompt: 'y' }] })
    expect(out.map((e) => e.name)).toEqual(['a'])
  })

  it('never throws on junk', () => {
    expect(normalizeCatalog(null)).toEqual([])
    expect(normalizeCatalog(7)).toEqual([])
  })
})
