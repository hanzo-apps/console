import { describe, it, expect } from 'vitest'

import {
  resolveSteps,
  completion,
  incompleteCount,
  buildTourFromSteps,
  resolveTour,
  stepDone,
  type ProductGuide,
} from './spec'
import type { GuideSignals } from './signals'
import type { TourStep } from '~/lib/tour/steps'

const sig = (over: Partial<GuideSignals> = {}): GuideSignals => ({
  owner: 'o',
  firstRun: true,
  role: 'member',
  used: {},
  ...over,
})

const guide: ProductGuide = {
  id: 'demo',
  label: 'Demo',
  pitch: { headline: 'H', subhead: 'S', points: [] },
  steps: [
    { id: 'key', title: 'Get key', body: 'b', action: { label: 'Get', to: '/api-keys' }, done: (s) => s.hasApiKey === true },
    { id: 'use', title: 'Use it', body: 'b', action: { label: 'Open', to: '/demo' }, done: (s) => Boolean(s.used.demo) },
    { id: 'admin', title: 'Admin', body: 'b', when: (s) => s.role === 'admin' || s.role === 'super-admin' },
  ],
}

describe('resolveSteps', () => {
  it('filters by `when`, computes `done`, marks the first not-done active', () => {
    const r = resolveSteps(guide, sig()) // member → admin step filtered out
    expect(r.map((x) => x.step.id)).toEqual(['key', 'use'])
    expect(r[0].done).toBe(false)
    expect(r[0].active).toBe(true)
    expect(r[1].active).toBe(false)
  })

  it('a done step is never active — the next not-done becomes active', () => {
    const r = resolveSteps(guide, sig({ hasApiKey: true }))
    expect(r[0].done).toBe(true)
    expect(r[0].active).toBe(false)
    expect(r[1].active).toBe(true)
  })

  it('shows a `when`-gated step to a user who qualifies', () => {
    const r = resolveSteps(guide, sig({ role: 'admin' }))
    expect(r.map((x) => x.step.id)).toContain('admin')
  })

  it('never fabricates done for an unknown signal', () => {
    // hasApiKey undefined → the predicate returns undefined → NOT done (honest).
    expect(stepDone(guide.steps[0], sig())).toBe(false)
  })
})

describe('completion / incompleteCount', () => {
  it('tallies done/total/pct/complete', () => {
    expect(completion(resolveSteps(guide, sig()))).toEqual({ done: 0, total: 2, pct: 0, complete: false })
    expect(completion(resolveSteps(guide, sig({ hasApiKey: true, used: { demo: true } })))).toEqual({
      done: 2,
      total: 2,
      pct: 100,
      complete: true,
    })
    expect(incompleteCount(resolveSteps(guide, sig({ hasApiKey: true })))).toBe(1)
  })

  it('empty steps → zeros, not complete', () => {
    expect(completion([])).toEqual({ done: 0, total: 0, pct: 0, complete: false })
    expect(incompleteCount([])).toBe(0)
  })
})

describe('buildTourFromSteps', () => {
  it('spotlights only the incomplete step rows, in order', () => {
    const resolved = resolveSteps(guide, sig({ hasApiKey: true })) // key done, use not
    const tour = buildTourFromSteps(guide, resolved)
    expect(tour.map((t) => t.id)).toEqual(['demo-use'])
    expect(tour[0].target).toBe('[data-tour="guide-demo-use"]')
  })

  it('appends authored extra tour steps after the generated walk', () => {
    const extra: TourStep = { id: 'x', title: 't', body: 'b' }
    const g2: ProductGuide = { ...guide, tour: [extra] }
    const tour = buildTourFromSteps(g2, resolveSteps(g2, sig()))
    expect(tour[tour.length - 1].id).toBe('x')
  })
})

describe('resolveTour', () => {
  it('drops steps whose `when` predicate is false (personalized)', () => {
    const steps: TourStep[] = [
      { id: 'a', title: 'a', body: 'b' },
      { id: 'key', title: 'k', body: 'b', when: (s) => s.hasApiKey !== true },
    ]
    expect(resolveTour(steps, sig()).map((s) => s.id)).toEqual(['a', 'key']) // no key → shown
    expect(resolveTour(steps, sig({ hasApiKey: true })).map((s) => s.id)).toEqual(['a']) // has key → dropped
  })
})
