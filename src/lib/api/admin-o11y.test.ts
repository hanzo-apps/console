import { describe, expect, it } from 'vitest'

import { normalizeFleetO11y } from './admin-o11y'

describe('normalizeFleetO11y', () => {
  it('reads the real cross-org payload (camelCase, as cloud emits)', () => {
    const d = normalizeFleetO11y({
      range: '7d',
      start: '2026-06-27T00:00:00Z',
      end: '2026-07-04T00:00:00Z',
      totals: {
        requests: 274, tokens: 102597, promptTokens: 60000, completionTokens: 42597,
        costCents: 216, errors: 41, orgs: 3, models: 42,
        traceCount: 4044354, latencyP50Ms: 12.5, latencyP95Ms: 340.2, latencyP99Ms: 901.7,
        traceErrorRate: 1.25, services: 8, logVolume: 38650449,
      },
      series: [{ ts: '2026-07-04 06:00:00', requests: 23, tokens: 3025, costCents: 18, errors: 1 }],
      logSeries: [{ ts: '2026-07-04 06:00:00', count: 1163604 }],
      topOrgs: [{ org: 'hanzo', requests: 154, tokens: 38966, costCents: 114 }],
      topModels: [{ model: 'zen-nano', requests: 100, tokens: 5000, costCents: 20 }],
      topServices: [{ service: 'ingress', requests: 308125, errorRate: 45.56, latencyP95Ms: 38.5 }],
      llm: { generations: 3, costUsd: 0.0000051 },
    })
    expect(d.range).toBe('7d')
    expect(d.totals.requests).toBe(274)
    expect(d.totals.logVolume).toBe(38650449)
    expect(d.totals.latencyP95Ms).toBe(340.2)
    expect(d.topOrgs[0].org).toBe('hanzo')
    expect(d.topServices[0].errorRate).toBeCloseTo(45.56)
    expect(d.llm.generations).toBe(3)
  })

  it('tolerates snake_case field variants', () => {
    const d = normalizeFleetO11y({
      totals: { cost_cents: 500, prompt_tokens: 100, completion_tokens: 50, trace_count: 9, log_volume: 7, trace_error_rate: 2.5 },
      log_series: [{ ts: 't', c: 12 }],
      top_orgs: [{ organization: 'acme', cost_cents: 9 }],
      top_services: [{ serviceName: 'gateway', error_rate: 0, p95: 8.3 }],
      llm: { cost: 1.5 },
    })
    expect(d.totals.costCents).toBe(500)
    expect(d.totals.promptTokens).toBe(100)
    expect(d.totals.traceCount).toBe(9)
    expect(d.logSeries[0].count).toBe(12)
    expect(d.topOrgs[0].org).toBe('acme')
    expect(d.topServices[0].service).toBe('gateway')
    expect(d.topServices[0].latencyP95Ms).toBe(8.3)
    expect(d.llm.costUsd).toBe(1.5)
  })

  it('is honest on an empty / garbage payload — zeros + empty arrays, never a throw', () => {
    for (const bad of [null, undefined, {}, 'nope', 42, []]) {
      const d = normalizeFleetO11y(bad)
      expect(d.range).toBe('30d')
      expect(d.totals.requests).toBe(0)
      expect(d.totals.logVolume).toBe(0)
      expect(d.series).toEqual([])
      expect(d.topOrgs).toEqual([])
      expect(d.topServices).toEqual([])
      expect(d.llm.generations).toBe(0)
    }
  })

  it('drops NaN / non-finite numbers to honest zero', () => {
    const d = normalizeFleetO11y({ totals: { requests: NaN, costCents: Infinity, tokens: '1200' } })
    expect(d.totals.requests).toBe(0)
    expect(d.totals.costCents).toBe(0)
    expect(d.totals.tokens).toBe(1200) // numeric string coerced
  })
})
