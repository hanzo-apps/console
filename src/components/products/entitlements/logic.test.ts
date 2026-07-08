import { describe, it, expect } from 'vitest'

import { entitlementRows, togglePatch, enabledCount } from './logic'

const entries = [
  { id: 'overview' }, // always-on
  { id: 'billing' }, // always-on
  { id: 'agents' },
  { id: 'vector' },
]

describe('entitlementRows', () => {
  it('marks always-on rows enabled + locked regardless of the set', () => {
    const rows = entitlementRows(entries, [])
    const overview = rows.find((r) => r.entry.id === 'overview')!
    expect(overview.enabled).toBe(true)
    expect(overview.locked).toBe(true)
  })

  it('marks an enabled product on, an unlisted one off (both unlocked)', () => {
    const rows = entitlementRows(entries, ['agents'])
    expect(rows.find((r) => r.entry.id === 'agents')).toMatchObject({ enabled: true, locked: false })
    expect(rows.find((r) => r.entry.id === 'vector')).toMatchObject({ enabled: false, locked: false })
  })
})

describe('togglePatch', () => {
  it('adds a currently-off product', () => {
    expect(togglePatch('agents', false)).toEqual({ add: ['agents'] })
  })
  it('removes a currently-on product', () => {
    expect(togglePatch('agents', true)).toEqual({ remove: ['agents'] })
  })
  it('is a no-op for an always-on essential (never disablable)', () => {
    expect(togglePatch('billing', true)).toEqual({})
    expect(togglePatch('overview', false)).toEqual({})
  })
})

describe('enabledCount — extras beyond the essentials', () => {
  it('counts only non-always-on ids', () => {
    expect(enabledCount(['agents', 'vector'])).toBe(2)
    expect(enabledCount(['billing', 'agents'])).toBe(1)
    expect(enabledCount([])).toBe(0)
  })
})
