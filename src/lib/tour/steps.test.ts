import { describe, it, expect, afterEach } from 'vitest'

import {
  CONSOLE_TOUR,
  clampIndex,
  nextIndex,
  prevIndex,
  isLast,
  hasSeenTour,
  markTourSeen,
  resetTour,
  TOUR_VERSION,
} from './steps'

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

describe('tour steps — content', () => {
  it('has honest steps and the two on-page anchors', () => {
    expect(CONSOLE_TOUR.length).toBeGreaterThanOrEqual(4)
    const ids = CONSOLE_TOUR.map((s) => s.id)
    expect(ids).toContain('nav')
    expect(ids).toContain('api-key')
    expect(ids).toContain('metrics')
    // Every step has a title + body; a targeted step uses the data-tour convention.
    for (const s of CONSOLE_TOUR) {
      expect(s.title.length).toBeGreaterThan(0)
      expect(s.body.length).toBeGreaterThan(0)
      if (s.target) expect(s.target).toMatch(/^\[data-tour="[a-z-]+"\]$/)
    }
  })
})

describe('tour index helpers', () => {
  const len = CONSOLE_TOUR.length

  it('clampIndex bounds into range and tolerates garbage', () => {
    expect(clampIndex(-3, len)).toBe(0)
    expect(clampIndex(0, len)).toBe(0)
    expect(clampIndex(len + 9, len)).toBe(len - 1)
    expect(clampIndex(2.7, len)).toBe(2)
    expect(clampIndex(NaN, len)).toBe(0)
    expect(clampIndex(0, 0)).toBe(0)
  })

  it('nextIndex advances but clamps at the last step', () => {
    expect(nextIndex(0, len)).toBe(1)
    expect(nextIndex(len - 1, len)).toBe(len - 1)
  })

  it('prevIndex retreats but clamps at 0', () => {
    expect(prevIndex(3)).toBe(2)
    expect(prevIndex(0)).toBe(0)
    expect(prevIndex(-5)).toBe(0)
  })

  it('isLast is true only on the final step', () => {
    expect(isLast(0, len)).toBe(false)
    expect(isLast(len - 1, len)).toBe(true)
    expect(isLast(0, 0)).toBe(false)
  })
})

describe('tour seen-guard (versioned, owner-keyed, SSR-safe)', () => {
  it('is unseen → mark → seen → reset → unseen', () => {
    stubWindow()
    const owner = 'hanzo/z'
    expect(hasSeenTour(owner)).toBe(false)
    markTourSeen(owner)
    expect(hasSeenTour(owner)).toBe(true)
    resetTour(owner)
    expect(hasSeenTour(owner)).toBe(false)
  })

  it('is per-account (one owner marked does not mark another)', () => {
    stubWindow()
    markTourSeen('hanzo/z')
    expect(hasSeenTour('hanzo/z')).toBe(true)
    expect(hasSeenTour('maxpower/dave')).toBe(false)
  })

  it('is version-scoped (the key carries the tour version)', () => {
    stubWindow()
    markTourSeen('hanzo/z')
    const raw = (globalThis as { window?: { localStorage: Storage } }).window!.localStorage.getItem(
      `hz_tour_seen:v${TOUR_VERSION}:hanzo/z`,
    )
    expect(raw).toBe('1')
  })

  it('an empty owner is never seen and never written', () => {
    stubWindow()
    expect(hasSeenTour('')).toBe(false)
    markTourSeen('')
    expect(hasSeenTour('')).toBe(false)
  })

  it('is safe on the server (no window) — false, no throw', () => {
    expect(hasSeenTour('hanzo/z')).toBe(false)
    expect(() => markTourSeen('hanzo/z')).not.toThrow()
    expect(() => resetTour('hanzo/z')).not.toThrow()
  })
})
