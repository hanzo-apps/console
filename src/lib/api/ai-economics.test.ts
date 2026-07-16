import { describe, it, expect } from 'vitest'
import {
  foldModelMix,
  topModelShares,
  marginTone,
  marginPctLabel,
  datasetStats,
  recentRuns,
  fmtScore,
  type ModelMix,
} from './ai-economics'
import type { FundingRow } from './provider-billing'
import type { EvalDataset, EvalDatasetRun } from './evals'

const row = (provider: string, model: string, funding: string, requests: number, tokens = 0, costCents = 0): FundingRow => ({
  provider,
  model,
  funding,
  tokens,
  costCents,
  requests,
})

describe('foldModelMix — request mix by (provider, model)', () => {
  it('sums ACROSS funding classes for the same provider+model', () => {
    const mix = foldModelMix([
      row('do-ai', 'fable-5', 'credit', 700, 1000, 200),
      row('do-ai', 'fable-5', 'paid', 300, 500, 100), // same model, different funding
    ])
    expect(mix.rows).toHaveLength(1)
    expect(mix.rows[0]).toMatchObject({ provider: 'do-ai', model: 'fable-5', requests: 1000, tokens: 1500, costCents: 300 })
    expect(mix.models).toBe(1)
    expect(mix.providers).toBe(1)
  })

  it('computes request-share (0..1) that sums to 1 across rows', () => {
    const mix = foldModelMix([
      row('do-ai', 'fable-5', 'credit', 750),
      row('openrouter', 'gpt-5.6', 'paid', 200),
      row('openrouter', 'ds4-flash', 'paid', 50),
    ])
    expect(mix.total.requests).toBe(1000)
    expect(mix.rows[0]).toMatchObject({ model: 'fable-5', requests: 750, requestShare: 0.75 })
    const shareSum = mix.rows.reduce((s, r) => s + r.requestShare, 0)
    expect(shareSum).toBeCloseTo(1, 10)
  })

  it('sorts by requests desc, then cost desc', () => {
    const mix = foldModelMix([
      row('p', 'low', 'paid', 10, 0, 5),
      row('p', 'high', 'paid', 100, 0, 1),
      row('p', 'mid-a', 'paid', 50, 0, 9),
      row('p', 'mid-b', 'paid', 50, 0, 90),
    ])
    expect(mix.rows.map((r) => r.model)).toEqual(['high', 'mid-b', 'mid-a', 'low'])
  })

  it('counts distinct providers', () => {
    const mix = foldModelMix([row('a', 'm1', 'paid', 1), row('b', 'm2', 'paid', 1), row('a', 'm3', 'paid', 1)])
    expect(mix.providers).toBe(2)
    expect(mix.models).toBe(3)
  })

  it('empty rows → zero total, no rows, share never NaN', () => {
    const mix = foldModelMix([])
    expect(mix.rows).toEqual([])
    expect(mix.total).toEqual({ requests: 0, tokens: 0, costCents: 0 })
    expect(mix.models).toBe(0)
  })

  it('all-zero requests → share is 0, not NaN', () => {
    const mix = foldModelMix([row('p', 'm', 'paid', 0, 100, 10)])
    expect(mix.rows[0].requestShare).toBe(0)
    expect(Number.isNaN(mix.rows[0].requestShare)).toBe(false)
  })
})

describe('topModelShares — top-N by requests, model across providers, Other fold', () => {
  const mix: ModelMix = foldModelMix([
    row('do-ai', 'fable-5', 'credit', 500),
    row('azure', 'fable-5', 'paid', 100), // SAME model name across providers → merged
    row('openrouter', 'gpt-5.6', 'paid', 200),
    row('openrouter', 'ds4-flash', 'paid', 40),
    row('openrouter', 'ds4-pro', 'paid', 30),
    row('x', 'tiny', 'paid', 5),
  ])

  it('aggregates a model across providers into one slice', () => {
    const slices = topModelShares(mix, 6)
    const fable = slices.find((s) => s.label === 'fable-5')
    expect(fable?.value).toBe(600) // 500 + 100
  })

  it('folds the tail into a single Other slice when > topN', () => {
    const slices = topModelShares(mix, 2)
    expect(slices.map((s) => s.label)).toEqual(['fable-5', 'gpt-5.6', 'Other'])
    // Other = ds4-flash + ds4-pro + tiny = 40 + 30 + 5
    expect(slices[2].value).toBe(75)
  })

  it('no Other slice when models ≤ topN', () => {
    const slices = topModelShares(mix, 10)
    expect(slices.some((s) => s.label === 'Other')).toBe(false)
  })

  it('empty mix → []', () => {
    expect(topModelShares(foldModelMix([]))).toEqual([])
  })
})

describe('marginTone / marginPctLabel', () => {
  it('tones margin by health band', () => {
    expect(marginTone(62)).toBe('ok')
    expect(marginTone(50)).toBe('ok')
    expect(marginTone(20)).toBe('warn')
    expect(marginTone(0)).toBe('warn')
    expect(marginTone(-8)).toBe('crit')
  })
  it('labels a signed rounded percent, — for null/NaN', () => {
    expect(marginPctLabel(61.7)).toBe('+62%')
    expect(marginPctLabel(-8.2)).toBe('-8%')
    expect(marginPctLabel(0)).toBe('0%')
    expect(marginPctLabel(null)).toBe('—')
    expect(marginPctLabel(Infinity)).toBe('—')
  })
})

describe('datasetStats — honest training-data tally', () => {
  it('counts datasets and sums item counts', () => {
    const datasets: EvalDataset[] = [
      { name: 'a', items: 120 },
      { name: 'b', items: 30 },
      { name: 'c' }, // no item count → contributes 0
    ]
    expect(datasetStats(datasets)).toEqual({ datasets: 3, items: 150 })
  })
  it('empty registry → zeros', () => {
    expect(datasetStats([])).toEqual({ datasets: 0, items: 0 })
  })
})

describe('recentRuns — newest first, undated last, capped', () => {
  const runs: EvalDatasetRun[] = [
    { runName: 'old', createdAt: '2026-07-01T00:00:00Z' },
    { runName: 'new', createdAt: '2026-07-10T00:00:00Z' },
    { runName: 'mid', createdAt: '2026-07-05T00:00:00Z' },
    { runName: 'undated' },
  ]
  it('orders by createdAt desc with undated sorted last', () => {
    expect(recentRuns(runs).map((r) => r.runName)).toEqual(['new', 'mid', 'old', 'undated'])
  })
  it('caps at n', () => {
    expect(recentRuns(runs, 2).map((r) => r.runName)).toEqual(['new', 'mid'])
  })
})

describe('fmtScore', () => {
  it('formats a 0..1 judge score as a percent', () => {
    expect(fmtScore(0.87)).toBe('87%')
    expect(fmtScore(1)).toBe('100%')
    expect(fmtScore(0)).toBe('0%')
  })
  it('formats an out-of-[0,1] scale to 2 dp', () => {
    expect(fmtScore(4.25)).toBe('4.25')
  })
  it('null / non-finite → em dash', () => {
    expect(fmtScore(null)).toBe('—')
    expect(fmtScore(undefined)).toBe('—')
    expect(fmtScore(NaN)).toBe('—')
  })
})
