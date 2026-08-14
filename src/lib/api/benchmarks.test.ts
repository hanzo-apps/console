/**
 * Benchmark corpus reader. The tests that matter here are about HONESTY: the join
 * must never attach a real score to the wrong model, and an unmeasured model must
 * come back with nothing rather than a zero.
 */
import { describe, expect, it } from 'vitest'

import {
  allPriors,
  BENCHMARK_IDS,
  benchmarkLabel,
  coverage,
  isEnsoModel,
  leaderboard,
  normalizeModelKey,
  priorFor,
  scoreFor,
  sourceClass,
  vendors,
} from './benchmarks'

describe('normalizeModelKey', () => {
  it('folds the corpus spelling variants of one model onto one key', () => {
    const key = normalizeModelKey('gpt-5.2')
    expect(normalizeModelKey('/gpt-5.2')).toBe(key)
    expect(normalizeModelKey('openai-gpt-5.2')).toBe(key)
    expect(normalizeModelKey('openai/gpt-5.2')).toBe(key)
    expect(normalizeModelKey('GPT-5.2')).toBe(key)
  })

  it('keeps vendor-rooted model names intact — deepseek/kimi/minimax are NOT prefixes', () => {
    expect(normalizeModelKey('deepseek-3.2')).toBe('deepseek-3.2')
    expect(normalizeModelKey('deepseek/deepseek-v4-pro')).toBe('deepseek-v4-pro')
    expect(normalizeModelKey('kimi/kimi-k2.6')).toBe('kimi-k2.6')
    expect(normalizeModelKey('minimax/minimax-m2.5')).toBe('minimax-m2.5')
  })

  it('strips a dated-snapshot suffix and dots a dashed version pair', () => {
    expect(normalizeModelKey('/claude-opus-4-8')).toBe('claude-opus-4.8')
    expect(normalizeModelKey('/claude-opus-4-5-20251101')).toBe('claude-opus-4.5')
  })

  it('does not dot a dash that is not a version pair', () => {
    expect(normalizeModelKey('gpt-5-mini')).toBe('gpt-5-mini')
    expect(normalizeModelKey('nvidia-nemotron-3-super-120b')).toBe('nemotron-3-super-120b')
  })

  it('is empty for empty input', () => {
    expect(normalizeModelKey('')).toBe('')
    expect(normalizeModelKey('   ')).toBe('')
  })
})

describe('the corpus', () => {
  it('loaded models and benchmarks', () => {
    expect(allPriors().length).toBeGreaterThan(50)
    expect(BENCHMARK_IDS.length).toBeGreaterThan(5)
    expect(BENCHMARK_IDS).toContain('gpqa_diamond')
  })

  it('labels benchmarks, falling back to the id', () => {
    expect(benchmarkLabel('gpqa_diamond')).toBe('GPQA-Diamond')
    expect(benchmarkLabel('not_a_benchmark')).toBe('not_a_benchmark')
  })

  it('carries a source string on every single score — nothing is unattributed', () => {
    for (const m of allPriors()) {
      for (const [bench, s] of Object.entries(m.scores)) {
        expect(typeof s.value, `${m.model}/${bench}`).toBe('number')
        expect(s.source, `${m.model}/${bench}`).toBeTruthy()
      }
    }
  })

  it('lists vendors alphabetically', () => {
    const v = vendors()
    expect(v).toContain('OpenAI')
    expect([...v].sort((a, b) => a.localeCompare(b))).toEqual(v)
  })
})

describe('priorFor / scoreFor', () => {
  it('resolves a model by its canonical corpus name', () => {
    const p = priorFor('gpt-5.6-sol')
    expect(p?.vendor).toBe('OpenAI')
    expect(p?.scores.gpqa_diamond?.value).toBe(90.4)
    expect(p?.scores.gpqa_diamond?.source).toBe('hanzo-measured')
  })

  it('resolves a LIVE gateway id through the arms.py alias map', () => {
    // arms.py maps canonical `qwen3-32b` to gateway id `alibaba-qwen3-32b`.
    expect(priorFor('alibaba-qwen3-32b')?.scores.mmlu_pro?.value).toBe(79.8)
    // …and canonical `opus-4.1` to `anthropic-claude-4.1-opus`.
    expect(priorFor('anthropic-claude-4.1-opus')).not.toBeNull()
  })

  it('returns null for a model with no published score — never a zero', () => {
    expect(priorFor('a-model-nobody-has-benchmarked')).toBeNull()
    expect(scoreFor('a-model-nobody-has-benchmarked', 'gpqa_diamond')).toBeNull()
    expect(scoreFor('gpt-5.6-sol', 'not_a_benchmark')).toBeNull()
  })

  it('prefers our own harness when two spellings disagree on the same benchmark', () => {
    for (const m of allPriors()) {
      const s = priorFor(m.model)?.scores.gpqa_diamond
      if (s && m.scores.gpqa_diamond?.source === 'hanzo-measured') {
        expect(s.source).toBe('hanzo-measured')
      }
    }
  })
})

describe('sourceClass — the measured-vs-reported binary', () => {
  it('classes only the literal `hanzo-measured` as our own harness', () => {
    expect(sourceClass('hanzo-measured')).toBe('measured')
  })

  it('classes every vendor/third-party source as reported, however reputable', () => {
    for (const s of [
      'provider-reported',
      'Vals AI',
      'Vals AI — GPQA Diamond leaderboard',
      'Artificial Analysis',
      'do-catalog',
      'OpenAI — Introducing GPT-5',
    ]) {
      expect(sourceClass(s), s).toBe('reported')
    }
  })

  it('every corpus score classes into exactly one of the two', () => {
    for (const m of allPriors()) {
      for (const s of Object.values(m.scores)) {
        expect(['measured', 'reported']).toContain(sourceClass(s.source))
      }
    }
  })
})

describe('the Enso family — synced in, honest numbers, differentiated', () => {
  it('recognizes the three tiers and nothing else', () => {
    expect(isEnsoModel('enso')).toBe(true)
    expect(isEnsoModel('enso-flash')).toBe(true)
    expect(isEnsoModel('enso-ultra')).toBe(true)
    expect(isEnsoModel('ensoteric')).toBe(false) // not a tier — must not false-match
    expect(isEnsoModel('zen5-flash')).toBe(false)
    expect(isEnsoModel('gpt-5.6-sol')).toBe(false)
  })

  it('carries the measured GPQA-Diamond numbers, monotonic Ultra > Pro > Flash', () => {
    const ultra = priorFor('enso-ultra')?.scores.gpqa_diamond
    const pro = priorFor('enso')?.scores.gpqa_diamond
    const flash = priorFor('enso-flash')?.scores.gpqa_diamond
    expect(ultra?.value).toBe(98.0)
    expect(pro?.value).toBe(96.0)
    expect(flash?.value).toBe(92.9)
    // Every tier is our own harness, and the family is strictly monotonic in quality.
    for (const s of [ultra, pro, flash]) expect(s?.source).toBe('hanzo-measured')
    expect(ultra!.value).toBeGreaterThan(pro!.value)
    expect(pro!.value).toBeGreaterThan(flash!.value)
  })

  it('ranks on merit in the GPQA board — by the corpus, not by a thumb', () => {
    const board = leaderboard('gpqa_diamond')
    const ultra = board.find((r) => r.model === 'enso-ultra')
    expect(ultra).toBeDefined()
    // Ultra now tops this board. It is placed there by sorting the corpus, which
    // is the only thing this test can defend: rank follows the number, and the
    // number is the router's, not a thumb on the scale.
    //
    // What the rank does NOT say is that the comparison is like-for-like. Ultra's
    // 98.0 is observed-REPLAY routing over this exact question set; the rows under
    // it are one-shot vendor scores. Sitting at #1 on that basis is a claim about
    // a recurring workload, not about answering an unseen question — the router
    // says so itself, and enso-bench's own held-out generalization run came back
    // NULL. If this board is ever read as the latter, the fix is a column that
    // says which rows are replayed, not a smaller number here.
    const top = board.filter((r) => r.rank === 1).map((r) => r.model)
    expect(top).toContain('enso-ultra')
    expect(ultra!.score.value).toBeGreaterThanOrEqual(board[1]!.score.value)
  })
})

describe('leaderboard', () => {
  it('ranks by score, best first, with 1-based ranks', () => {
    const rows = leaderboard('gpqa_diamond')
    expect(rows.length).toBeGreaterThan(3)
    expect(rows[0]!.rank).toBe(1)
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1]!.score.value).toBeGreaterThanOrEqual(rows[i]!.score.value)
      expect(rows[i]!.rank).toBe(i + 1)
    }
  })

  it('OMITS unscored models rather than ranking them last with a zero', () => {
    const rows = leaderboard('gpqa_diamond')
    expect(rows.every((r) => typeof r.score.value === 'number' && r.score.value > 0)).toBe(true)
    expect(rows.length).toBeLessThan(allPriors().length)
  })

  it('is empty for an unknown benchmark, and coverage agrees', () => {
    expect(leaderboard('not_a_benchmark')).toEqual([])
    expect(coverage('not_a_benchmark')).toBe(0)
    expect(coverage('gpqa_diamond')).toBeGreaterThan(0)
  })
})
