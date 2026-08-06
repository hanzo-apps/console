import { describe, expect, it } from 'vitest'

import { categoryIsOpen, toggleCategory, type CategoryOpen } from './nav-accordion'

const ctx = (filtering = false) => ({ filtering })

describe('categoryIsOpen (expand-by-default)', () => {
  it('defaults to EXPANDED for an untouched category (nothing auto-collapses)', () => {
    expect(categoryIsOpen({}, 'AI', ctx())).toBe(true)
    expect(categoryIsOpen({}, 'Observe', ctx())).toBe(true)
    expect(categoryIsOpen({ Data: false }, 'AI', ctx())).toBe(true) // untouched section stays open
  })

  it('respects an explicit COLLAPSE, and stays where the user left it', () => {
    expect(categoryIsOpen({ Observe: false }, 'Observe', ctx())).toBe(false)
    // a re-opened section (explicit true) stays open
    expect(categoryIsOpen({ Observe: true }, 'Observe', ctx())).toBe(true)
  })

  it('each section is INDEPENDENT — collapsing one leaves the others expanded', () => {
    const stored: CategoryOpen = { Observe: false }
    expect(categoryIsOpen(stored, 'Observe', ctx())).toBe(false)
    expect(categoryIsOpen(stored, 'AI', ctx())).toBe(true)
    expect(categoryIsOpen(stored, 'Platform', ctx())).toBe(true)
  })

  it('opens every group while filtering, so a search match is never hidden', () => {
    expect(categoryIsOpen({ AI: false }, 'AI', ctx(true))).toBe(true)
    expect(categoryIsOpen({ Observe: false }, 'Observe', ctx(true))).toBe(true)
  })

  it('restores the stored/default state once filtering clears', () => {
    const stored: CategoryOpen = { AI: false, Data: true }
    expect(categoryIsOpen(stored, 'AI', ctx(false))).toBe(false)
    expect(categoryIsOpen(stored, 'Data', ctx(false))).toBe(true)
    expect(categoryIsOpen(stored, 'Compute', ctx(false))).toBe(true) // untouched → open
  })

  // The current product's section holds the level-2 nav (its own pages, nested under
  // its row), and the content strip that carries level 2 below `lg` is hidden at
  // `lg+` — so honoring a collapse here would strand the user inside a product with
  // no way to reach its pages. Every OTHER section still obeys the stored choice.
  it('keeps the ACTIVE product’s category open even when the user collapsed it', () => {
    const stored: CategoryOpen = { AI: false, Observe: false }
    expect(categoryIsOpen(stored, 'AI', { filtering: false, activeCategory: 'AI' })).toBe(true)
    expect(categoryIsOpen(stored, 'Observe', { filtering: false, activeCategory: 'AI' })).toBe(false)
  })

  it('does not force anything open when no product is active', () => {
    const stored: CategoryOpen = { AI: false }
    expect(categoryIsOpen(stored, 'AI', { filtering: false, activeCategory: null })).toBe(false)
    expect(categoryIsOpen(stored, 'AI', { filtering: false, activeCategory: undefined })).toBe(false)
  })
})

describe('toggleCategory (independent per-section)', () => {
  it('collapses a default-open (untouched) category on first toggle', () => {
    expect(toggleCategory({}, 'AI')).toEqual({ AI: false })
  })

  it('re-opens an explicitly-collapsed category', () => {
    expect(toggleCategory({ AI: false }, 'AI')).toEqual({ AI: true })
  })

  it('round-trips: toggling twice returns to the default-open state (stored true)', () => {
    const once = toggleCategory({}, 'Observe')
    expect(once).toEqual({ Observe: false })
    const twice = toggleCategory(once, 'Observe')
    expect(twice).toEqual({ Observe: true })
    expect(categoryIsOpen(twice, 'Observe', ctx())).toBe(true)
  })

  it('NEVER touches other sections (independent — not single-open)', () => {
    // collapsing AI leaves an already-collapsed Observe collapsed and everything else default-open
    expect(toggleCategory({ Observe: false }, 'AI')).toEqual({ Observe: false, AI: false })
    // opening a second section does NOT collapse the first (the old single-open invariant is gone)
    expect(toggleCategory({ Observe: false, Data: false }, 'AI')).toEqual({ Observe: false, Data: false, AI: false })
  })

  it('is immutable — never mutates the input state', () => {
    const stored: CategoryOpen = { AI: false }
    const next = toggleCategory(stored, 'AI')
    expect(stored).toEqual({ AI: false })
    expect(next).not.toBe(stored)
  })
})
