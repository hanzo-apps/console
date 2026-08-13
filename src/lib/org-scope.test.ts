import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import {
  currentOrg,
  setCurrentOrg,
  isScopedAway,
  filterOrgs,
  hasSelectedOrg,
  enterOrg,
  leaveOrg,
  switchOrg,
} from './org-scope'

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

describe('two-level selection (picker → scoped console → back)', () => {
  let store: ReturnType<typeof fakeStorage>
  let assign: ReturnType<typeof vi.fn>
  beforeEach(() => {
    store = fakeStorage()
    assign = vi.fn()
    ;(globalThis as { window?: unknown }).window = {
      location: { origin: 'https://console.hanzo.ai', hostname: 'console.hanzo.ai', assign },
      localStorage: store,
    }
  })
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window
  })

  it('a fresh session has NO org selected (picker lands even for one org)', () => {
    // Even with a stored org value, selection is a separate concern.
    setCurrentOrg('adnexus')
    expect(hasSelectedOrg()).toBe(false)
  })

  it('entering an org sets the scope, marks it selected, and navigates home', () => {
    enterOrg('adnexus')
    expect(currentOrg()).toBe('adnexus')
    expect(hasSelectedOrg()).toBe(true)
    expect(assign).toHaveBeenCalledWith('/')
  })

  it('leaving de-scopes to the brand org, clears selection, and navigates home', () => {
    enterOrg('adnexus')
    assign.mockClear()
    leaveOrg()
    expect(hasSelectedOrg()).toBe(false)
    expect(currentOrg()).toBe('hanzo')
    expect(isScopedAway()).toBe(false)
    expect(assign).toHaveBeenCalledWith('/')
  })

  it('entering the brand org still counts as selected (one-org brand user)', () => {
    enterOrg('hanzo')
    expect(currentOrg()).toBe('hanzo')
    expect(hasSelectedOrg()).toBe(true)
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

describe('the reserved admin org is a host, not a scope', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // These functions guard on `typeof window`, so the suite runs without one.
  // The hand-off is a navigation, which only exists when there IS a window.
  function onHost(host: string) {
    const assign = vi.fn()
    const reload = vi.fn()
    vi.stubGlobal('window', {
      location: { host, hostname: host, origin: `https://${host}`, href: `https://${host}/`, assign, reload },
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    })
    return { assign, reload }
  }

  // Stamping X-Org-Id: admin on a brand host asks the API to act as an org this
  // session was never issued for — the token's owner is the brand, and no header
  // rewrites that. The switch would look like it worked and every read refuse.
  it('picking admin from a brand host goes to the admin console', () => {
    const { assign } = onHost('console.hanzo.ai')
    switchOrg('admin')
    expect(assign).toHaveBeenCalledWith('https://admin.hanzo.ai')
  })

  it('the same holds for the enter-an-org card', () => {
    const { assign } = onHost('cloud.hanzo.ai')
    enterOrg('admin')
    expect(assign).toHaveBeenCalledWith('https://admin.hanzo.ai')
  })

  // On the admin console there is nowhere to hand off TO, so it is an ordinary switch.
  it('on the admin console it is a normal switch', () => {
    const { assign } = onHost('admin.hanzo.ai')
    switchOrg('admin')
    expect(assign).not.toHaveBeenCalled()
  })

  // One clause, for one reserved name — every other org is untouched.
  it('an ordinary org still switches in place', () => {
    const { assign, reload } = onHost('console.hanzo.ai')
    switchOrg('lux')
    expect(assign).not.toHaveBeenCalled()
    expect(reload).toHaveBeenCalled() // an ordinary switch reloads in place
  })
})
