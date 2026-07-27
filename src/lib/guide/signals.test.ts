import { describe, it, expect } from 'vitest'

import {
  usedMap,
  withUsed,
  isUsed,
  firstRunFromOnboarding,
  roleFrom,
  canAdminister,
  stepAnchorId,
  stepAnchorSelector,
  type GuideSignals,
} from './signals'

const sig = (over: Partial<GuideSignals> = {}): GuideSignals => ({
  owner: 'hanzo/z',
  firstRun: true,
  role: 'member',
  used: {},
  ...over,
})

describe('usedMap', () => {
  it('keeps only the true entries and tolerates junk', () => {
    expect(usedMap({ a: true, b: false, c: 1, d: 'x' })).toEqual({ a: true })
    expect(usedMap(null)).toEqual({})
    expect(usedMap(undefined)).toEqual({})
    expect(usedMap([1, 2])).toEqual({})
    expect(usedMap('nope')).toEqual({})
  })
})

describe('withUsed / isUsed', () => {
  it('adds immutably and idempotently', () => {
    const m0: Record<string, boolean> = {}
    const m1 = withUsed(m0, 'chat')
    expect(m1).toEqual({ chat: true })
    expect(m0).toEqual({}) // original untouched
    expect(withUsed(m1, 'chat')).toBe(m1) // idempotent → same ref
    expect(withUsed(m1, '')).toBe(m1) // ignores empty id
  })

  it('isUsed reads the signal map', () => {
    expect(isUsed(sig({ used: { chat: true } }), 'chat')).toBe(true)
    expect(isUsed(sig(), 'chat')).toBe(false)
  })
})

describe('firstRunFromOnboarding', () => {
  it('is first-run until onboarding is completed', () => {
    expect(firstRunFromOnboarding(undefined)).toBe(true)
    expect(firstRunFromOnboarding({})).toBe(true)
    expect(firstRunFromOnboarding({ completed: true })).toBe(false)
  })
})

describe('roleFrom / canAdminister', () => {
  it('super-admin wins, then org-admin, then member/unknown', () => {
    expect(roleFrom({ isSuperAdmin: true, isAdmin: true, known: true })).toBe('super-admin')
    expect(roleFrom({ isAdmin: true, known: true })).toBe('admin')
    expect(roleFrom({ known: true })).toBe('member')
    expect(roleFrom({ known: false })).toBe('unknown')
    expect(roleFrom({})).toBe('unknown')
  })

  it('canAdminister only for admin + super-admin', () => {
    expect(canAdminister('super-admin')).toBe(true)
    expect(canAdminister('admin')).toBe(true)
    expect(canAdminister('member')).toBe(false)
    expect(canAdminister('unknown')).toBe(false)
  })
})

describe('anchors', () => {
  it('builds a stable data-tour id + selector', () => {
    expect(stepAnchorId('overview', 'api-key')).toBe('guide-overview-api-key')
    expect(stepAnchorSelector('overview', 'api-key')).toBe('[data-tour="guide-overview-api-key"]')
  })
})
