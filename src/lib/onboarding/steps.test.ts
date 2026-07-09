import { describe, it, expect } from 'vitest'

import {
  ONBOARDING_STEPS,
  ONBOARDING_VERSION,
  LAST_INDEX,
  stepIndex,
  stepAt,
  isComplete,
  firstIncompleteIndex,
  resumeIndex,
  withStatus,
  withStep,
  withConsent,
  withAiChoice,
  markComplete,
  type OnboardingState,
} from './steps'

describe('onboarding step catalog', () => {
  it('is the six steps in flow order', () => {
    expect(ONBOARDING_STEPS.map((s) => s.id)).toEqual(['secure', 'consent', 'team', 'credits', 'ai', 'launch'])
    expect(LAST_INDEX).toBe(5)
  })

  it('stepIndex/stepAt round-trip and clamp', () => {
    expect(stepIndex('secure')).toBe(0)
    expect(stepIndex('launch')).toBe(5)
    expect(stepAt(0)).toBe('secure')
    expect(stepAt(5)).toBe('launch')
    expect(stepAt(-3)).toBe('secure') // clamp low
    expect(stepAt(99)).toBe('launch') // clamp high
  })
})

describe('completion', () => {
  it('isComplete only when the flag is set', () => {
    expect(isComplete(undefined)).toBe(false)
    expect(isComplete(null)).toBe(false)
    expect(isComplete({})).toBe(false)
    expect(isComplete({ completed: true })).toBe(true)
  })

  it('markComplete stamps the flag, time, and version without mutating', () => {
    const before: OnboardingState = { step: 'ai' }
    const after = markComplete(before, '2026-07-09T00:00:00.000Z')
    expect(after.completed).toBe(true)
    expect(after.completedAt).toBe('2026-07-09T00:00:00.000Z')
    expect(after.version).toBe(ONBOARDING_VERSION)
    expect(after.step).toBe('ai') // preserved
    expect(before.completed).toBeUndefined() // immutable
  })
})

describe('resume', () => {
  it('firstIncompleteIndex finds the first unhandled step', () => {
    expect(firstIncompleteIndex({})).toBe(0)
    expect(firstIncompleteIndex({ status: { secure: 'done' } })).toBe(1)
    expect(firstIncompleteIndex({ status: { secure: 'done', consent: 'skipped' } })).toBe(2)
  })

  it('firstIncompleteIndex returns the last step when all are handled', () => {
    const state: OnboardingState = {
      status: { secure: 'done', consent: 'done', team: 'skipped', credits: 'done', ai: 'skipped', launch: 'done' },
    }
    expect(firstIncompleteIndex(state)).toBe(LAST_INDEX)
  })

  it('resumeIndex prefers an explicit saved step, else first incomplete', () => {
    expect(resumeIndex({ step: 'credits' })).toBe(3)
    expect(resumeIndex({ status: { secure: 'done' } })).toBe(1)
    expect(resumeIndex({})).toBe(0)
  })
})

describe('immutable updates', () => {
  it('withStatus records an outcome without mutating', () => {
    const s: OnboardingState = {}
    const next = withStatus(s, 'secure', 'skipped')
    expect(next.status).toEqual({ secure: 'skipped' })
    expect(s.status).toBeUndefined()
    expect(withStatus(next, 'consent', 'done').status).toEqual({ secure: 'skipped', consent: 'done' })
  })

  it('withStep sets the resume point', () => {
    expect(withStep({}, 'team').step).toBe('team')
  })

  it('withConsent merges without dropping existing fields', () => {
    const a = withConsent({}, { termsAcceptedAt: 't0' })
    const b = withConsent(a, { dataSharing: true })
    expect(b.consent).toEqual({ termsAcceptedAt: 't0', dataSharing: true })
    expect(a.consent).toEqual({ termsAcceptedAt: 't0' }) // immutable
  })

  it('withAiChoice adds without duplicating', () => {
    const a = withAiChoice({}, 'router')
    const b = withAiChoice(a, 'byo')
    const c = withAiChoice(b, 'router') // dup
    expect(c.aiChoices).toEqual(['router', 'byo'])
  })
})
