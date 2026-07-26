import { describe, expect, it } from 'vitest'

import { normalizePrefs } from './prefs'

describe('normalizePrefs', () => {
  it('unwraps the { prefs } envelope the server sends', () => {
    expect(normalizePrefs({ prefs: { theme: 'dark' }, updatedAt: 123 })).toEqual({ theme: 'dark' })
  })

  it('accepts a bare document, so the shape can be flattened later without a client change', () => {
    expect(normalizePrefs({ theme: 'dark' })).toEqual({ theme: 'dark' })
  })

  it('reads an empty document as "no preferences yet" — the first-run state', () => {
    expect(normalizePrefs({ prefs: {} })).toEqual({})
  })

  // A preference document is the LAST thing that should break a page: a missing
  // theme is cosmetic, a thrown render is not. Every malformed shape must read
  // as first-run rather than propagate.
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an array', ['theme']],
    ['a string', 'dark'],
    ['a number', 42],
    ['a null prefs field', { prefs: null }],
    ['an array prefs field', { prefs: ['theme'] }],
    ['a scalar prefs field', { prefs: 'dark' }],
  ])('reads %s as empty rather than throwing', (_label, input) => {
    expect(normalizePrefs(input)).toEqual({})
  })

  it('passes values through opaquely — the transport never interprets a preference', () => {
    const doc = { theme: 'dark', density: 3, pinned: ['a', 'b'], nav: { open: true } }
    expect(normalizePrefs({ prefs: doc })).toEqual(doc)
  })
})
