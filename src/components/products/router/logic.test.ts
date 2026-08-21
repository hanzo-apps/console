import { describe, it, expect } from 'vitest'

import type { RouterStats } from '~/lib/api/router'
import {
  normalizeStats,
  hasActivity,
  hasPricedCost,
  moneyIndex,
  fractionPct,
  savedPctLabel,
  rewardLabel,
  shadowAgreementLabel,
  modelSlices,
  taskBreakdown,
  throughputSeries,
  retrainLine,
  hoursFor,
  ROUTER_RANGES,
} from './logic'

/**
 * The Router Overview renders ONLY real `/v1/ai/router/stats` numbers. These pin the
 * honest contract: a partial payload never throws, nullable/absent metrics read
 * "—" (never a fabricated 0), the cost is a $/MTok PROXY only when priced,
 * shadow-agreement is null → "not available", and the distributions are exact
 * counts sorted by share.
 */

const ORG_FIXTURE = {
  scope: 'org',
  org: 'maxpower',
  window: { since: '2026-07-15T00:00:00Z', until: '2026-07-16T00:00:00Z', events: 1200 },
  cost: {
    routed_index: 0.83,
    counterfactual_index: 2.1,
    saved_pct: 60.5,
    cumulative_saved_index: 1524.3,
    baseline_model: 'zen4-pro',
    priced_events: 900,
  },
  quality: { reward_rate: 0.72, rewarded_events: 340, learned_share: 0.65, avg_confidence: 0.81, shadow_agreement: null },
  by_task: {
    code: { events: 500, models: { 'zen4-coder': 300, 'qwen3-coder': 200 } },
    chat: { events: 700, models: { zen4: 700 } },
    empty: { events: 0, models: {} },
  },
  by_model: { zen4: 700, 'zen4-coder': 300, 'qwen3-coder': 200, unused: 0 },
  throughput: { per_hour: Array.from({ length: 24 }, (_, i) => i), total_window: 1200 },
  retrain: {
    version: 'v42',
    trained_time: '2026-07-15T03:00:00Z',
    events: 5000,
    gate_passed: true,
    published: true,
    gate_kind: 'holdout',
    gate_metric: 'reward',
    gate_value: 0.041,
    gate_base: 0.032,
    note: 'promoted arm-1',
  },
}

describe('normalizeStats', () => {
  it('preserves a full org payload', () => {
    const s = normalizeStats(ORG_FIXTURE)
    expect(s.scope).toBe('org')
    expect(s.org).toBe('maxpower')
    expect(s.window.events).toBe(1200)
    expect(s.cost?.routed_index).toBe(0.83)
    expect(s.cost?.counterfactual_index).toBe(2.1)
    expect(s.cost?.priced_events).toBe(900)
    expect(s.by_model.zen4).toBe(700)
    expect(s.throughput.per_hour).toHaveLength(24)
    expect(s.retrain?.published).toBe(true)
  })

  it('degrades garbage to an honest empty without throwing', () => {
    const s = normalizeStats(null)
    expect(s.window.events).toBe(0)
    expect(s.cost).toBeNull()
    expect(s.by_task).toEqual({})
    expect(s.by_model).toEqual({})
    expect(s.throughput.per_hour).toEqual([])
    expect(s.retrain).toBeNull()
    expect(hasActivity(s)).toBe(false)
  })

  it('keeps cost absent (null), never $0, when there are no priced events', () => {
    const s = normalizeStats({ ...ORG_FIXTURE, cost: undefined })
    expect(s.cost).toBeNull()
    expect(hasPricedCost(s)).toBe(false)
    expect(savedPctLabel(s)).toBe('—')
  })

  it('treats absent $ indices as null (platform scope drops the absolute levels)', () => {
    const s = normalizeStats({
      ...ORG_FIXTURE,
      scope: 'platform',
      cost: { saved_pct: 40, cumulative_saved_index: 5, baseline_model: 'arm-1', priced_events: 10 },
    })
    expect(s.cost?.routed_index).toBeNull()
    expect(s.cost?.counterfactual_index).toBeNull()
    expect(moneyIndex(s.cost?.routed_index)).toBe('—')
    expect(hasPricedCost(s)).toBe(true) // still priced → saved_pct is real
    expect(savedPctLabel(s)).toBe('40.0%')
  })
})

describe('formatters', () => {
  it('moneyIndex labels a $/MTok proxy and em-dashes null/non-finite', () => {
    expect(moneyIndex(0.83)).toBe('$0.83')
    expect(moneyIndex(2.1)).toBe('$2.10')
    expect(moneyIndex(null)).toBe('—')
    expect(moneyIndex(undefined)).toBe('—')
    expect(moneyIndex(Number.NaN)).toBe('—')
  })

  it('fractionPct rounds a 0..1 fraction to a percent', () => {
    expect(fractionPct(0.65)).toBe('65%')
    expect(fractionPct(0.814)).toBe('81%')
    expect(fractionPct(null)).toBe('—')
  })

  it('rewardLabel is a percent for a rate, raw for out-of-unit, — with no coverage', () => {
    expect(rewardLabel({ reward_rate: 0.72, rewarded_events: 340, learned_share: 0, avg_confidence: 0, shadow_agreement: null })).toBe('72%')
    expect(rewardLabel({ reward_rate: 1.4, rewarded_events: 5, learned_share: 0, avg_confidence: 0, shadow_agreement: null })).toBe('1.40')
    expect(rewardLabel({ reward_rate: 0.9, rewarded_events: 0, learned_share: 0, avg_confidence: 0, shadow_agreement: null })).toBe('—')
  })

  it('shadowAgreementLabel is null (not-available) until scored, else a percent', () => {
    expect(shadowAgreementLabel(ORG_FIXTURE.quality)).toBeNull()
    expect(
      shadowAgreementLabel({ reward_rate: 0, rewarded_events: 0, learned_share: 0, avg_confidence: 0, shadow_agreement: 0.92 }),
    ).toBe('92%')
  })
})

describe('distributions', () => {
  it('modelSlices sorts by share and drops zero counts', () => {
    const s = normalizeStats(ORG_FIXTURE)
    expect(modelSlices(s.by_model)).toEqual([
      { label: 'zen4', value: 700 },
      { label: 'zen4-coder', value: 300 },
      { label: 'qwen3-coder', value: 200 },
    ])
  })

  it('taskBreakdown orders tasks by volume, models by share, and drops empty tasks', () => {
    const s = normalizeStats(ORG_FIXTURE)
    const tb = taskBreakdown(s.by_task)
    expect(tb.map((t) => t.task)).toEqual(['chat', 'code']) // chat(700) > code(500); empty dropped
    expect(tb[1].models).toEqual([
      { label: 'zen4-coder', value: 300 },
      { label: 'qwen3-coder', value: 200 },
    ])
  })

  it('throughputSeries maps 24 buckets to UTC HH:mm labels, falls back to index', () => {
    const s = normalizeStats(ORG_FIXTURE)
    const series = throughputSeries(s)
    expect(series).toHaveLength(24)
    expect(series[0]).toEqual({ label: '00:00', value: 0 })
    expect(series[12].label).toBe('12:00')
    expect(series[12].value).toBe(12)
    // Unparseable window → 1-based index labels, values preserved.
    const bad = normalizeStats({ ...ORG_FIXTURE, window: { since: 'nope', until: 'nope', events: 3 } })
    expect(throughputSeries(bad)[0]).toEqual({ label: '1', value: 0 })
  })
})

describe('retrainLine', () => {
  it('renders the published gate verdict with the note', () => {
    const s = normalizeStats(ORG_FIXTURE)
    expect(retrainLine(s)).toBe(
      'Last retrained 2026-07-15T03:00:00Z · gate holdout reward 0.041 vs 0.032 · published — promoted arm-1',
    )
  })

  it('says "kept incumbent" when not published and the gate failed', () => {
    const s = normalizeStats({
      ...ORG_FIXTURE,
      retrain: { ...ORG_FIXTURE.retrain, published: false, gate_passed: false, note: '' },
    })
    expect(retrainLine(s)).toContain('· kept incumbent')
  })

  it('is null with no retrain block', () => {
    expect(retrainLine(normalizeStats({ ...ORG_FIXTURE, retrain: undefined }))).toBeNull()
  })
})

describe('range selector', () => {
  it('maps ranges to hours within the 90d cap', () => {
    expect(ROUTER_RANGES).toEqual(['24h', '7d', '30d'])
    expect(hoursFor('24h')).toBe(24)
    expect(hoursFor('7d')).toBe(168)
    expect(hoursFor('30d')).toBe(720)
    expect(hoursFor('30d')).toBeLessThanOrEqual(24 * 90)
  })
})
