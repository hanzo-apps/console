import { describe, expect, it } from 'vitest'

import { firstName, greet, verbFor } from './greeting'

describe('firstName', () => {
  it('takes the name a person answers to, not their record', () => {
    expect(firstName('Zach Kelling')).toBe('Zach')
    expect(firstName('  Ada  Lovelace ')).toBe('Ada')
  })

  it('reads a login as a login', () => {
    expect(firstName('zach.kelling@hanzo.ai')).toBe('zach')
    expect(firstName('zach+cloud@hanzo.ai')).toBe('zach')
    expect(firstName('z@hanzo.ai')).toBe('z')
  })

  it('leaves a chosen handle exactly as it was chosen', () => {
    // Capitalizing someone's handle is a guess about who they are.
    expect(firstName('z')).toBe('z')
    expect(firstName('maxpower')).toBe('maxpower')
  })

  it('has nothing to say when the account has no name', () => {
    expect(firstName('')).toBe('')
    expect(firstName('   ')).toBe('')
    expect(firstName(null)).toBe('')
    expect(firstName(undefined)).toBe('')
  })
})

describe('verbFor', () => {
  it('is the same all day and different tomorrow', () => {
    const morning = new Date('2026-08-13T08:00:00')
    const night = new Date('2026-08-13T23:59:00')
    expect(verbFor(morning)).toBe(verbFor(night))
    expect(verbFor(morning)).not.toBe(verbFor(new Date('2026-08-14T08:00:00')))
  })

  it('comes back around after a week, so it is a rhythm and not a loop', () => {
    const day = new Date('2026-08-13T12:00:00')
    const week = new Date('2026-08-20T12:00:00')
    expect(verbFor(day)).toBe(verbFor(week))
  })

  it('reads naturally after "Good" every day of the week', () => {
    const seen = new Set<string>()
    for (let d = 0; d < 7; d++) {
      const v = verbFor(new Date(2026, 7, 9 + d, 12))
      expect(v).toMatch(/^[a-z]+ing$/) // a verb, lowercase, mid-action
      seen.add(v)
    }
    expect(seen.size).toBe(7) // no day borrows another's word
  })
})

describe('greet', () => {
  const thu = new Date('2026-08-13T18:00:00') // a Thursday

  it('greets the person, not the record', () => {
    expect(greet(thu, 'Zach Kelling')).toBe('Good scheming, Zach')
  })

  it('drops the comma rather than leaving it orphaned', () => {
    // The bug this prevents is "Good scheming, " on an account with no name.
    expect(greet(thu, '')).toBe('Good scheming')
    expect(greet(thu, null)).toBe('Good scheming')
  })
})
