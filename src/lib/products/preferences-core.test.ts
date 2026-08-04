import { describe, expect, it } from 'vitest'

import { cacheIsNewer, mergePrefs, parsePrefs } from './preferences-core'

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

describe('ordering — a snapshot must not out-rank a newer confirmed write', () => {
  const MINTED = 1_700_000_000 // seconds
  const BEFORE = (MINTED - 60) * 1000
  const AFTER = (MINTED + 60) * 1000

  it('cacheIsNewer only when a CONFIRMED write landed after the token was minted', () => {
    expect(cacheIsNewer({ tokenIssuedAt: MINTED, cacheWrittenAt: AFTER })).toBe(true)
    expect(cacheIsNewer({ tokenIssuedAt: MINTED, cacheWrittenAt: BEFORE })).toBe(false)
    // No confirmed write — an optimistic paint the server never acknowledged earns
    // nothing, which is what keeps this from being localStorage pretending to be a
    // backend.
    expect(cacheIsNewer({ tokenIssuedAt: MINTED })).toBe(false)
    expect(cacheIsNewer(undefined)).toBe(false)
    // Unknown token age + a real write: we can prove the write, not the snapshot.
    expect(cacheIsNewer({ cacheWrittenAt: AFTER })).toBe(true)
  })

  it('a pin made AFTER sign-in survives the token snapshot that predates it', () => {
    // The production shape of the bug: once anything has been saved, the next token
    // carries a snapshot of the document as it stood then — and letting that win
    // silently discarded everything pinned since.
    const snapshot = { pins: [{ id: 'models', group: '' }] }
    const afterPinning = { pins: [{ id: 'models', group: '' }, { id: 'agents', group: '' }] }
    const merged = mergePrefs(afterPinning, snapshot, { tokenIssuedAt: MINTED, cacheWrittenAt: AFTER })
    expect(merged.pins).toEqual(afterPinning.pins)
  })

  it('a fresh sign-in still picks up what another device saved', () => {
    // Token minted AFTER the local write → the snapshot already contains it and may
    // contain more, so the account is authoritative again. Cross-device is preserved.
    const local = { pins: [{ id: 'agents', group: '' }] }
    const snapshot = { pins: [{ id: 'agents', group: '' }, { id: 'vector', group: '' }] }
    const merged = mergePrefs(local, snapshot, { tokenIssuedAt: MINTED, cacheWrittenAt: BEFORE })
    expect(merged.pins).toEqual(snapshot.pins)
  })

  it('a new device (empty cache, no stamp) takes the account wholesale', () => {
    const snapshot = { pins: [{ id: 'agents', group: '' }], productColors: { agents: 'iris' } }
    expect(mergePrefs({}, snapshot, { tokenIssuedAt: MINTED })).toEqual(snapshot)
  })

  it('keys the snapshot is silent about survive either way', () => {
    const cached = { 'list.models': { q: 'zen' } }
    for (const order of [
      { tokenIssuedAt: MINTED, cacheWrittenAt: AFTER },
      { tokenIssuedAt: MINTED, cacheWrittenAt: BEFORE },
    ]) {
      expect(mergePrefs(cached, { theme: 'dark' }, order)).toEqual({ ...cached, theme: 'dark' })
    }
  })
})
