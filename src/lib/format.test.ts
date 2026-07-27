import { describe, expect, it } from 'vitest'

import { DASH, ago, bytes, dateTime, gib, int, ms, pct, shortDate, usd, usdCompact } from './format'

const ABSENT = [null, undefined, Number.NaN, Number.POSITIVE_INFINITY] as const

describe('usd — integer cents, always two decimals', () => {
  it('renders cents as grouped dollars', () => {
    expect(usd(0)).toBe('$0.00')
    expect(usd(500)).toBe('$5.00') // NOT '$5' — a money column never mixes precisions
    expect(usd(5000)).toBe('$50.00')
    expect(usd(123456)).toBe('$1,234.56')
    expect(usd(2_600_000)).toBe('$26,000.00')
  })

  it('rounds half-cent inputs to the cent, never truncating silently', () => {
    expect(usd(1234.5)).toBe('$12.35')
    expect(usd(1234.4)).toBe('$12.34')
  })

  it('leads a negative with the sign, not the dollar', () => {
    expect(usd(-500)).toBe('-$5.00')
  })

  it('is an em dash for anything absent or non-finite — never a fabricated $0.00', () => {
    for (const v of ABSENT) expect(usd(v)).toBe(DASH)
  })
})

describe('usdCompact', () => {
  it('shortens past $1k and stays exact below it', () => {
    expect(usdCompact(50_000)).toBe('$500.00')
    expect(usdCompact(120_000)).toBe('$1.2k')
    expect(usdCompact(100_000)).toBe('$1k')
    expect(usdCompact(340_000_000)).toBe('$3.4M')
    expect(usdCompact(500_000_000_000)).toBe('$5B')
    expect(usdCompact(-120_000)).toBe('-$1.2k')
  })

  it('is an em dash when absent', () => {
    for (const v of ABSENT) expect(usdCompact(v)).toBe(DASH)
  })
})

describe('int / pct', () => {
  it('groups an integer count and rounds a fraction', () => {
    expect(int(1234)).toBe('1,234')
    expect(int(1234.6)).toBe('1,235')
    expect(int(0)).toBe('0')
    for (const v of ABSENT) expect(int(v)).toBe(DASH)
  })

  it('renders an ALREADY-percent number to one decimal by default', () => {
    expect(pct(12.34)).toBe('12.3%')
    expect(pct(12.34, 0)).toBe('12%')
    expect(pct(-3.21)).toBe('-3.2%')
    expect(pct(0)).toBe('0.0%')
    for (const v of ABSENT) expect(pct(v)).toBe(DASH)
  })
})

describe('shortDate / dateTime', () => {
  it('takes the calendar day off an ISO timestamp', () => {
    expect(shortDate('2026-07-27T10:11:12Z')).toBe('2026-07-27')
    expect(shortDate('2026-07-27')).toBe('2026-07-27')
    expect(shortDate('')).toBe(DASH)
    expect(shortDate(null)).toBe(DASH)
    expect(shortDate(undefined)).toBe(DASH)
  })

  it('renders a real timestamp and dashes an unparseable one', () => {
    expect(dateTime('2026-07-27T10:11:12Z')).toContain('2026')
    expect(dateTime('not a date')).toBe(DASH)
    expect(dateTime(null)).toBe(DASH)
  })
})

describe('ago', () => {
  const at = (msAgo: number) => new Date(Date.now() - msAgo).toISOString()

  it('reads in the largest honest unit', () => {
    expect(ago(at(5_000))).toMatch(/^\d+s ago$/)
    expect(ago(at(3 * 60_000))).toBe('3m ago')
    expect(ago(at(3 * 3_600_000))).toBe('3h ago')
    expect(ago(at(2 * 86_400_000))).toBe('2d ago')
  })

  it('never reads as the future for a clock-skewed timestamp', () => {
    expect(ago(at(-60_000))).toBe('0s ago')
  })

  it('is an em dash when absent or unparseable', () => {
    expect(ago(null)).toBe(DASH)
    expect(ago('')).toBe(DASH)
    expect(ago('not a date')).toBe(DASH)
  })
})

describe('ms / bytes / gib', () => {
  it('promotes milliseconds to seconds past 1s', () => {
    expect(ms(124)).toBe('124ms')
    expect(ms(999)).toBe('999ms')
    expect(ms(1200)).toBe('1.2s')
    expect(ms(-1)).toBe(DASH)
    for (const v of ABSENT) expect(ms(v)).toBe(DASH)
  })

  it('renders base-1024 bytes', () => {
    expect(bytes(0)).toBe('0 B')
    expect(bytes(1024)).toBe('1.0 KB')
    expect(bytes(1_500_000)).toBe('1.4 MB')
    expect(bytes(2 * 1024 ** 3)).toBe('2.0 GB')
    expect(bytes(-5)).toBe(DASH)
    for (const v of ABSENT) expect(bytes(v)).toBe(DASH)
  })

  it('renders GiB, promoting to TiB past 1024', () => {
    expect(gib(500)).toBe('500 GiB')
    expect(gib(0)).toBe('0 GiB')
    expect(gib(2048)).toBe('2 TiB')
    expect(gib(-1)).toBe(DASH)
    for (const v of ABSENT) expect(gib(v)).toBe(DASH)
  })
})
