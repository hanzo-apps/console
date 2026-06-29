import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { currentOrg, setCurrentOrg, isScopedAway, filterOrgs } from './org-scope'

/** A minimal in-memory localStorage, enough for the org-scope store. */
function fakeStorage() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    get size() {
      return m.size
    },
  }
}

describe('org-scope store (default brand org → switch → reset)', () => {
  let store: ReturnType<typeof fakeStorage>
  beforeEach(() => {
    store = fakeStorage()
    ;(globalThis as { window?: unknown }).window = {
      location: { origin: 'https://console.hanzo.ai', hostname: 'console.hanzo.ai' },
      localStorage: store,
    }
  })
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window
  })

  it('defaults to the brand org (hanzo) with nothing stored', () => {
    expect(currentOrg()).toBe('hanzo')
    expect(isScopedAway()).toBe(false)
  })

  it('switches to another org and persists it', () => {
    setCurrentOrg('adnexus')
    expect(currentOrg()).toBe('adnexus')
    expect(isScopedAway()).toBe(true)
    expect(store.size).toBe(1)
  })

  it('clears the override when switching back to the brand org', () => {
    setCurrentOrg('adnexus')
    setCurrentOrg('hanzo')
    expect(currentOrg()).toBe('hanzo')
    expect(isScopedAway()).toBe(false)
    expect(store.size).toBe(0)
  })
})

describe('org filter (the switcher search box)', () => {
  const orgs = [
    { name: 'hanzo', displayName: 'Hanzo' },
    { name: 'adnexus', displayName: 'Ad Nexus' },
    { name: 'lux', displayName: 'Lux Network' },
  ]
  it('returns everything for an empty query', () => {
    expect(filterOrgs(orgs, '')).toHaveLength(3)
    expect(filterOrgs(orgs, '   ')).toHaveLength(3)
  })
  it('matches the org name case-insensitively', () => {
    expect(filterOrgs(orgs, 'AD').map((o) => o.name)).toEqual(['adnexus'])
  })
  it('matches the display name', () => {
    expect(filterOrgs(orgs, 'network').map((o) => o.name)).toEqual(['lux'])
  })
  it('returns nothing when no org matches', () => {
    expect(filterOrgs(orgs, 'zzz')).toHaveLength(0)
  })
})
