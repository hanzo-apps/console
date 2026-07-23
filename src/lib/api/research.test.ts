import { describe, expect, it } from 'vitest'

import { normalizeExperiments, normalizeMeta, normalizeTotals } from './research'

describe('normalizeExperiments', () => {
  it('reads the real `{data,total}` ledger payload (snake_case, as cloud emits)', () => {
    // The golden shape is exactly what the Rust/Python SDKs stamp for a concluded
    // refutation (ml/hanzo-research `Meta`) — meta is a NESTED object, not a string.
    const rows = normalizeExperiments({
      data: [
        {
          project: 'hanzo-engine',
          id: 'kernel-perf:matvec_q4k_f32_blk:vulkan/6144x2048',
          kind: 'kernel-perf',
          subject: 'matvec_q4k_f32_blk',
          task: 'vulkan/6144x2048',
          metric: 'ratio_vs_hand',
          value: 0.79,
          n: 0,
          n_total: 0,
          cost_usd: 0,
          status: 'complete',
          ts: 1_753_000_000,
          meta: {
            doc: '',
            commits: ['fix x', 'tune y'],
            note: 'cold A/B',
            host: { hostname: 'evo', platform: 'Linux' },
            hypothesis: 'the DSL f32-direct matvec beats the hand kernel',
            predict: 'DSL/hand >= 1.0 cold in-engine at the dominant FFN shape',
            verdict: 'refuted',
            because: '0.79x at 6144 rows — memory-BW wall, not craft',
            log: ['cold in-engine A/B, evo gfx1151, 3 runs, bit-exact 2.3e-6'],
          },
        },
      ],
      total: 1,
    })
    expect(rows).toHaveLength(1)
    const e = rows[0]
    expect(e.kind).toBe('kernel-perf')
    expect(e.subject).toBe('matvec_q4k_f32_blk')
    expect(e.value).toBe(0.79)
    expect(e.meta.verdict).toBe('refuted')
    expect(e.meta.hypothesis).toContain('DSL')
    expect(e.meta.log).toEqual(['cold in-engine A/B, evo gfx1151, 3 runs, bit-exact 2.3e-6'])
    expect(e.meta.host).toBe('evo')
    expect(e.meta.commits).toEqual(['fix x', 'tune y'])
  })

  it('parses a `meta` that arrives as a JSON STRING (defensive)', () => {
    const m = normalizeMeta(JSON.stringify({ verdict: 'PROVEN', hypothesis: 'H', log: 'single-line' }))
    expect(m.verdict).toBe('proven') // clamped + lowercased
    expect(m.hypothesis).toBe('H')
    expect(m.log).toEqual(['single-line']) // a single string degrades to a one-element list
  })

  it('clamps an unknown verdict to the honest unconcluded value', () => {
    expect(normalizeMeta({ verdict: 'faulted' }).verdict).toBe('')
    expect(normalizeMeta({}).verdict).toBe('')
    expect(normalizeMeta({ verdict: 'inconclusive' }).verdict).toBe('inconclusive')
  })

  it('tolerates a bare array + camelCase and drops non-finite values to zero', () => {
    const rows = normalizeExperiments([{ id: 'a', subject: 's', value: NaN, nTotal: '12', costUsd: Infinity }])
    expect(rows[0].value).toBe(0)
    expect(rows[0].nTotal).toBe(12) // numeric string coerced
    expect(rows[0].costUsd).toBe(0)
  })

  it('is honest on empty / garbage — an empty list, never a throw', () => {
    for (const bad of [null, undefined, {}, 'nope', 42, { data: null }]) {
      expect(normalizeExperiments(bad)).toEqual([])
    }
  })
})

describe('normalizeTotals', () => {
  it('reads the real bare totals object (snake_case by_kind + cost_usd)', () => {
    const t = normalizeTotals({
      projects: 1,
      experiments: 9,
      attempts: 0,
      models: 0,
      benchmarks: 0,
      cost_usd: 0,
      by_kind: [{ kind: 'kernel-perf', experiments: 9, cost_usd: 0 }],
    })
    expect(t.experiments).toBe(9)
    expect(t.projects).toBe(1)
    expect(t.byKind).toHaveLength(1)
    expect(t.byKind[0].kind).toBe('kernel-perf')
    expect(t.byKind[0].experiments).toBe(9)
  })

  it('is honest on empty / garbage — zeros + empty by-kind, never a throw', () => {
    for (const bad of [null, undefined, {}, 'nope', 42, []]) {
      const t = normalizeTotals(bad)
      expect(t.experiments).toBe(0)
      expect(t.projects).toBe(0)
      expect(t.byKind).toEqual([])
    }
  })
})
