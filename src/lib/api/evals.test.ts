/**
 * Pure-logic tests for the native /v1/evals adapters (wire → canonical Observe
 * view-models). These fold the real backend shapes into the types the shared
 * observability primitives (SpanTree waterfall, metrics, formatters) consume;
 * every missing enrichment must map to null/0 (honest em dash), never a
 * fabricated value.
 */
import { describe, expect, it } from 'vitest'
import { toObservation, toScore, toTrace } from './evals'
import { fmtCost, fmtLatency } from '~/components/products/observability/format'

describe('toTrace', () => {
  it('derives latency in seconds from latencyMs', () => {
    expect(toTrace({ id: 't1', latencyMs: 1500 }).latency).toBe(1.5)
  })
  it('prefers an explicit latency (already seconds) over latencyMs', () => {
    expect(toTrace({ id: 't1', latency: 2, latencyMs: 9999 }).latency).toBe(2)
  })
  it('leaves latency/cost/tokens null when the backend omits them (honest em dash)', () => {
    const t = toTrace({ id: 't1' })
    expect(t.latency).toBeNull()
    expect(t.totalCost).toBeNull()
    expect(t.totalTokens).toBeNull()
  })
  it('falls back sessionId → runName and name → eval:runName', () => {
    const t = toTrace({ id: 't1', runName: 'run-7' })
    expect(t.sessionId).toBe('run-7')
    expect(t.name).toBe('eval:run-7')
    expect(t.tags).toEqual(['run-7'])
  })
  it('keeps an explicit name and real tags', () => {
    const t = toTrace({ id: 't1', name: 'greeting', tags: ['a', 'b'] })
    expect(t.name).toBe('greeting')
    expect(t.tags).toEqual(['a', 'b'])
  })
})

describe('toObservation', () => {
  it('builds usage from prompt/output tokens when no usage object is present', () => {
    const o = toObservation({ id: 'o1', promptTokens: 10, outputTokens: 5 })
    expect(o.usage).toEqual({ unit: 'TOKENS', input: 10, output: 5, total: 15 })
  })
  it('passes a present usage object through, defaulting missing members to 0', () => {
    const o = toObservation({ id: 'o1', usage: { total: 42 } })
    expect(o.usage).toEqual({ unit: null, input: 0, output: 0, total: 42 })
  })
  it('uppercases the type and defaults to SPAN', () => {
    expect(toObservation({ id: 'o1' }).type).toBe('SPAN')
    expect(toObservation({ id: 'o1', type: 'generation' }).type).toBe('GENERATION')
  })
  it('accepts either parentObservationId or parentId', () => {
    expect(toObservation({ id: 'o1', parentId: 'p1' }).parentObservationId).toBe('p1')
    expect(toObservation({ id: 'o1', parentObservationId: 'p2', parentId: 'p1' }).parentObservationId).toBe('p2')
  })
})

describe('toScore', () => {
  it('defaults value to 0, uppercases dataType, stamps EVAL source', () => {
    const s = toScore({ id: 's1', name: 'quality', dataType: 'numeric' })
    expect(s.value).toBe(0)
    expect(s.dataType).toBe('NUMERIC')
    expect(s.source).toBe('EVAL')
    expect(s.comment).toBeNull()
  })
  it('carries a categorical stringValue + real value', () => {
    const s = toScore({ id: 's1', name: 'tone', dataType: 'CATEGORICAL', stringValue: 'good', value: 1 })
    expect(s.stringValue).toBe('good')
    expect(s.value).toBe(1)
  })
  it('coerces a non-finite score value to 0 (never "Infinity" in the table)', () => {
    expect(toScore({ id: 's1', name: 'q', value: Infinity }).value).toBe(0)
    expect(toScore({ id: 's1', name: 'q', value: NaN }).value).toBe(0)
  })
  it('preserves a legitimately negative score value', () => {
    expect(toScore({ id: 's1', name: 'q', value: -0.5 }).value).toBe(-0.5)
  })
})

// RED honesty guard: a malformed backend row (JSON allows 1e999 → Infinity, or a
// negative latency/cost/token) must degrade to null/0 — never a fabricated or
// "Infinitys"-rendering value that would also skew the metric folds.
describe('non-finite / negative enrichment → null (honest em dash)', () => {
  it('drops Infinity / negative / NaN latency, cost, and tokens on a trace', () => {
    const t = toTrace({ id: 't1', latencyMs: 1e999, totalCost: -5, totalTokens: NaN })
    expect(t.latency).toBeNull()
    expect(t.totalCost).toBeNull()
    expect(t.totalTokens).toBeNull()
  })
  it('drops a negative direct latency', () => {
    expect(toTrace({ id: 't1', latency: -2 }).latency).toBeNull()
  })
  it('zeroes bogus observation token usage (Infinity / negative)', () => {
    const o = toObservation({ id: 'o1', promptTokens: 1e999, outputTokens: -10 })
    expect(o.usage).toEqual({ unit: 'TOKENS', input: 0, output: 0, total: 0 })
  })
  it('formatters mirror the guard (em dash for non-finite / negative)', () => {
    expect(fmtLatency(Infinity)).toBe('—')
    expect(fmtLatency(-1)).toBe('—')
    expect(fmtCost(Infinity)).toBe('—')
    expect(fmtCost(-5)).toBe('—')
  })
})
