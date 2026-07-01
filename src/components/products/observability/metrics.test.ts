import { describe, it, expect } from 'vitest'

import {
  METRICS_RANGE_DAYS,
  toMs,
  rangeStart,
  withinRange,
  traceAt,
  observationAt,
  scoreAt,
  percentile,
  totals,
  dailySeries,
  modelBreakdown,
  scoreSummary,
} from './metrics'
import type { Observation, Score, Trace } from '~/lib/api'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 5, 15, 12, 0, 0) // fixed clock for deterministic buckets
const iso = (ms: number): string => new Date(ms).toISOString()

const trace = (over: Partial<Trace> = {}): Trace =>
  ({
    id: 'tr',
    timestamp: iso(NOW),
    name: null,
    userId: null,
    sessionId: null,
    environment: 'default',
    release: null,
    version: null,
    tags: [],
    public: false,
    bookmarked: false,
    ...over,
  }) as Trace

const obs = (over: Partial<Observation> = {}): Observation =>
  ({
    id: 'ob',
    traceId: 'tr',
    parentObservationId: null,
    name: null,
    type: 'GENERATION',
    startTime: iso(NOW),
    endTime: null,
    level: 'DEFAULT',
    statusMessage: null,
    model: null,
    ...over,
  }) as Observation

const score = (over: Partial<Score> = {}): Score =>
  ({
    id: 'sc',
    name: 'quality',
    value: 1,
    dataType: 'NUMERIC',
    source: 'API',
    comment: null,
    timestamp: iso(NOW),
    traceId: 'tr',
    configId: null,
    ...over,
  }) as Score

describe('toMs', () => {
  it('parses ISO timestamps and rejects missing/garbage', () => {
    expect(toMs(iso(NOW))).toBe(NOW)
    expect(toMs(null)).toBeNull()
    expect(toMs(undefined)).toBeNull()
    expect(toMs('not-a-date')).toBeNull()
  })
})

describe('rangeStart / withinRange', () => {
  it('computes the inclusive lower bound per range', () => {
    expect(rangeStart('24h', NOW)).toBe(NOW - DAY)
    expect(rangeStart('7d', NOW)).toBe(NOW - 7 * DAY)
    expect(rangeStart('30d', NOW)).toBe(NOW - 30 * DAY)
    expect(METRICS_RANGE_DAYS).toEqual({ '24h': 1, '7d': 7, '30d': 30 })
  })

  it('keeps in-window rows, drops out-of-window and undated', () => {
    const rows = [
      trace({ id: 'in', timestamp: iso(NOW - 2 * DAY) }),
      trace({ id: 'old', timestamp: iso(NOW - 20 * DAY) }),
      trace({ id: 'undated', timestamp: null }),
    ]
    const kept = withinRange(rows, traceAt, '7d', NOW)
    expect(kept.map((t) => t.id)).toEqual(['in'])
  })

  it('exposes null-safe accessors for each row kind', () => {
    expect(traceAt(trace({ timestamp: iso(NOW) }))).toBe(NOW)
    expect(observationAt(obs({ startTime: iso(NOW) }))).toBe(NOW)
    expect(scoreAt(score({ timestamp: iso(NOW) }))).toBe(NOW)
    expect(traceAt(trace({ timestamp: null }))).toBeNull()
  })
})

describe('percentile', () => {
  it('returns null on empty input (honest — no fabricated value)', () => {
    expect(percentile([], 95)).toBeNull()
  })
  it('computes nearest-rank percentiles', () => {
    const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    expect(percentile(v, 95)).toBe(10)
    expect(percentile(v, 50)).toBe(5)
    expect(percentile([0.4], 95)).toBe(0.4)
  })
})

describe('totals', () => {
  it('sums cost, tokens, and derives avg + p95 latency', () => {
    const traces = [
      trace({ totalCost: 0.01, latency: 1 }),
      trace({ totalCost: 0.03, latency: 3 }),
      trace({ totalCost: null, latency: null }), // partial rows degrade, never throw
    ]
    const observations = [
      obs({ usage: { unit: 'TOKENS', input: 10, output: 5, total: 15 } }),
      obs({ usage: { unit: 'TOKENS', input: 20, output: 5, total: 25 } }),
      obs({}), // no usage → 0 tokens
    ]
    const t = totals(traces, observations)
    expect(t.traces).toBe(3)
    expect(t.cost).toBeCloseTo(0.04)
    expect(t.tokens).toBe(40)
    expect(t.avgLatency).toBeCloseTo(2)
    expect(t.p95Latency).toBe(3)
  })

  it('rolls empty input up to zeros / null latency (honest-empty)', () => {
    expect(totals([], [])).toEqual({ traces: 0, cost: 0, tokens: 0, avgLatency: null, p95Latency: null })
  })
})

describe('dailySeries', () => {
  it('produces a dense zero-filled series and sums rows into the right day', () => {
    const traces = [
      trace({ timestamp: iso(NOW) }),
      trace({ timestamp: iso(NOW - DAY) }),
      trace({ timestamp: iso(NOW - DAY) }),
      trace({ timestamp: null }), // undated → dropped from the axis
    ]
    const series = dailySeries(traces, traceAt, () => 1, '7d', NOW)
    expect(series).toHaveLength(7) // one point per day, no gaps
    expect(series[series.length - 1].value).toBe(1) // today
    expect(series[series.length - 2].value).toBe(2) // yesterday
    expect(series.slice(0, 5).every((p) => p.value === 0)).toBe(true) // empty days honest-zero
  })

  it('sums a value extractor (e.g. cost) rather than counting', () => {
    const traces = [trace({ timestamp: iso(NOW), totalCost: 0.5 }), trace({ timestamp: iso(NOW), totalCost: 0.25 })]
    const series = dailySeries(traces, traceAt, (t) => t.totalCost ?? 0, '24h', NOW)
    expect(series[series.length - 1].value).toBeCloseTo(0.75)
  })
})

describe('modelBreakdown', () => {
  it('groups observations by model with token sums, sorted by volume', () => {
    const observations = [
      obs({ model: 'zen-1', usage: { unit: 'TOKENS', input: 1, output: 1, total: 10 } }),
      obs({ model: 'zen-1', usage: { unit: 'TOKENS', input: 1, output: 1, total: 20 } }),
      obs({ model: 'gpt-4o', usage: { unit: 'TOKENS', input: 1, output: 1, total: 5 } }),
      obs({ model: null }), // unnamed model bucketed honestly as 'unknown'
    ]
    const rows = modelBreakdown(observations)
    expect(rows[0]).toEqual({ model: 'zen-1', observations: 2, tokens: 30 })
    expect(rows.map((r) => r.model)).toEqual(['zen-1', 'gpt-4o', 'unknown'])
  })
  it('is empty for no observations', () => {
    expect(modelBreakdown([])).toEqual([])
  })
})

describe('scoreSummary', () => {
  it('averages numeric scores and leaves non-numeric averages null', () => {
    const scores = [
      score({ name: 'quality', dataType: 'NUMERIC', value: 1 }),
      score({ name: 'quality', dataType: 'NUMERIC', value: 3 }),
      score({ name: 'sentiment', dataType: 'CATEGORICAL', value: 0, stringValue: 'positive' }),
    ]
    const rows = scoreSummary(scores)
    const quality = rows.find((r) => r.name === 'quality')
    const sentiment = rows.find((r) => r.name === 'sentiment')
    expect(quality).toEqual({ name: 'quality', dataType: 'NUMERIC', count: 2, average: 2 })
    expect(sentiment).toEqual({ name: 'sentiment', dataType: 'CATEGORICAL', count: 1, average: null })
  })
  it('sorts by count desc and is empty for no scores', () => {
    const rows = scoreSummary([
      score({ name: 'a' }),
      score({ name: 'b' }),
      score({ name: 'b' }),
    ])
    expect(rows.map((r) => r.name)).toEqual(['b', 'a'])
    expect(scoreSummary([])).toEqual([])
  })
})
