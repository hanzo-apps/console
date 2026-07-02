import { describe, it, expect } from 'vitest'

import type { UsageRecord } from './aimetrics'
import {
  windowFor,
  inWindow,
  totalsFrom,
  delta,
  buildSeries,
  buildByModel,
  buildActivity,
  buildCloudUsageOverview,
  type AdapterParams,
} from './usage-adapter'

/**
 * The Overview adapter is a pure roll-up of the REAL commerce usage ledger into
 * the `CloudUsageOverview` shape the dashboard renders. These tests pin the
 * window math, the current-vs-prior deltas, the dense time series, the top-N +
 * "Other" spend breakdown, and the paginated activity feed — so a range/tab/page
 * change re-slices real records and never fabricates spend.
 */

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const NOW = Date.parse('2026-06-30T12:00:00Z')

/** A typed usage record (post-parse), overridable per field. */
function rec(over: Partial<UsageRecord> = {}): UsageRecord {
  return {
    id: over.id ?? 'tx',
    cents: over.cents ?? 1,
    model: over.model ?? 'zen5-mini',
    provider: over.provider ?? 'do-ai',
    product: over.product ?? '',
    agent: over.agent ?? '',
    promptTokens: over.promptTokens ?? 100,
    completionTokens: over.completionTokens ?? 50,
    totalTokens: over.totalTokens ?? 150,
    at: over.at === undefined ? NOW : over.at, // preserve an explicit null (undated)
    notes: over.notes ?? '',
    premium: over.premium ?? false,
    stream: over.stream ?? false,
    status: over.status ?? 'success',
    requestId: over.requestId ?? 'req',
  }
}

const params = (over: Partial<AdapterParams> = {}): AdapterParams => ({
  range: over.range ?? '30d',
  start: over.start,
  end: over.end,
  topModels: over.topModels ?? 6,
  activityType: over.activityType ?? 'all',
  activityLimit: over.activityLimit ?? 8,
  activityOffset: over.activityOffset ?? 0,
  now: over.now ?? NOW,
  allOrgs: over.allOrgs,
})

describe('windowFor — range → [from,to] + interval', () => {
  it('24h is the last day, hourly', () => {
    const w = windowFor(params({ range: '24h' }))
    expect(w.to).toBe(NOW)
    expect(w.from).toBe(NOW - DAY)
    expect(w.interval).toBe('hour')
  })
  it('7d / 30d are daily', () => {
    expect(windowFor(params({ range: '7d' })).from).toBe(NOW - 7 * DAY)
    expect(windowFor(params({ range: '7d' })).interval).toBe('day')
    expect(windowFor(params({ range: '30d' })).from).toBe(NOW - 30 * DAY)
  })
  it('custom parses ISO bounds and picks hour for short spans', () => {
    const w = windowFor(params({ range: 'custom', start: '2026-06-30T00:00:00Z', end: '2026-06-30T23:59:59Z' }))
    expect(w.from).toBe(Date.parse('2026-06-30T00:00:00Z'))
    expect(w.interval).toBe('hour')
  })
  it('custom accepts unix-seconds bounds and falls back to a 7d span', () => {
    const startSec = Math.floor((NOW - 3 * DAY) / 1000)
    const w = windowFor(params({ range: 'custom', start: String(startSec) }))
    expect(w.from).toBe(startSec * 1000)
    expect(w.to).toBe(NOW) // end omitted → now
    expect(w.interval).toBe('day') // 3-day span → daily
  })
})

describe('inWindow — inclusive filter, drops undated', () => {
  const records = [
    rec({ id: 'in', at: NOW - 2 * HOUR }),
    rec({ id: 'edge', at: NOW - DAY }),
    rec({ id: 'old', at: NOW - 2 * DAY }),
    rec({ id: 'undated', at: null }),
  ]
  it('keeps records inside [from,to] and drops undated', () => {
    const ids = inWindow(records, NOW - DAY, NOW).map((r) => r.id)
    expect(ids).toEqual(['in', 'edge'])
  })
})

describe('totalsFrom — spend/tokens/requests + distinct model & provider counts', () => {
  it('sums and counts distinct models/providers', () => {
    const t = totalsFrom([
      rec({ cents: 2, model: 'a', provider: 'openai', totalTokens: 100, promptTokens: 60, completionTokens: 40 }),
      rec({ cents: 3, model: 'b', provider: 'openai', totalTokens: 200 }),
      rec({ cents: 5, model: 'a', provider: 'fireworks', totalTokens: 300 }),
    ])
    expect(t.spendCents).toBe(10)
    expect(t.requests).toBe(3)
    expect(t.tokens).toBe(600)
    expect(t.models).toBe(2) // a, b
    expect(t.providers).toBe(2) // openai, fireworks
  })
  it('ignores empty model/provider in the distinct counts', () => {
    const t = totalsFrom([rec({ model: '', provider: '' })])
    expect(t.models).toBe(0)
    expect(t.providers).toBe(0)
  })
})

describe('delta — percent null when prior has no basis', () => {
  it('computes a rounded percent vs prior', () => {
    expect(delta(150, 100)).toEqual({ current: 150, prior: 100, pct: 50 })
    expect(delta(80, 100).pct).toBe(-20)
  })
  it('is null (honest "—") when prior is zero', () => {
    expect(delta(5, 0).pct).toBeNull()
  })
})

describe('buildSeries — dense, ascending, correct bucket', () => {
  it('seeds zero buckets across the window and is ascending', () => {
    const s = buildSeries([], NOW - 7 * DAY, NOW, 'day')
    expect(s.length).toBeGreaterThanOrEqual(7)
    const times = s.map((p) => Date.parse(p.t))
    expect([...times].sort((a, b) => a - b)).toEqual(times)
    expect(s.every((p) => p.tokens === 0 && p.spendCents === 0 && p.requests === 0)).toBe(true)
  })
  it('places a record in the last bucket and counts distinct models there', () => {
    const s = buildSeries(
      [rec({ at: NOW, cents: 4, totalTokens: 10, model: 'x' }), rec({ at: NOW, cents: 1, totalTokens: 5, model: 'y' })],
      NOW - DAY,
      NOW,
      'hour',
    )
    const last = s[s.length - 1]
    expect(last.spendCents).toBe(5)
    expect(last.tokens).toBe(15)
    expect(last.requests).toBe(2)
    expect(last.models).toBe(2)
  })
})

describe('buildByModel — top-N + rolled-up Other', () => {
  const records = [
    rec({ model: 'm1', cents: 10, totalTokens: 100, provider: 'p' }),
    rec({ model: 'm2', cents: 6, totalTokens: 60, provider: 'p' }),
    rec({ model: 'm3', cents: 3, totalTokens: 30, provider: 'p' }),
    rec({ model: 'm4', cents: 1, totalTokens: 10, provider: 'p' }),
  ]
  it('keeps the top-N by spend and rolls the rest into Other', () => {
    const b = buildByModel(records, 2)
    expect(b.totalCents).toBe(20)
    expect(b.items.map((i) => i.model)).toEqual(['m1', 'm2'])
    expect(b.items[0].pct).toBe(50) // 10/20
    expect(b.other).not.toBeNull()
    expect(b.other?.modelCount).toBe(2) // m3 + m4
    expect(b.other?.spendCents).toBe(4)
    expect(b.other?.pct).toBe(20) // 4/20
  })
  it('has no Other when all models fit under the cap', () => {
    expect(buildByModel(records, 10).other).toBeNull()
  })
})

describe('buildActivity — newest-first, paginated, honest-empty tabs', () => {
  const records = [
    rec({ id: 'a', at: NOW - 3 * HOUR }),
    rec({ id: 'b', at: NOW - 1 * HOUR }),
    rec({ id: 'c', at: NOW - 2 * HOUR }),
  ]
  it('sorts newest first and paginates', () => {
    const page1 = buildActivity(records, 'all', 2, 0)
    expect(page1.total).toBe(3)
    expect(page1.items.map((r) => r.requestId)).toEqual(['req', 'req']) // requestId default
    // order is by time desc: b (‑1h), c (‑2h), a (‑3h)
    const ids = buildActivity(records, 'all', 3, 0).items.map((r) => r.time)
    expect(ids[0]).toBe(new Date(NOW - HOUR).toISOString())
    const page2 = buildActivity(records, 'all', 2, 2)
    expect(page2.items).toHaveLength(1)
  })
  it('is honest-empty for non-inference tabs (ledger is inference-only)', () => {
    expect(buildActivity(records, 'deployments', 8, 0).total).toBe(0)
    expect(buildActivity(records, 'payments', 8, 0).items).toEqual([])
  })
  it('maps a record to a completed inference row', () => {
    const row = buildActivity([rec({ premium: true, stream: true, cents: 7, requestId: 'rq' })], 'inference', 8, 0).items[0]
    expect(row.type).toBe('inference')
    expect(row.status).toBe('success')
    expect(row.premium).toBe(true)
    expect(row.stream).toBe(true)
    expect(row.costCents).toBe(7)
    expect(row.requestId).toBe('rq')
  })
})

describe('buildCloudUsageOverview — end-to-end assembly', () => {
  it('rolls current + prior windows into totals, deltas, series, byModel, activity', () => {
    const all = [
      // current 24h window
      rec({ id: 'cur1', at: NOW - 2 * HOUR, cents: 5, model: 'gpt', totalTokens: 100 }),
      rec({ id: 'cur2', at: NOW - 6 * HOUR, cents: 3, model: 'zen', totalTokens: 40 }),
      // prior window (24–48h ago) — one request, 4c
      rec({ id: 'prior', at: NOW - 30 * HOUR, cents: 4, model: 'gpt', totalTokens: 20 }),
      // outside both
      rec({ id: 'old', at: NOW - 10 * DAY, cents: 99, model: 'gpt' }),
    ]
    const ov = buildCloudUsageOverview(all, params({ range: '24h', now: NOW, topModels: 6 }))
    expect(ov.interval).toBe('hour')
    expect(ov.totals.spendCents).toBe(8) // 5 + 3
    expect(ov.totals.requests).toBe(2)
    expect(ov.totals.models).toBe(2) // gpt, zen
    // spend delta: current 8 vs prior 4 → +100%
    expect(ov.deltas.spendCents).toEqual({ current: 8, prior: 4, pct: 100 })
    expect(ov.byModel.totalCents).toBe(8)
    expect(ov.byModel.items[0].model).toBe('gpt') // 5c > 3c
    expect(ov.activity.total).toBe(2)
    expect(ov.scope.allOrgs).toBe(false)
  })
})
