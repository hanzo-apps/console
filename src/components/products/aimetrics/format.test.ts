import { describe, it, expect } from 'vitest'

import { usd, count, compact, tokens, ago, dayLabel } from './format'

/** Display formatters for AI Metrics — pure, must never fabricate a value. */

describe('usd — cents → dollars', () => {
  it('formats small amounts to 2dp', () => {
    expect(usd(0)).toBe('$0.00')
    expect(usd(1)).toBe('$0.01')
    expect(usd(123)).toBe('$1.23')
  })
  it('compacts large amounts', () => {
    expect(usd(123456)).toBe('$1.2k') // $1,234.56
  })
})

describe('count + compact + tokens', () => {
  it('count adds thousands separators', () => {
    expect(count(1234)).toBe('1,234')
  })
  it('compact scales k/M/B and trims trailing .0', () => {
    expect(compact(999)).toBe('999')
    expect(compact(1000)).toBe('1k')
    expect(compact(1500)).toBe('1.5k')
    expect(compact(2_300_000)).toBe('2.3M')
  })
  it('tokens shows 0 honestly', () => {
    expect(tokens(0)).toBe('0')
    expect(tokens(1234)).toBe('1.2k')
  })
})

describe('ago — relative time', () => {
  const now = Date.parse('2026-06-30T12:00:00Z')
  it('returns em dash for null', () => {
    expect(ago(null, now)).toBe('—')
  })
  it('seconds / minutes / hours / days', () => {
    expect(ago(now - 5_000, now)).toBe('5s ago')
    expect(ago(now - 5 * 60_000, now)).toBe('5m ago')
    expect(ago(now - 3 * 3_600_000, now)).toBe('3h ago')
    expect(ago(now - 2 * 86_400_000, now)).toBe('2d ago')
  })
  it('falls back to a date past a week', () => {
    expect(ago(now - 30 * 86_400_000, now)).toMatch(/\d/)
  })
})

describe('dayLabel', () => {
  it('renders a short month/day label', () => {
    expect(dayLabel('2026-06-24')).toMatch(/Jun/)
  })
  it('passes through a malformed key', () => {
    expect(dayLabel('not-a-date')).toBe('not-a-date')
  })
})
