import { describe, it, expect } from 'vitest'

import { GUIDES, resolveGuide, hasGuide } from './registry'
import { resolveSteps } from './spec'
import type { GuideSignals } from './signals'

const sig = (over: Partial<GuideSignals> = {}): GuideSignals => ({
  owner: 'o',
  firstRun: true,
  role: 'member',
  used: {},
  ...over,
})

describe('guide registry', () => {
  it('resolves curated flagships and is silent for the long tail', () => {
    expect(hasGuide('overview')).toBe(true)
    expect(hasGuide('models')).toBe(true)
    expect(resolveGuide('models')).toBe(GUIDES.models)
    expect(resolveGuide('totally-unknown')).toBeUndefined()
    expect(hasGuide('totally-unknown')).toBe(false)
  })

  it('every curated guide is well-formed: pitch + >=1 step, native routes only', () => {
    for (const [id, g] of Object.entries(GUIDES)) {
      expect(g.id).toBe(id)
      expect(g.pitch.headline.length).toBeGreaterThan(0)
      expect(g.pitch.subhead.length).toBeGreaterThan(0)
      expect(g.steps.length).toBeGreaterThanOrEqual(1)
      for (const s of g.steps) {
        expect(s.title.length).toBeGreaterThan(0)
        expect(s.body.length).toBeGreaterThan(0)
        // A CTA is always a NATIVE in-console route (never an external link-out).
        if (s.action) expect(s.action.to.startsWith('/')).toBe(true)
      }
      for (const p of g.pitch.points) {
        expect(p.title.length).toBeGreaterThan(0)
        expect(p.body.length).toBeGreaterThan(0)
      }
      if (g.tour) for (const t of g.tour) if (t.target) expect(t.target).toMatch(/^\[data-tour="[a-z-]+"\]$/)
    }
  })

  it('is honest: nothing is checked for a brand-new user (no fabricated progress)', () => {
    for (const g of Object.values(GUIDES)) {
      const resolved = resolveSteps(g, sig())
      expect(resolved.every((r) => r.done === false)).toBe(true)
    }
  })

  it('a step checks off ONLY when its real signal is present', () => {
    const models = resolveGuide('models')!
    expect(resolveSteps(models, sig()).find((r) => r.step.id === 'api-key')!.done).toBe(false)
    expect(resolveSteps(models, sig({ hasApiKey: true })).find((r) => r.step.id === 'api-key')!.done).toBe(true)
  })

  it('the console guide gates "invite your team" behind an admin role', () => {
    const ov = resolveGuide('overview')!
    const asMember = resolveSteps(ov, sig()).map((r) => r.step.id)
    const asAdmin = resolveSteps(ov, sig({ role: 'admin' })).map((r) => r.step.id)
    expect(asMember).not.toContain('invite')
    expect(asAdmin).toContain('invite')
  })
})
