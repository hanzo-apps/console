import { describe, it, expect } from 'vitest'

import { normalizeMargin } from './costs'

/**
 * `normalizeMargin` maps commerce `/v1/costs/margin` onto `Margin`, optional-safe.
 * These pin that (a) real fields land, (b) an unknown/absent `source` degrades to
 * `estimated` (never faked as `actual`), (c) cogs/margin/grossMargin are DERIVED
 * self-consistently from the vendor lines when top-level fields are absent, and
 * (d) a garbage/empty payload → all-zero honest state, never a throw or a fake.
 */
describe('normalizeMargin', () => {
  it('maps a full payload verbatim', () => {
    const m = normalizeMargin({
      period: '2026-07',
      revenueCents: 100000,
      cogsCents: 35000,
      marginCents: 65000,
      grossMarginPct: 65,
      vendors: [
        { vendor: 'digitalocean', service: 'compute', amountCents: 20000, source: 'actual' },
        { vendor: 'openai', service: 'llm-inference', amountCents: 15000, source: 'estimated', note: 'metered' },
      ],
    })
    expect(m).toEqual({
      period: '2026-07',
      revenueCents: 100000,
      cogsCents: 35000,
      marginCents: 65000,
      grossMarginPct: 65,
      vendors: [
        { vendor: 'digitalocean', service: 'compute', amountCents: 20000, source: 'actual' },
        { vendor: 'openai', service: 'llm-inference', amountCents: 15000, source: 'estimated', note: 'metered' },
      ],
    })
  })

  it('derives cogs/margin/grossMargin from vendor lines when top-level fields are absent', () => {
    const m = normalizeMargin({
      period: '2026-07',
      revenueCents: 10000,
      vendors: [
        { vendor: 'digitalocean', service: 'compute', amountCents: 3000, source: 'actual' },
        { vendor: 'openai', service: 'llm-inference', amountCents: 1000, source: 'actual' },
      ],
    })
    expect(m.cogsCents).toBe(4000) // 3000 + 1000
    expect(m.marginCents).toBe(6000) // 10000 - 4000
    expect(m.grossMarginPct).toBe(60) // 6000/10000
  })

  it('degrades an unknown source to estimated (never fabricated as actual)', () => {
    const m = normalizeMargin({ vendors: [{ vendor: 'x', service: 'y', amountCents: 5, source: 'bogus' }] })
    expect(m.vendors[0].source).toBe('estimated')
  })

  it('clamps a negative amount to 0 and rounds', () => {
    const m = normalizeMargin({ vendors: [{ vendor: 'x', service: 'y', amountCents: -50, source: 'actual' }] })
    expect(m.vendors[0].amountCents).toBe(0)
  })

  it('is honest-zero on an empty/garbage payload (no throw, no fake)', () => {
    for (const bad of [null, undefined, {}, [], 'nope', 42]) {
      const m = normalizeMargin(bad)
      expect(m.revenueCents).toBe(0)
      expect(m.cogsCents).toBe(0)
      expect(m.marginCents).toBe(0)
      expect(m.grossMarginPct).toBe(0)
      expect(m.vendors).toEqual([])
    }
  })

  it('zero revenue yields 0% gross margin, never NaN/Inf', () => {
    const m = normalizeMargin({ revenueCents: 0, vendors: [{ vendor: 'do', service: 'compute', amountCents: 100, source: 'actual' }] })
    expect(Number.isFinite(m.grossMarginPct)).toBe(true)
    expect(m.grossMarginPct).toBe(0)
    expect(m.marginCents).toBe(-100) // negative margin is honest (a loss)
  })
})
