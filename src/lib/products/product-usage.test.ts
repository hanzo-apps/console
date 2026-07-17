import { describe, it, expect } from 'vitest'

import { inUseProductIds } from './product-usage'

const rec = (product: string) => ({ product })

describe('inUseProductIds', () => {
  it('collects the distinct product tags that have real usage', () => {
    const set = inUseProductIds([rec('agents'), rec('chat'), rec('agents'), rec('search')])
    expect([...set].sort()).toEqual(['agents', 'chat', 'search'])
  })

  it('drops untagged rows (empty / whitespace product) — never fabricates usage', () => {
    const set = inUseProductIds([rec(''), rec('   '), rec('functions')])
    expect([...set]).toEqual(['functions'])
  })

  it('trims surrounding whitespace on a tag', () => {
    const set = inUseProductIds([rec('  embeddings  ')])
    expect(set.has('embeddings')).toBe(true)
    expect(set.has('  embeddings  ')).toBe(false)
  })

  it('is empty for an org with no usage yet (honest-empty)', () => {
    expect(inUseProductIds([]).size).toBe(0)
  })

  it('does not depend on record order and does not mutate the input', () => {
    const input = [rec('b'), rec('a'), rec('b')]
    const set = inUseProductIds(input)
    expect([...set].sort()).toEqual(['a', 'b'])
    expect(input).toHaveLength(3)
  })
})
