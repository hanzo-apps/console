import { describe, expect, it } from 'vitest'

import { categoryIsOpen, openChoice, toggleCategory, type CategoryOpen } from './nav-accordion'

const ctx = (activeCategory: string | null, filtering = false) => ({ activeCategory, filtering })

describe('categoryIsOpen', () => {
  it('defaults to COLLAPSED for an untouched, non-active category (the tidy default)', () => {
    expect(categoryIsOpen({}, 'AI', ctx(null))).toBe(false)
    expect(categoryIsOpen({ Data: true }, 'AI', ctx('Data'))).toBe(false)
  })

  it('respects a stored explicit choice when not active / not filtering', () => {
    expect(categoryIsOpen({ AI: true }, 'AI', ctx(null))).toBe(true)
    expect(categoryIsOpen({ AI: false }, 'AI', ctx('Data'))).toBe(false)
  })

  it('ALWAYS opens the active route category — even if the user had collapsed it', () => {
    // navigating to a page reveals its category (req 4)
    expect(categoryIsOpen({ AI: false }, 'AI', ctx('AI'))).toBe(true)
    expect(categoryIsOpen({}, 'AI', ctx('AI'))).toBe(true)
  })

  it('opens every group while filtering, so a search match is never hidden (req 5)', () => {
    expect(categoryIsOpen({ AI: false }, 'AI', ctx('Data', true))).toBe(true)
    expect(categoryIsOpen({}, 'Web3', ctx(null, true))).toBe(true)
  })

  it('restores the stored/default collapse state once filtering clears', () => {
    const stored: CategoryOpen = { AI: false, Data: true }
    expect(categoryIsOpen(stored, 'AI', ctx(null, false))).toBe(false)
    expect(categoryIsOpen(stored, 'Data', ctx(null, false))).toBe(true)
    expect(categoryIsOpen(stored, 'Compute', ctx(null, false))).toBe(false)
  })
})

describe('toggleCategory (single-open)', () => {
  it('opens an untouched (default-collapsed) category on first toggle', () => {
    expect(toggleCategory({}, 'AI')).toEqual({ AI: true })
  })

  it('closes the currently-open category (clears the choice → falls back to active)', () => {
    expect(toggleCategory({ AI: true }, 'AI')).toEqual({})
    // an explicit-false (legacy) entry is not "open", so toggling opens it
    expect(toggleCategory({ AI: false }, 'AI')).toEqual({ AI: true })
  })

  it('opening a category COLLAPSES whatever was open (only ONE at a time)', () => {
    // Data was open; opening AI collapses Data — exactly one true key remains
    expect(toggleCategory({ Data: true }, 'AI')).toEqual({ AI: true })
    expect(toggleCategory({ Data: true, Web3: false }, 'AI')).toEqual({ AI: true })
  })

  it('is immutable — never mutates the input state', () => {
    const stored: CategoryOpen = { AI: true }
    const next = toggleCategory(stored, 'AI')
    expect(stored).toEqual({ AI: true })
    expect(next).not.toBe(stored)
  })

  it('round-trips: opening then toggling the same category clears the choice', () => {
    const once = toggleCategory({}, 'Observe')
    expect(once).toEqual({ Observe: true })
    const twice = toggleCategory(once, 'Observe')
    expect(openChoice(twice)).toBe(null)
  })

  it('never leaves two categories expanded (the single-open invariant)', () => {
    // whatever the prior state, opening a category yields at most one true key
    const next = toggleCategory({ Data: true, AI: true }, 'Web3')
    expect(Object.values(next).filter(Boolean)).toHaveLength(1)
    expect(next).toEqual({ Web3: true })
  })
})
