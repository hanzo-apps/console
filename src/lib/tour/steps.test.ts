import { describe, it, expect, afterEach } from 'vitest'

import {
  CONSOLE_TOUR,
  PLAYGROUND_TOUR,
  clampIndex,
  nextIndex,
  prevIndex,
  isLast,
  hasSeenTour,
  markTourSeen,
  planTour,
  resetTour,
  sameRoute,
  TOUR_VERSION,
  type TourStep,
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

  it('the Playground tour walks the product, not the getting-started card', () => {
    // 6–9 stops: enough to sell the surface, few enough that anyone finishes it.
    expect(PLAYGROUND_TOUR.length).toBeGreaterThanOrEqual(6)
    expect(PLAYGROUND_TOUR.length).toBeLessThanOrEqual(9)
    const ids = PLAYGROUND_TOUR.map((s) => s.id)
    expect(new Set(ids).size, 'step ids are unique').toBe(ids.length)
    // It opens on the modes and ends by pointing at the rest of the console.
    expect(ids[0]).toBe('modes')
    expect(ids[ids.length - 1]).toBe('nav')
    for (const s of PLAYGROUND_TOUR) {
      expect(s.title.length).toBeGreaterThan(0)
      expect(s.body.length).toBeGreaterThan(0)
      // Every stop is anchored — a Playground tour with a floating step teaches nothing.
      expect(s.target, `${s.id} is anchored`).toMatch(/^\[data-tour="[a-z-]+"\]$/)
      // NEVER a getting-started checklist row: those are `guide-<id>-<step>` anchors,
      // and spotlighting them was the walk this tour replaced.
      expect(s.target).not.toMatch(/data-tour="guide-/)
    }
  })

  it('every routed step names an in-console path', () => {
    for (const s of [...CONSOLE_TOUR, ...PLAYGROUND_TOUR]) {
      if (s.route) expect(s.route).toMatch(/^\/[a-z0-9/-]*$/)
    }
  })
})

describe('sameRoute', () => {
  it('ignores a trailing slash, a query and a hash', () => {
    expect(sameRoute('/playground', '/playground/')).toBe(true)
    expect(sameRoute('/playground', '/playground?p=abc')).toBe(true)
    expect(sameRoute('/playground', '/playground#x')).toBe(true)
    expect(sameRoute('/', '')).toBe(true)
    expect(sameRoute('/', '/playground')).toBe(false)
  })
})

describe('planTour — never spotlight nothing', () => {
  const steps: TourStep[] = [
    { id: 'centered', title: 't', body: 'b' },
    { id: 'here', target: '[data-tour="here"]', title: 't', body: 'b' },
    { id: 'missing', target: '[data-tour="missing"]', title: 't', body: 'b' },
    { id: 'elsewhere', target: '[data-tour="over-there"]', title: 't', body: 'b', route: '/playground' },
    { id: 'declared-here', target: '[data-tour="gone"]', title: 't', body: 'b', route: '/' },
  ]
  const plan = (pathname: string) =>
    planTour(steps, { pathname, has: (sel) => sel === '[data-tour="here"]' }).map((s) => s.id)

  it('keeps centered steps, present anchors, and steps on another route', () => {
    expect(plan('/')).toEqual(['centered', 'here', 'elsewhere'])
  })

  it('drops a step whose anchor is absent on the route it belongs to', () => {
    // `missing` (no route ⟹ expected here) and `declared-here` (route === here) both go.
    expect(plan('/')).not.toContain('missing')
    expect(plan('/')).not.toContain('declared-here')
  })

  it('re-judges every step against where you are standing', () => {
    // On /playground, `elsewhere` is no longer elsewhere — its anchor is expected NOW
    // and `has` says it is absent, so it goes. `declared-here` becomes the cross-route
    // one and is kept, because the tour will navigate to it.
    expect(plan('/playground')).toEqual(['centered', 'here', 'declared-here'])
  })

  it('is honest about length — the counter can only show reachable stops', () => {
    expect(planTour(steps, { pathname: '/', has: () => false }).map((s) => s.id)).toEqual([
      'centered',
      'elsewhere',
    ])
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
