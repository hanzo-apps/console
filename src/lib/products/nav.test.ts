import { describe, expect, it } from 'vitest'

import { categoryIsOpen, toggleCategory, type CategoryOpen } from './nav'

describe('categoryIsOpen (expand-by-default)', () => {
  it('defaults to EXPANDED for an untouched category (nothing auto-collapses)', () => {
    expect(categoryIsOpen({}, 'AI')).toBe(true)
    expect(categoryIsOpen({}, 'Observe')).toBe(true)
    expect(categoryIsOpen({ Data: false }, 'AI')).toBe(true) // untouched section stays open
  })

  it('respects an explicit COLLAPSE, and stays where the user left it', () => {
    expect(categoryIsOpen({ Observe: false }, 'Observe')).toBe(false)
    // a re-opened section (explicit true) stays open
    expect(categoryIsOpen({ Observe: true }, 'Observe')).toBe(true)
  })

  it('each section is INDEPENDENT — collapsing one leaves the others expanded', () => {
    const stored: CategoryOpen = { Observe: false }
    expect(categoryIsOpen(stored, 'Observe')).toBe(false)
    expect(categoryIsOpen(stored, 'AI')).toBe(true)
    expect(categoryIsOpen(stored, 'Platform')).toBe(true)
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
    expect(categoryIsOpen(twice, 'Observe')).toBe(true)
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
