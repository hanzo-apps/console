import { describe, expect, it } from 'vitest'

import { fmtNs, fmtRate, fmtPct, fmtCount, fmtBytes, fmtCores, fmtAgo, errorTone } from './apm-format'

describe('fmtNs', () => {
  it('scales ns → µs/ms/s', () => {
    expect(fmtNs(500)).toBe('500ns')
    expect(fmtNs(5_000)).toBe('5µs')
    expect(fmtNs(1_500_000)).toBe('1.5ms')
    expect(fmtNs(125_000_000)).toBe('125ms')
    expect(fmtNs(2_500_000_000)).toBe('2.50s')
  })
  it('em dash for missing/negative', () => {
    expect(fmtNs(null)).toBe('—')
    expect(fmtNs(undefined)).toBe('—')
    expect(fmtNs(-1)).toBe('—')
    expect(fmtNs(NaN)).toBe('—')
  })
})

describe('fmtRate', () => {
  it('formats a per-second rate', () => {
    expect(fmtRate(0)).toBe('0 /s')
    expect(fmtRate(3.456)).toBe('3.46 /s')
    expect(fmtRate(42.7)).toBe('42.7 /s')
    expect(fmtRate(1234)).toBe('1,234 /s')
  })
  it('em dash for missing/negative', () => {
    expect(fmtRate(null)).toBe('—')
    expect(fmtRate(-2)).toBe('—')
  })
})

describe('fmtPct', () => {
  it('treats <=1 as a fraction, >1 as already-percent', () => {
    expect(fmtPct(0.42)).toBe('42%')
    expect(fmtPct(0.005)).toBe('0.5%')
    expect(fmtPct(12.4)).toBe('12%')
    expect(fmtPct(12.5)).toBe('13%')
    expect(fmtPct(0)).toBe('0%')
  })
  it('em dash for missing/negative', () => {
    expect(fmtPct(null)).toBe('—')
    expect(fmtPct(-0.1)).toBe('—')
  })
})

describe('fmtCount', () => {
  it('groups integers', () => {
    expect(fmtCount(1234567)).toBe('1,234,567')
    expect(fmtCount(0)).toBe('0')
  })
  it('em dash for missing', () => {
    expect(fmtCount(null)).toBe('—')
    expect(fmtCount(NaN)).toBe('—')
  })
})

describe('fmtBytes', () => {
  it('scales base-1024', () => {
    expect(fmtBytes(0)).toBe('0 B')
    expect(fmtBytes(1024)).toBe('1.0 KB')
    expect(fmtBytes(1_500_000)).toBe('1.4 MB')
    expect(fmtBytes(2 * 1024 ** 3)).toBe('2.0 GB')
  })
  it('em dash for missing/negative', () => {
    expect(fmtBytes(null)).toBe('—')
    expect(fmtBytes(-5)).toBe('—')
  })
})

describe('fmtCores', () => {
  it('shows a fraction as % and >=1 as cores', () => {
    expect(fmtCores(0.42)).toBe('42%')
    expect(fmtCores(1.5)).toBe('1.50 cores')
    expect(fmtCores(0)).toBe('0')
  })
  it('em dash for missing', () => {
    expect(fmtCores(null)).toBe('—')
  })
})

describe('fmtAgo', () => {
  it('formats recency buckets', () => {
    const now = Date.now()
    expect(fmtAgo(new Date(now - 5_000).toISOString())).toMatch(/^\d+s ago$/)
    expect(fmtAgo(new Date(now - 5 * 60_000).toISOString())).toBe('5m ago')
    expect(fmtAgo(new Date(now - 3 * 3600_000).toISOString())).toBe('3h ago')
    expect(fmtAgo(new Date(now - 2 * 86_400_000).toISOString())).toBe('2d ago')
  })
  it('em dash for missing/invalid', () => {
    expect(fmtAgo(null)).toBe('—')
    expect(fmtAgo('not-a-date')).toBe('—')
  })
})

describe('errorTone', () => {
  it('escalates by WEIGHT, never hue — calm → warn → hot', () => {
    expect(errorTone(0)).toBe('var(--color11)') // positive
    expect(errorTone(0.03)).toBe('var(--color11)') // 3% — warning
    expect(errorTone(0.2)).toBe('var(--color12)') // 20% — critical
    for (const r of [0, 0.005, 0.03, 0.2, 10, null]) expect(errorTone(r)).toMatch(/^var\(--color(9|10|11|12)\)$/)
  })
  it('accepts already-percent values and defaults calm', () => {
    expect(errorTone(10)).toBe('var(--color12)')
    expect(errorTone(null)).toBe('var(--color11)')
  })
})
