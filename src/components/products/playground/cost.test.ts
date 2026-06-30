import { describe, it, expect } from 'vitest'

import { costOf, formatLatency, formatTokens, formatUsd, tokensPerSecond } from './cost'

describe('costOf — usage × catalog pricing', () => {
  it('computes input/output/total from $/Mtok pricing', () => {
    const c = costOf(
      { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 },
      { inputPerMillion: 2, outputPerMillion: 4 },
    )
    expect(c.inputUsd).toBeCloseTo(0.002, 9)
    expect(c.outputUsd).toBeCloseTo(0.002, 9)
    expect(c.totalUsd).toBeCloseTo(0.004, 9)
  })

  it('returns nulls when pricing is missing (never fabricates a price)', () => {
    const c = costOf({ prompt_tokens: 10, completion_tokens: 10 }, null)
    expect(c).toEqual({ inputUsd: null, outputUsd: null, totalUsd: null })
  })

  it('returns nulls when usage is missing', () => {
    expect(costOf(null, { inputPerMillion: 2, outputPerMillion: 4 })).toEqual({
      inputUsd: null,
      outputUsd: null,
      totalUsd: null,
    })
  })

  it('handles partial pricing — total uses only the priced side', () => {
    const c = costOf({ prompt_tokens: 1_000_000, completion_tokens: 1_000_000 }, { inputPerMillion: 3 })
    expect(c.inputUsd).toBeCloseTo(3, 9)
    expect(c.outputUsd).toBeNull()
    expect(c.totalUsd).toBeCloseTo(3, 9)
  })
})

describe('formatters', () => {
  it('formatUsd', () => {
    expect(formatUsd(null)).toBe('—')
    expect(formatUsd(0)).toBe('$0')
    expect(formatUsd(0.004)).toBe('$0.004000')
    expect(formatUsd(0.5)).toBe('$0.5000')
    expect(formatUsd(1.5)).toBe('$1.50')
  })

  it('formatLatency', () => {
    expect(formatLatency(null)).toBe('—')
    expect(formatLatency(500)).toBe('500 ms')
    expect(formatLatency(1500)).toBe('1.50 s')
  })

  it('formatTokens', () => {
    expect(formatTokens(null)).toBe('—')
    expect(formatTokens(undefined)).toBe('—')
    expect(formatTokens(42)).toBe('42')
  })

  it('tokensPerSecond', () => {
    expect(tokensPerSecond({ completion_tokens: 100 }, 2000)).toBeCloseTo(50, 6)
    expect(tokensPerSecond({ completion_tokens: 100 }, 0)).toBeNull()
    expect(tokensPerSecond(null, 1000)).toBeNull()
  })
})
