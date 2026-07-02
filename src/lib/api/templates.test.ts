import { describe, it, expect } from 'vitest'

import { normalizeTemplate, normalizeTemplates, groupByCategory } from './templates'

describe('normalizeTemplate', () => {
  it('drops a record with no slug/id or no title', () => {
    expect(normalizeTemplate({})).toBeNull()
    expect(normalizeTemplate({ slug: 'a' })).toBeNull()
    expect(normalizeTemplate({ title: 'A' })).toBeNull()
  })

  it('reads slug from slug|id and title from title|displayName|name', () => {
    expect(normalizeTemplate({ id: 'x', name: 'X' })).toMatchObject({ slug: 'x', title: 'X' })
    expect(normalizeTemplate({ slug: 'y', displayName: 'Y' })).toMatchObject({ slug: 'y', title: 'Y' })
  })

  it('defaults category to App and features to [], coerces numbers', () => {
    const t = normalizeTemplate({ slug: 's', title: 'S', tier: 1, rating: 5 })
    expect(t).toMatchObject({ category: 'App', features: [], tier: 1, rating: 5 })
  })

  it('keeps only string features and passes through handoff urls', () => {
    const t = normalizeTemplate({ slug: 's', title: 'S', features: ['a', 2, ''], source: 'u', preview: 'p' })
    expect(t?.features).toEqual(['a', '2'])
    expect(t).toMatchObject({ source: 'u', preview: 'p' })
  })
})

describe('normalizeTemplates', () => {
  it('reads the data envelope and drops invalid rows', () => {
    const out = normalizeTemplates({ data: [{ slug: 'a', title: 'A' }, { slug: 'b' }] })
    expect(out.map((t) => t.slug)).toEqual(['a'])
  })

  it('reads a bare array and never throws on junk', () => {
    expect(normalizeTemplates([{ slug: 'a', title: 'A' }]).length).toBe(1)
    expect(normalizeTemplates(null)).toEqual([])
    expect(normalizeTemplates(9)).toEqual([])
  })
})

describe('groupByCategory', () => {
  it('groups by category, categories alphabetized, order preserved within', () => {
    const ts = normalizeTemplates([
      { slug: 'a', title: 'A', category: 'SaaS' },
      { slug: 'b', title: 'B', category: 'App' },
      { slug: 'c', title: 'C', category: 'SaaS' },
    ])
    const groups = groupByCategory(ts)
    expect(groups.map(([c]) => c)).toEqual(['App', 'SaaS'])
    expect(groups[1][1].map((t) => t.slug)).toEqual(['a', 'c'])
  })
})
