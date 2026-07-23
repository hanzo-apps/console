import { describe, it, expect, afterEach } from 'vitest'

import { isGuideDismissed, dismissGuide, resetGuide } from './guard'

/** A Map-backed localStorage so set/get round-trips (real browser semantics). */
function stubWindow(): void {
  const store = new Map<string, string>()
  ;(globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, val: string) => void store.set(k, val),
      removeItem: (k: string) => void store.delete(k),
    },
  }
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window
})

describe('guide dismissal guard (versioned, owner+product-keyed, SSR-safe)', () => {
  it('undismissed → dismiss → dismissed → reset → undismissed', () => {
    stubWindow()
    expect(isGuideDismissed('o', 'models')).toBe(false)
    dismissGuide('o', 'models')
    expect(isGuideDismissed('o', 'models')).toBe(true)
    resetGuide('o', 'models')
    expect(isGuideDismissed('o', 'models')).toBe(false)
  })

  it('is scoped per owner AND per product (no cross-leak)', () => {
    stubWindow()
    dismissGuide('o1', 'models')
    expect(isGuideDismissed('o1', 'models')).toBe(true)
    expect(isGuideDismissed('o2', 'models')).toBe(false)
    expect(isGuideDismissed('o1', 'chat')).toBe(false)
  })

  it('is safe on the server (no window) — false, no throw', () => {
    expect(isGuideDismissed('o', 'models')).toBe(false)
    expect(() => dismissGuide('o', 'models')).not.toThrow()
    expect(() => resetGuide('o', 'models')).not.toThrow()
  })

  it('ignores empty owner or id', () => {
    stubWindow()
    dismissGuide('', 'models')
    dismissGuide('o', '')
    expect(isGuideDismissed('', 'models')).toBe(false)
    expect(isGuideDismissed('o', '')).toBe(false)
  })
})
