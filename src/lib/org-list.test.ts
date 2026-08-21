import { describe, it, expect } from 'vitest'

import {
  ORG_PAGE_SIZE,
  orgKey,
  tierOf,
  orgQuery,
  mergeOrgs,
  pageIsFull,
  rowFor,
  orgRows,
} from './org-list'
import type { Organization } from '~/lib/api'

const org = (name: string, extra: Partial<Organization> = {}): Organization => ({
  owner: 'admin',
  name,
  ...extra,
})

describe('orgQuery (server-side pagination)', () => {
  it('pages 0-based → 1-based, owned by admin', () => {
    expect(orgQuery(0, '')).toEqual({
      owner: 'admin',
      page: 1,
      pageSize: ORG_PAGE_SIZE,
    })
    expect(orgQuery(3, '').page).toBe(4)
  })

  /**
   * IAM's org list takes an owner and a window and nothing else. A term sent at it
   * would be ignored, and the caller would read a full page as a narrowed one —
   * which is why the term is dropped here and `orgRows` narrows what has loaded.
   */
  it('never sends a search term, a filter field, or a sort key', () => {
    for (const q of ['', '   ', '  acme ']) {
      const params = orgQuery(0, q)
      expect(params.field).toBeUndefined()
      expect(params.value).toBeUndefined()
      expect(params.sortField).toBeUndefined()
      expect(params.sortOrder).toBeUndefined()
    }
  })

  it('honors a caller pageSize', () => {
    expect(orgQuery(0, '', 5).pageSize).toBe(5)
  })
})

describe('mergeOrgs (dedupe by owner/name, preserve order)', () => {
  it('appends new rows and skips duplicates', () => {
    const a = [org('one'), org('two')]
    const b = [org('two'), org('three')]
    expect(mergeOrgs(a, b).map((o) => o.name)).toEqual(['one', 'two', 'three'])
  })

  it('is a no-op when nothing new arrives', () => {
    const a = [org('one')]
    expect(mergeOrgs(a, [org('one')]).map((o) => o.name)).toEqual(['one'])
  })

  it('keys on owner AND name (same name, different owner is distinct)', () => {
    const a = [{ owner: 'admin', name: 'x' } as Organization]
    const b = [{ owner: 'other', name: 'x' } as Organization]
    expect(mergeOrgs(a, b)).toHaveLength(2)
    expect(orgKey(a[0])).toBe('admin/x')
  })
})

describe('pageIsFull (more-pages signal, no total needed)', () => {
  it('a full page implies there may be more', () => {
    expect(pageIsFull(ORG_PAGE_SIZE)).toBe(true)
    expect(pageIsFull(5, 5)).toBe(true)
  })
  it('a short or empty page is the end', () => {
    expect(pageIsFull(ORG_PAGE_SIZE - 1)).toBe(false)
    expect(pageIsFull(0)).toBe(false)
  })
})

describe('tierOf (honest plan badge — present-only, never fabricated)', () => {
  it('returns null when the org carries no tier/plan', () => {
    expect(tierOf(org('acme'))).toBeNull()
  })
  it('reads a `tier` string field', () => {
    expect(tierOf(org('a', { tier: 'enterprise' }))).toEqual({ label: 'Enterprise', tone: 'enterprise' })
  })
  it('reads a `plan` string and a nested `plan.name`', () => {
    expect(tierOf(org('a', { plan: 'pro' }))?.tone).toBe('pro')
    expect(tierOf(org('a', { plan: { name: 'Hobby' } }))?.tone).toBe('hobby')
  })
  it('reads a plan tag from `tags`', () => {
    expect(tierOf(org('a', { tags: ['region:us', 'Business'] }))?.tone).toBe('enterprise')
  })
  it('maps known aliases and ignores unknown values', () => {
    expect(tierOf(org('a', { plan: 'free' }))?.tone).toBe('hobby')
    expect(tierOf(org('a', { plan: 'team' }))?.tone).toBe('pro')
    expect(tierOf(org('a', { plan: 'platinum' }))).toBeNull()
    expect(tierOf(org('a', { tier: 42 as unknown as string }))).toBeNull()
  })
})

describe('rowFor / orgRows (view-model + client-filter)', () => {
  it('derives title, initials, logo, and tier for a row', () => {
    const r = rowFor(org('ad-nexus', { displayName: 'Ad Nexus', logo: 'https://x/y.png', tier: 'pro' }))
    expect(r).toMatchObject({
      key: 'admin/ad-nexus',
      name: 'ad-nexus',
      title: 'Ad Nexus',
      initials: 'AN',
      logo: 'https://x/y.png',
    })
    expect(r.tier?.tone).toBe('pro')
  })

  it('client-filters accumulated rows over name AND displayName', () => {
    const orgs = [
      org('hanzo', { displayName: 'Hanzo' }),
      org('adnexus', { displayName: 'Ad Nexus' }),
      org('lux', { displayName: 'Lux Network' }),
    ]
    // matches the slug
    expect(orgRows(orgs, 'adn').map((r) => r.name)).toEqual(['adnexus'])
    // matches the display name only
    expect(orgRows(orgs, 'network').map((r) => r.name)).toEqual(['lux'])
    // empty query → everything, mapped to rows
    expect(orgRows(orgs, '')).toHaveLength(3)
  })
})
