import { describe, it, expect } from 'vitest'
import { changeQuery, listQuery, watching } from './client'

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

describe('changeQuery — the ONE change-feed querystring (poll AND stream)', () => {
  it('is empty for no query', () => {
    expect(changeQuery()).toBe('')
    expect(changeQuery({})).toBe('')
  })

  it('joins doctypes and modules, and passes since + limit', () => {
    const p = new URLSearchParams(
      changeQuery({ doctypes: ['Ticket', 'HD Team'], modules: ['help'], since: 42, limit: 10 }).replace(/^\?/, ''),
    )
    expect(p.get('doctypes')).toBe('Ticket,HD Team')
    expect(p.get('modules')).toBe('help')
    expect(p.get('since')).toBe('42')
    expect(p.get('limit')).toBe('10')
  })

  it('carries no org — the tenant is server-derived from the bearer, never sent', () => {
    const qs = changeQuery({ doctypes: ['Ticket'], since: 1, watching: 'Ticket/TKT-1' })
    expect(qs).not.toMatch(/org/i)
    expect(qs).not.toMatch(/tenant/i)
  })

  it('omits since=0 so a fresh subscriber streams from NOW, not from history', () => {
    expect(changeQuery({ since: 0 })).toBe('')
  })
})

describe('watching — how a document is named to the live surface', () => {
  it('is <DocType>/<name>', () => {
    expect(watching('Ticket', 'TKT-00001')).toBe('Ticket/TKT-00001')
  })

  it('is the DocType alone for a Single, which has exactly one document', () => {
    expect(watching('Support Settings')).toBe('Support Settings')
  })
})
