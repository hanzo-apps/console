import { describe, it, expect } from 'vitest'

import type { PlatformPromo } from '~/lib/api/admin-promos'
import {
  formForPromo,
  fromDatetimeLocal,
  parsePlans,
  plansToText,
  promoIsSet,
  promoSummary,
  toDatetimeLocal,
  validatePromoForm,
  type PromoForm,
} from './promo-logic'

const promo = (p: Partial<PlatformPromo> = {}): PlatformPromo => ({
  percentOff: 0,
  start: '',
  end: '',
  plans: [],
  active: false,
  ...p,
})

const form = (f: Partial<PromoForm> = {}): PromoForm => ({
  percentOff: 0,
  start: '',
  end: '',
  plans: '',
  active: false,
  ...f,
})

describe('datetime round-trip (UTC by construction)', () => {
  it('surfaces the YYYY-MM-DDTHH:mm prefix of an RFC3339 instant', () => {
    expect(toDatetimeLocal('2026-08-01T09:30:00Z')).toBe('2026-08-01T09:30')
    expect(toDatetimeLocal('2026-12-31T23:59:59.500Z')).toBe('2026-12-31T23:59')
  })
  it('is empty for an absent or unparseable value', () => {
    expect(toDatetimeLocal('')).toBe('')
    expect(toDatetimeLocal(undefined)).toBe('')
    expect(toDatetimeLocal('not-a-date')).toBe('')
  })
  it('appends :ssZ to a datetime-local value', () => {
    expect(fromDatetimeLocal('2026-08-01T09:30')).toBe('2026-08-01T09:30:00Z')
    expect(fromDatetimeLocal('2026-08-01T09:30:45')).toBe('2026-08-01T09:30:45Z')
  })
  it('is empty for an empty or malformed datetime-local value', () => {
    expect(fromDatetimeLocal('')).toBe('')
    expect(fromDatetimeLocal('2026-08-01')).toBe('')
    expect(fromDatetimeLocal('garbage')).toBe('')
  })
  it('round-trips an instant through the form and back', () => {
    expect(fromDatetimeLocal(toDatetimeLocal('2026-08-01T09:30:00Z'))).toBe('2026-08-01T09:30:00Z')
  })
})

describe('parsePlans / plansToText', () => {
  it('splits, trims, de-dupes, and drops empties (order preserved)', () => {
    expect(parsePlans(' pro, team ,, pro\nenterprise ')).toEqual(['pro', 'team', 'enterprise'])
  })
  it('is empty for a blank list', () => {
    expect(parsePlans('')).toEqual([])
    expect(parsePlans('  ,  \n ')).toEqual([])
  })
  it('renders a plan list back to comma text', () => {
    expect(plansToText(['pro', 'team'])).toBe('pro, team')
    expect(plansToText([])).toBe('')
  })
})

describe('promoIsSet / promoSummary', () => {
  it('an all-zero promo is unset', () => {
    expect(promoIsSet(promo())).toBe(false)
    expect(promoSummary(promo())).toBe('No promo configured')
  })
  it('any real field marks it set', () => {
    expect(promoIsSet(promo({ percentOff: 10 }))).toBe(true)
    expect(promoIsSet(promo({ active: true }))).toBe(true)
    expect(promoIsSet(promo({ plans: ['pro'] }))).toBe(true)
    expect(promoIsSet(promo({ start: '2026-08-01T00:00:00Z' }))).toBe(true)
  })
  it('summarizes percent, scope, and active state', () => {
    expect(promoSummary(promo({ percentOff: 50, plans: ['pro', 'team'], active: true }))).toBe('50% off · pro, team · active')
    expect(promoSummary(promo({ percentOff: 25, active: false }))).toBe('25% off · all paid plans · inactive')
  })
})

describe('validatePromoForm', () => {
  it('accepts a valid form and coerces to the wire body', () => {
    const r = validatePromoForm(form({ percentOff: 50, start: '2026-08-01T00:00', end: '2026-09-01T00:00', plans: 'pro, team', active: true }))
    expect(r).toEqual({
      ok: true,
      body: { percentOff: 50, start: '2026-08-01T00:00:00Z', end: '2026-09-01T00:00:00Z', plans: ['pro', 'team'], active: true },
    })
  })
  it('accepts an open-ended (no window) promo', () => {
    const r = validatePromoForm(form({ percentOff: 20, plans: '', active: true }))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.body).toEqual({ percentOff: 20, start: '', end: '', plans: [], active: true })
  })
  it('rejects a percent outside 0..100', () => {
    expect(validatePromoForm(form({ percentOff: 101 }))).toEqual({ ok: false, error: 'Percent off must be between 0 and 100.' })
    expect(validatePromoForm(form({ percentOff: -1 }))).toEqual({ ok: false, error: 'Percent off must be between 0 and 100.' })
  })
  it('rejects a malformed date', () => {
    expect(validatePromoForm(form({ percentOff: 10, start: 'nope' }))).toEqual({ ok: false, error: 'Start is not a valid date/time.' })
  })
  it('rejects end on/before start', () => {
    expect(validatePromoForm(form({ percentOff: 10, start: '2026-09-01T00:00', end: '2026-08-01T00:00' }))).toEqual({
      ok: false,
      error: 'End must be after start.',
    })
  })
})

describe('formForPromo', () => {
  it('pre-fills the editor from a live promo', () => {
    expect(formForPromo(promo({ percentOff: 50, start: '2026-08-01T00:00:00Z', plans: ['pro'], active: true }))).toEqual({
      percentOff: 50,
      start: '2026-08-01T00:00',
      end: '',
      plans: 'pro',
      active: true,
    })
  })
})
