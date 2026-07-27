import { describe, expect, it } from 'vitest'

import { mergePrefs, parsePrefs } from './preferences-core'

describe('parsePrefs — a corrupt cache degrades, never throws', () => {
  it('reads a stored object', () => {
    expect(parsePrefs('{"pins":[{"id":"agents","group":""}]}')).toEqual({ pins: [{ id: 'agents', group: '' }] })
  })

  it('treats absent, malformed and non-object blobs as no customizations', () => {
    for (const bad of [undefined, null, '', 'not json', '[]', '"a string"', '42']) {
      expect(() => parsePrefs(bad)).not.toThrow()
      expect(parsePrefs(bad)).toEqual({})
    }
  })
})

describe('mergePrefs — the reconciliation that decides whether a pin survives a reload', () => {
  it('lets the account win for a key it CARRIES', () => {
    const merged = mergePrefs({ pins: ['stale'] }, { pins: ['fresh'] })
    expect(merged.pins).toEqual(['fresh'])
  })

  it('keeps a cached key the account is silent about — the regression that lost pins', () => {
    // Measured in a browser before this fix: pin a product, reload, and the pin was
    // gone. The account's claims ride an access token minted BEFORE the pin existed,
    // so `pins` is absent from it — and treating that absence as "you have no pins"
    // overwrote the cache with {} on every load.
    const cached = { pins: [{ id: 'agents', group: '' }], productColors: { agents: 'iris' } }
    const merged = mergePrefs(cached, { 'guide.used': { overview: true } })
    expect(merged.pins).toEqual(cached.pins)
    expect(merged.productColors).toEqual(cached.productColors)
    expect(merged['guide.used']).toEqual({ overview: true })
  })

  it('an account with nothing to say erases nothing', () => {
    const cached = { pins: ['a'], 'list.models': { q: 'zen' } }
    expect(mergePrefs(cached, {})).toEqual(cached)
  })

  it('is idempotent, so re-running it on each account change cannot drift', () => {
    const cached = { pins: ['a'] }
    const account = { theme: 'dark' }
    const once = mergePrefs(cached, account)
    expect(mergePrefs(once, account)).toEqual(once)
  })

  it('mutates neither input', () => {
    const cached = { a: 1 }
    const account = { b: 2 }
    mergePrefs(cached, account)
    expect(cached).toEqual({ a: 1 })
    expect(account).toEqual({ b: 2 })
  })
})
