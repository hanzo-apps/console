import { describe, expect, it } from 'vitest'

import { categoryIsOpen, toggleCategory, type CategoryOpen } from './nav-accordion'

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

describe('toggleCategory', () => {
  it('opens an untouched (default-collapsed) category on first toggle', () => {
    expect(toggleCategory({}, 'AI')).toEqual({ AI: true })
  })

  it('flips an explicit choice both ways', () => {
    expect(toggleCategory({ AI: true }, 'AI')).toEqual({ AI: false })
    expect(toggleCategory({ AI: false }, 'AI')).toEqual({ AI: true })
  })

  it('leaves every OTHER category untouched (does not clobber other choices)', () => {
    expect(toggleCategory({ Data: true, Web3: false }, 'AI')).toEqual({
      Data: true,
      Web3: false,
      AI: true,
    })
  })

  it('is immutable — never mutates the input state', () => {
    const stored: CategoryOpen = { AI: true }
    const next = toggleCategory(stored, 'AI')
    expect(stored).toEqual({ AI: true })
    expect(next).not.toBe(stored)
  })

  it('round-trips: toggle twice returns to the original effective state', () => {
    const once = toggleCategory({}, 'Observe')
    const twice = toggleCategory(once, 'Observe')
    expect(twice.Observe).toBe(false)
  })
})
