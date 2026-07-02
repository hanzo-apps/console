import { describe, it, expect } from 'vitest'

import { normalizeFinance } from './finance'

/**
 * `normalizeFinance` is the optional-safe map from the raw `/v1/admin/finance`
 * payload onto `Finance`. These pin that (a) a real payload lands field-for-field,
 * (b) an unconfigured/empty payload degrades to honest zeros/empty/null (never a
 * fabricated MRR or margin), and (c) `runwayDays` preserves NULL — a 0 there would
 * read as "out of runway", a fabricated alarm.
 */

describe('normalizeFinance — /v1/admin/finance → Finance', () => {
  it('maps a full real payload field-for-field', () => {
    const fin = normalizeFinance({
      cost: {
        digitalocean: {
          configured: true,
          error: '',
          creditRemainingCents: 1_000_000,
          monthToDateSpendCents: 300_000,
          avgDailyBurnCents: 30_000,
          accountBalanceCents: -1_000_000,
          generatedAt: '2026-07-15T00:00:00Z',
          history: [
            { date: '2026-06-01T00:00:00Z', amountCents: 280_000, type: 'Invoice', description: 'Invoice for June' },
            { date: '2026-05-01T00:00:00Z', amountCents: -4_000_000, type: 'Credit', description: 'Promo credit' },
          ],
        },
      },
      revenue: { configured: true, totalRevenueCents: 30_000, mrrCents: 10_000, creditsConsumedCents: 30_000 },
      derived: { grossMarginCents: -270_000, grossMarginPct: -900, runwayDays: 33.33, profitable: false },
      generatedAt: '2026-07-15T00:00:00Z',
    })

    expect(fin.cost.digitalocean.configured).toBe(true)
    expect(fin.cost.digitalocean.creditRemainingCents).toBe(1_000_000)
    expect(fin.cost.digitalocean.monthToDateSpendCents).toBe(300_000)
    expect(fin.cost.digitalocean.accountBalanceCents).toBe(-1_000_000)
    expect(fin.cost.digitalocean.history).toHaveLength(2)
    expect(fin.cost.digitalocean.history[0]).toEqual({ date: '2026-06-01T00:00:00Z', amountCents: 280_000, type: 'Invoice', description: 'Invoice for June' })
    expect(fin.revenue).toEqual({ configured: true, totalRevenueCents: 30_000, mrrCents: 10_000, creditsConsumedCents: 30_000 })
    expect(fin.derived.grossMarginCents).toBe(-270_000)
    expect(fin.derived.runwayDays).toBe(33.33)
    expect(fin.derived.profitable).toBe(false)
  })

  it('degrades an unconfigured/empty payload to honest zeros, empty, and NULL runway', () => {
    const fin = normalizeFinance({
      cost: { digitalocean: { configured: false, error: 'DO_API_TOKEN not configured' } },
      revenue: { configured: false },
      derived: { grossMarginCents: 0, grossMarginPct: 0, runwayDays: null, profitable: false },
      generatedAt: '',
    })
    expect(fin.cost.digitalocean.configured).toBe(false)
    expect(fin.cost.digitalocean.error).toBe('DO_API_TOKEN not configured')
    expect(fin.cost.digitalocean.creditRemainingCents).toBe(0)
    expect(fin.cost.digitalocean.history).toEqual([]) // never null — an honest empty chart
    expect(fin.revenue.mrrCents).toBe(0)
    // runway is honestly null (not 0) when DO is unconfigured.
    expect(fin.derived.runwayDays).toBeNull()
  })

  it('never throws on a garbage/partial payload (all fields optional-safe)', () => {
    expect(() => normalizeFinance(null)).not.toThrow()
    expect(() => normalizeFinance({})).not.toThrow()
    expect(() => normalizeFinance({ cost: 'nope', revenue: 5, derived: [] })).not.toThrow()
    const fin = normalizeFinance({})
    expect(fin.cost.digitalocean.configured).toBe(false)
    expect(fin.derived.runwayDays).toBeNull()
    expect(fin.cost.digitalocean.history).toEqual([])
  })

  it('coerces a non-finite runway (NaN/Infinity) to null (no fabricated alarm)', () => {
    expect(normalizeFinance({ derived: { runwayDays: Infinity } }).derived.runwayDays).toBeNull()
    expect(normalizeFinance({ derived: { runwayDays: NaN } }).derived.runwayDays).toBeNull()
  })
})
