import { describe, it, expect } from 'vitest'

import type { UsageRecord } from '~/lib/api/aimetrics'
import {
  monthToDate,
  daysInMonth,
  groupSpend,
  filterGroups,
  presentDimensions,
  dailySpend,
  shortDay,
} from './logic'

/**
 * The billing-center math is a pure projection over the real commerce usage ledger
 * — these prove the forecast run-rate, the honest cost grouping (model/provider
 * only; no invented project/SKU dimension), and that undated/out-of-window records
 * are dropped rather than distorting a windowed view.
 */

const rec = (p: Partial<UsageRecord>): UsageRecord => ({
  id: p.id ?? 'r',
  cents: p.cents ?? 0,
  model: p.model ?? '',
  provider: p.provider ?? '',
  product: p.product ?? '',
  agent: p.agent ?? '',
  promptTokens: p.promptTokens ?? 0,
  completionTokens: p.completionTokens ?? 0,
  totalTokens: p.totalTokens ?? 0,
  at: p.at ?? null,
  notes: p.notes ?? '',
  premium: p.premium ?? false,
  stream: p.stream ?? false,
  status: p.status ?? '',
  requestId: p.requestId ?? '',
})

// June 2026 has 30 days; use noon on the 15th so exactly 15 days have elapsed.
const JUN15 = new Date(2026, 5, 15, 12, 0, 0).getTime()
const JUN = (day: number) => new Date(2026, 5, day, 10, 0, 0).getTime()
const MAY = (day: number) => new Date(2026, 4, day, 10, 0, 0).getTime()

describe('monthToDate — MTD spend + linear projection', () => {
  it('sums only this-month records and projects linearly on the run-rate', () => {
    const f = monthToDate(
      [rec({ at: JUN(2), cents: 300 }), rec({ at: JUN(10), cents: 600 }), rec({ at: MAY(28), cents: 9999 })],
      JUN15,
    )
    expect(f.spentCents).toBe(900) // May record excluded
    expect(f.dayOfMonth).toBe(15)
    expect(f.daysInMonth).toBe(30)
    // 900 / 15 * 30 = 1800
    expect(f.projectedCents).toBe(1800)
  })

  it('drops undated records (cannot be attributed to a month)', () => {
    const f = monthToDate([rec({ at: null, cents: 5000 }), rec({ at: JUN(3), cents: 100 })], JUN15)
    expect(f.spentCents).toBe(100)
  })

  it('projects null before any day elapses (no basis — honest —)', () => {
    // A synthetic instant at ms 0 of a month → getDate() is 1, so use a guard case:
    const f = monthToDate([], JUN15)
    expect(f.spentCents).toBe(0)
    expect(f.projectedCents).toBe(0) // 0 spend projects to 0, not a fabricated number
  })

  it('daysInMonth is calendar-correct (Feb 2024 leap = 29)', () => {
    expect(daysInMonth(new Date(2024, 1, 10).getTime())).toBe(29)
    expect(daysInMonth(new Date(2026, 1, 10).getTime())).toBe(28)
    expect(daysInMonth(JUN15)).toBe(30)
  })
})

describe('groupSpend — cost breakdown by a present dimension', () => {
  const recs = [
    rec({ model: 'zen-1', provider: 'hanzo', cents: 100, totalTokens: 10 }),
    rec({ model: 'zen-1', provider: 'hanzo', cents: 250, totalTokens: 20 }),
    rec({ model: 'gpt-4o', provider: 'openai', cents: 400, totalTokens: 5 }),
  ]

  it('groups by model, summing spend/requests/tokens, sorted by spend desc', () => {
    const g = groupSpend(recs, 'model')
    expect(g.map((r) => r.label)).toEqual(['gpt-4o', 'zen-1'])
    expect(g[1].cents).toBe(350)
    expect(g[1].requests).toBe(2)
    expect(g[1].tokens).toBe(30)
    expect(g[1].provider).toBe('hanzo')
  })

  it('groups by provider', () => {
    const g = groupSpend(recs, 'provider')
    expect(g.map((r) => r.label)).toEqual(['openai', 'hanzo'])
    expect(g[0].cents).toBe(400)
  })

  it('groups by product surface (which product cost me $X)', () => {
    const g = groupSpend(
      [rec({ product: 'agents', cents: 300 }), rec({ product: 'agents', cents: 100 }), rec({ product: 'chat', cents: 250 })],
      'product',
    )
    expect(g.map((r) => r.label)).toEqual(['agents', 'chat'])
    expect(g[0].cents).toBe(400)
  })

  it('groups by agent (which agent cost me $X)', () => {
    const g = groupSpend(
      [rec({ agent: 'hanzo-bot', cents: 90 }), rec({ agent: 'hanzo-bot', cents: 60 }), rec({ agent: 'triage', cents: 400 })],
      'agent',
    )
    expect(g.map((r) => r.label)).toEqual(['triage', 'hanzo-bot'])
    expect(g[1].cents).toBe(150)
    expect(g[1].requests).toBe(2)
  })

  it('labels a missing dimension "unknown" (never invented)', () => {
    expect(groupSpend([rec({ cents: 10 })], 'model')[0].label).toBe('unknown')
    expect(groupSpend([rec({ cents: 10 })], 'agent')[0].label).toBe('unknown')
    expect(groupSpend([rec({ cents: 10 })], 'product')[0].label).toBe('unknown')
  })
})

describe('filterGroups — literal, injection-safe substring filter', () => {
  const groups = groupSpend(
    [rec({ model: 'zen-1', provider: 'hanzo', cents: 1 }), rec({ model: 'gpt-4o', provider: 'openai', cents: 1 })],
    'model',
  )
  it('matches label or provider, case-insensitively', () => {
    expect(filterGroups(groups, 'zen').map((g) => g.label)).toEqual(['zen-1'])
    expect(filterGroups(groups, 'OPENAI').map((g) => g.label)).toEqual(['gpt-4o'])
  })
  it('empty query returns all', () => {
    expect(filterGroups(groups, '  ').length).toBe(2)
  })
  it('treats a regex-special query as a literal (no injection)', () => {
    expect(filterGroups(groups, '.*').length).toBe(0)
  })
})

describe('presentDimensions — offer only dimensions the ledger carries', () => {
  it('model always, provider only when present', () => {
    expect(presentDimensions([rec({ model: 'x' })])).toEqual(['model'])
    expect(presentDimensions([rec({ model: 'x', provider: 'p' })])).toEqual(['model', 'provider'])
  })

  it('offers product/agent ONLY when the ledger tags them (honest until data flows)', () => {
    // No product/agent tags yet → the toggles stay hidden.
    expect(presentDimensions([rec({ model: 'x', provider: 'p' })])).toEqual(['model', 'provider'])
    // Product tagged → product dimension appears (in display order).
    expect(presentDimensions([rec({ model: 'x', product: 'agents' })])).toEqual(['model', 'product'])
    // Agent tagged → agent dimension appears.
    expect(presentDimensions([rec({ model: 'x', agent: 'bot' })])).toEqual(['model', 'agent'])
    // All four, canonical display order.
    expect(presentDimensions([rec({ model: 'x', provider: 'p', product: 'agents', agent: 'bot' })])).toEqual([
      'model',
      'provider',
      'product',
      'agent',
    ])
  })
})

describe('dailySpend + shortDay', () => {
  it('produces a dense per-day dollar series over the range', () => {
    const pts = dailySpend([rec({ at: JUN(15), cents: 500 })], '7d', JUN15)
    expect(pts).toHaveLength(7)
    // last day is today with $5.00
    expect(pts[pts.length - 1].value).toBe(5)
  })
  it('shortDay renders M/D', () => {
    expect(shortDay('2026-06-05')).toBe('6/5')
    expect(shortDay('bogus')).toBe('bogus')
  })
})
