import { describe, it, expect } from 'vitest'
import { listQuery } from './client'

describe('listQuery — the generic document list querystring', () => {
  it('is empty for no query', () => {
    expect(listQuery()).toBe('')
    expect(listQuery({})).toBe('')
  })

  it('encodes filters as a JSON object (the engine contract)', () => {
    const qs = listQuery({ filters: { status: 'Published' } })
    expect(qs).toContain('filters=')
    // the value is JSON, URL-encoded
    expect(decodeURIComponent(qs)).toContain('filters={"status":"Published"}')
  })

  it('joins fields and passes order_by + limit', () => {
    const qs = listQuery({ fields: ['title', 'slug'], orderBy: 'updatedAt desc', limit: 50 })
    const p = new URLSearchParams(qs.replace(/^\?/, ''))
    expect(p.get('fields')).toBe('title,slug')
    expect(p.get('order_by')).toBe('updatedAt desc')
    expect(p.get('limit')).toBe('50')
  })

  it('omits an empty filters object', () => {
    expect(listQuery({ filters: {} })).toBe('')
  })
})
