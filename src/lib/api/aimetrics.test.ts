import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import {
  RANGE_DAYS,
  normalizeRecord,
  normalizeUsageRecords,
  rangeStart,
  withinRange,
  totalsOf,
  dayKey,
  dailySeries,
  perModel,
  recent,
  fetchUsageRecords,
  type UsageRecord,
} from './aimetrics'

/**
 * The AI Metrics aggregations are pure functions over the REAL commerce usage
 * ledger (`GET /v1/billing/usage`). These tests pin the contract to the shape
 * `commerce/api/billing/usage.go` actually emits: positive-cents `amount`,
 * `createdAt`, and a `metadata` map with model/provider/token counts.
 */

const ONE_DAY = 24 * 60 * 60 * 1000

/** A raw commerce record, exactly as `billing.GetUsage` emits it. */
function raw(over: Partial<{ transactionId: string; amount: number; createdAt: string; model: string; provider: string; promptTokens: number; completionTokens: number; totalTokens: number; notes: string }> = {}) {
  return {
    transactionId: over.transactionId ?? 'tx_1',
    amount: over.amount ?? 1,
    currency: 'usd',
    notes: over.notes ?? 'API usage: gpt-4o-mini (1234 tokens)',
    createdAt: over.createdAt ?? '2026-06-24T12:00:00Z',
    metadata: {
      model: over.model ?? 'gpt-4o-mini',
      provider: over.provider ?? 'openai',
      promptTokens: over.promptTokens ?? 800,
      completionTokens: over.completionTokens ?? 434,
      totalTokens: over.totalTokens ?? 1234,
      requestId: 'req_x',
      premium: false,
      stream: false,
      status: 'ok',
      clientIp: '1.2.3.4',
    },
  }
}

describe('normalizeRecord — maps the commerce ledger shape', () => {
  it('reads amount as positive cents, tokens + model/provider from metadata', () => {
    const r = normalizeRecord(raw(), 0)
    expect(r.id).toBe('tx_1')
    expect(r.cents).toBe(1)
    expect(r.model).toBe('gpt-4o-mini')
    expect(r.provider).toBe('openai')
    expect(r.promptTokens).toBe(800)
    expect(r.completionTokens).toBe(434)
    expect(r.totalTokens).toBe(1234)
    expect(r.at).toBe(Date.parse('2026-06-24T12:00:00Z'))
  })

  it('takes the magnitude of a negative amount (withdraw sign-flip safety)', () => {
    expect(normalizeRecord(raw({ amount: -7 }), 0).cents).toBe(7)
  })

  it('falls back to prompt+completion when totalTokens is absent', () => {
    const r = normalizeRecord({ ...raw(), metadata: { promptTokens: 10, completionTokens: 5 } }, 0)
    expect(r.totalTokens).toBe(15)
  })

  it('degrades unknown fields to safe defaults, never throws', () => {
    const r = normalizeRecord({}, 3)
    expect(r.id).toBe('usage-3')
    expect(r.cents).toBe(0)
    expect(r.model).toBe('')
    expect(r.at).toBeNull()
  })
})

describe('normalizeUsageRecords — unwraps the commerce envelope', () => {
  it('pulls records from { usage: [...] }', () => {
    const out = normalizeUsageRecords({ user: 'maxpower', count: 2, usage: [raw(), raw({ transactionId: 'tx_2' })] })
    expect(out.map((r) => r.id)).toEqual(['tx_1', 'tx_2'])
  })
  it('accepts a bare array and an empty/garbage payload', () => {
    expect(normalizeUsageRecords([raw()])).toHaveLength(1)
    expect(normalizeUsageRecords(null)).toEqual([])
    expect(normalizeUsageRecords({ nope: true })).toEqual([])
  })
})

describe('range filtering', () => {
  const now = Date.parse('2026-06-30T00:00:00Z')
  const records: UsageRecord[] = [
    { ...normalizeRecord(raw(), 0), at: now - 2 * ONE_DAY }, // inside 7d/30d, outside 24h
    { ...normalizeRecord(raw(), 1), at: now - 10 * ONE_DAY }, // inside 30d only
    { ...normalizeRecord(raw(), 2), at: now - 40 * ONE_DAY }, // outside all
    { ...normalizeRecord(raw(), 3), at: null }, // undated — dropped from windows
  ]

  it('rangeStart is now minus the window length', () => {
    expect(rangeStart('7d', now)).toBe(now - 7 * ONE_DAY)
  })

  it('24h keeps only the last day', () => {
    expect(withinRange(records, '24h', now)).toHaveLength(0)
  })
  it('7d keeps records within a week, drops undated', () => {
    expect(withinRange(records, '7d', now).map((r) => r.at)).toEqual([now - 2 * ONE_DAY])
  })
  it('30d keeps the month, excludes the 40-day-old + undated', () => {
    expect(withinRange(records, '30d', now)).toHaveLength(2)
  })
})

describe('totalsOf — window totals for the stat tiles', () => {
  it('counts requests and sums tokens + cents', () => {
    const recs = [normalizeRecord(raw({ amount: 2 }), 0), normalizeRecord(raw({ amount: 3, promptTokens: 100, completionTokens: 50, totalTokens: 150 }), 1)]
    const t = totalsOf(recs)
    expect(t.requests).toBe(2)
    expect(t.cents).toBe(5)
    expect(t.totalTokens).toBe(1234 + 150)
    expect(t.promptTokens).toBe(800 + 100)
  })
  it('is all-zero for no usage (honest empty)', () => {
    expect(totalsOf([])).toEqual({ requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, cents: 0 })
  })
})

describe('dailySeries — dense per-day series with zero-days', () => {
  const now = Date.parse('2026-06-30T18:00:00Z')
  it('seeds every day in the window even with no data', () => {
    const s = dailySeries([], '7d', now)
    expect(s).toHaveLength(RANGE_DAYS['7d'])
    expect(s.every((b) => b.requests === 0 && b.tokens === 0 && b.cents === 0)).toBe(true)
  })
  it('is ascending and ends on today', () => {
    const s = dailySeries([], '30d', now)
    expect(s).toHaveLength(30)
    expect(s[s.length - 1].day).toBe(dayKey(now))
    expect([...s].sort((a, b) => a.day.localeCompare(b.day)).map((b) => b.day)).toEqual(s.map((b) => b.day))
  })
  it('buckets a record onto its own day', () => {
    const today = normalizeRecord(raw({ amount: 4 }), 0)
    today.at = now
    const s = dailySeries([today], '7d', now)
    const last = s[s.length - 1]
    expect(last.requests).toBe(1)
    expect(last.cents).toBe(4)
    expect(last.tokens).toBe(1234)
  })
})

describe('perModel — rollup sorted by spend', () => {
  it('groups by model and sorts costliest first', () => {
    const recs = [
      normalizeRecord(raw({ model: 'gpt-4o-mini', amount: 1 }), 0),
      normalizeRecord(raw({ model: 'gpt-4o', amount: 9, provider: 'openai' }), 1),
      normalizeRecord(raw({ model: 'gpt-4o-mini', amount: 1 }), 2),
    ]
    const rows = perModel(recs)
    expect(rows[0].model).toBe('gpt-4o')
    expect(rows[0].cents).toBe(9)
    expect(rows[1].model).toBe('gpt-4o-mini')
    expect(rows[1].requests).toBe(2)
    expect(rows[1].cents).toBe(2)
  })
})

describe('recent — newest first, capped', () => {
  it('orders by timestamp desc and caps to n', () => {
    const a = normalizeRecord(raw({ transactionId: 'a', createdAt: '2026-06-01T00:00:00Z' }), 0)
    const b = normalizeRecord(raw({ transactionId: 'b', createdAt: '2026-06-20T00:00:00Z' }), 1)
    const c = normalizeRecord(raw({ transactionId: 'c', createdAt: '2026-06-10T00:00:00Z' }), 2)
    expect(recent([a, b, c], 2).map((r) => r.id)).toEqual(['b', 'c'])
  })
})

describe('fetchUsageRecords — through the per-tenant /billing proxy', () => {
  const ORIGIN = 'https://console.hanzo.ai'
  const fetched: string[] = []
  beforeEach(() => {
    fetched.length = 0
    ;(globalThis as { window?: unknown }).window = {
      location: { origin: ORIGIN, hostname: 'console.hanzo.ai' },
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    }
    vi.stubGlobal('fetch', (url: string) => {
      fetched.push(url)
      return Promise.resolve(new Response(JSON.stringify({ user: 'maxpower', count: 1, usage: [raw()] }), { status: 200, headers: { 'content-type': 'application/json' } }))
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete (globalThis as { window?: unknown }).window
  })

  it('hits the same-origin /billing/usage proxy (never commerce directly)', async () => {
    const recs = await fetchUsageRecords()
    expect(fetched[0]).toBe(`${ORIGIN}/billing/usage`)
    expect(recs).toHaveLength(1)
    expect(recs[0].model).toBe('gpt-4o-mini')
  })
})
