/**
 * Tests for the Observe read plane over the o11y gen_ai span plane. Two layers:
 *  (1) the PURE adapters (unwrapO11y / traceOf / observationOf) — the honesty
 *      guards that fold native `/v1/o11y` wire rows into the canonical Observe
 *      view-models; every missing/malformed enrichment maps to null/0 (an honest em
 *      dash), never a fabricated value, and the `{ status, data }` envelope unwraps.
 *  (2) the REAL O11yApi methods, with the transport + evals mocked, asserting the
 *      FLIP: traces / observations / sessions read the o11y SPAN plane (`/v1/o11y/llm`),
 *      while SCORES + rubrics STAY on `/v1/evals` (the eval artifacts) — the
 *      mission's one-way contract.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const restGet = vi.fn()
vi.mock('./client', () => ({
  cloudProxyV1Url: (p: string) => `/v1/${p}`,
  restGet: (...a: unknown[]) => restGet(...a),
}))

const listScoresTyped = vi.fn()
const listScoreConfigs = vi.fn()
vi.mock('./evals', () => ({
  EvalsApi: {
    listScoresTyped: (...a: unknown[]) => listScoresTyped(...a),
    listScoreConfigs: (...a: unknown[]) => listScoreConfigs(...a),
  },
}))

import { O11yApi, observationOf, traceOf, unwrapO11y } from './o11y'

// ── (1) pure adapters ─────────────────────────────────────────────────────────

describe('unwrapO11y', () => {
  it('unwraps the o11y { status, data } success envelope', () => {
    expect(unwrapO11y<{ items: number[] }>({ status: 'success', data: { items: [1, 2] } })).toEqual({ items: [1, 2] })
  })
  it('passes a bare payload through unchanged', () => {
    expect(unwrapO11y<{ items: number[] }>({ items: [3] })).toEqual({ items: [3] })
  })
})

describe('traceOf', () => {
  it('derives latency in seconds from latencyMs', () => {
    expect(traceOf({ id: 't1', latencyMs: 1500 }).latency).toBe(1.5)
  })
  it('carries userId/sessionId and real cost/tokens through', () => {
    const t = traceOf({ id: 't1', userId: 'u1', sessionId: 's1', totalCost: 0.02, totalTokens: 120 })
    expect(t).toMatchObject({ userId: 'u1', sessionId: 's1', totalCost: 0.02, totalTokens: 120 })
  })
  it('leaves latency/cost/tokens null when the backend omits them (honest em dash)', () => {
    const t = traceOf({ id: 't1' })
    expect(t.latency).toBeNull()
    expect(t.totalCost).toBeNull()
    expect(t.totalTokens).toBeNull()
    expect(t.timestamp).toBe('') // scalar aggregation — no single timestamp/name
    expect(t.name).toBeNull()
  })
  it('drops Infinity / negative / NaN latency, cost, and tokens (honest em dash)', () => {
    const t = traceOf({ id: 't1', latencyMs: 1e999, totalCost: -5, totalTokens: NaN })
    expect(t.latency).toBeNull()
    expect(t.totalCost).toBeNull()
    expect(t.totalTokens).toBeNull()
  })
})

describe('observationOf', () => {
  it('builds token usage from prompt/completion tokens', () => {
    expect(observationOf({ id: 'o1', promptTokens: 10, completionTokens: 5 }).usage).toEqual({ unit: 'TOKENS', input: 10, output: 5, total: 15 })
  })
  it('prefers an explicit totalTokens over the input+output sum', () => {
    expect(observationOf({ id: 'o1', promptTokens: 3, completionTokens: 4, totalTokens: 42 }).usage?.total).toBe(42)
  })
  it('uppercases the type and defaults to GENERATION', () => {
    expect(observationOf({ id: 'o1' }).type).toBe('GENERATION')
    expect(observationOf({ id: 'o1', type: 'span' }).type).toBe('SPAN')
  })
  it('carries the parent span id for the waterfall tree', () => {
    expect(observationOf({ id: 'o1', parentObservationId: 'p1' }).parentObservationId).toBe('p1')
    expect(observationOf({ id: 'o1' }).parentObservationId).toBeNull()
  })
  it('derives endTime = startTime + latencyMs', () => {
    expect(observationOf({ id: 'o1', startTime: '2026-07-10T00:00:00.000Z', latencyMs: 1000 }).endTime).toBe('2026-07-10T00:00:01.000Z')
  })
  it('leaves endTime null when startTime or latency is unusable', () => {
    expect(observationOf({ id: 'o1', latencyMs: 1000 }).endTime).toBeNull()
    expect(observationOf({ id: 'o1', startTime: 'not-a-date', latencyMs: 1000 }).endTime).toBeNull()
  })
  it('maps an error status code to the ERROR level', () => {
    expect(observationOf({ id: 'o1', statusCode: 'STATUS_CODE_ERROR' }).level).toBe('ERROR')
    expect(observationOf({ id: 'o1', statusCode: 'Ok' }).level).toBe('DEFAULT')
  })
  it('zeroes bogus token usage (Infinity / negative) — never reaches the folds', () => {
    expect(observationOf({ id: 'o1', promptTokens: 1e999, completionTokens: -10 }).usage).toEqual({ unit: 'TOKENS', input: 0, output: 0, total: 0 })
  })
})

// ── (2) the flip: span plane on /v1/o11y/llm, eval artifacts on /v1/evals ──────

describe('O11yApi reads the span plane natively from /v1/o11y/llm', () => {
  beforeEach(() => {
    restGet.mockReset()
    listScoresTyped.mockReset()
    listScoreConfigs.mockReset()
  })

  it('traces hits /v1/o11y/llm/traces (NOT /v1/evals), unwraps { status, data }.items, maps via traceOf', async () => {
    restGet.mockResolvedValueOnce({ status: 'success', data: { items: [{ id: 't1', latencyMs: 1500, totalTokens: 120, totalCost: 0.02 }], offset: 0, limit: 50 } })
    const res = await O11yApi.traces({ limit: 50 })
    const url = restGet.mock.calls[0][0] as string
    expect(url).toContain('/v1/o11y/llm/traces')
    expect(url).not.toContain('evals')
    expect(res.data).toHaveLength(1)
    expect(res.data[0]).toMatchObject({ id: 't1', latency: 1.5, totalTokens: 120, totalCost: 0.02 })
  })

  it('observations hits /v1/o11y/llm/observations and maps the waterfall span', async () => {
    restGet.mockResolvedValueOnce({ status: 'success', data: { items: [{ id: 'o1', traceId: 't1', parentObservationId: 'p1', type: 'span', promptTokens: 10, completionTokens: 5 }] } })
    const res = await O11yApi.observations({ limit: 50 })
    expect(restGet.mock.calls[0][0] as string).toContain('/v1/o11y/llm/observations')
    expect(res.data[0]).toMatchObject({ id: 'o1', traceId: 't1', parentObservationId: 'p1', type: 'SPAN' })
    expect(res.data[0].usage).toEqual({ unit: 'TOKENS', input: 10, output: 5, total: 15 })
  })

  it('sessions hits /v1/o11y/llm/sessions', async () => {
    restGet.mockResolvedValueOnce({ status: 'success', data: { items: [{ id: 's1' }] } })
    const res = await O11yApi.sessions()
    expect(restGet.mock.calls[0][0] as string).toContain('/v1/o11y/llm/sessions')
    expect(res.data[0].id).toBe('s1')
  })

  it('an empty / absent items list is honest [] (never fabricated)', async () => {
    restGet.mockResolvedValueOnce({ status: 'success', data: { items: null } })
    expect((await O11yApi.traces()).data).toEqual([])
  })

  it('trace(id) composes the waterfall from o11y spans + SERVER-aggregated totals + eval scores', async () => {
    // 1st restGet = observations (the waterfall); 2nd = the aggregated trace row (totals)
    restGet.mockResolvedValueOnce({ status: 'success', data: { items: [{ id: 'o1', traceId: 't1', name: 'chat gpt', startTime: '2026-07-10T00:00:00.000Z', totalTokens: 15 }] } })
    restGet.mockResolvedValueOnce({ status: 'success', data: { items: [{ id: 't1', totalTokens: 999, totalCost: 0.5, latencyMs: 3000 }] } })
    listScoresTyped.mockResolvedValueOnce([{ id: 'sc1', name: 'quality', value: 1, dataType: 'NUMERIC', source: 'EVAL', comment: null, timestamp: '', traceId: 't1', observationId: null, sessionId: null, configId: null }])
    const d = await O11yApi.trace('t1')
    expect(restGet.mock.calls[0][0] as string).toContain('/v1/o11y/llm/observations')
    expect(restGet.mock.calls[1][0] as string).toContain('/v1/o11y/llm/traces')
    expect(d.observations).toHaveLength(1)
    // inline scores come from EVALS, scoped by traceId (scores stay on evals)
    expect(listScoresTyped).toHaveBeenCalledWith({ traceId: 't1', limit: 200 })
    expect(d.scores).toHaveLength(1)
    // LOW-1: header totals come from the SERVER aggregation (999) over ALL spans, NOT
    // the span-summed 15 — so a >DETAIL_LIMIT-span trace never undercounts.
    expect(d.totalTokens).toBe(999)
    expect(d.totalCost).toBe(0.5)
    expect(d.latency).toBe(3)
    // name + start are still derived from the real spans (the aggregation carries neither)
    expect(d.name).toBe('chat gpt')
  })

  it('trace(id) falls back to span-summed totals when the aggregation row is absent', async () => {
    restGet.mockResolvedValueOnce({ status: 'success', data: { items: [{ id: 'o1', traceId: 't1', totalTokens: 15 }] } })
    restGet.mockResolvedValueOnce({ status: 'success', data: { items: [] } }) // no aggregation row
    listScoresTyped.mockResolvedValueOnce([])
    const d = await O11yApi.trace('t1')
    expect(d.totalTokens).toBe(15) // honest span-derived fallback
  })

  it('session(id) composes its traces from o11y, filtered by sessionId', async () => {
    restGet.mockResolvedValueOnce({ status: 'success', data: { items: [{ id: 't1', sessionId: 's1' }] } })
    const d = await O11yApi.session('s1')
    const url = restGet.mock.calls[0][0] as string
    expect(url).toContain('/v1/o11y/llm/traces')
    expect(url).toContain('sessionId=s1')
    expect(d.traces).toHaveLength(1)
  })
})

describe('SCORES + rubrics STAY on /v1/evals (never the o11y span plane)', () => {
  beforeEach(() => {
    restGet.mockReset()
    listScoresTyped.mockReset()
    listScoreConfigs.mockReset()
  })

  it('scores reads EvalsApi.listScoresTyped — no o11y span read', async () => {
    listScoresTyped.mockResolvedValueOnce([{ id: 'sc1', name: 'q', value: 1, dataType: 'NUMERIC', source: 'EVAL', comment: null, timestamp: '', traceId: null, observationId: null, sessionId: null, configId: null }])
    const res = await O11yApi.scores({ limit: 25 })
    expect(listScoresTyped).toHaveBeenCalledWith({ limit: 25 })
    expect(restGet).not.toHaveBeenCalled()
    expect(res.data).toHaveLength(1)
  })

  it('scoreConfigs reads EvalsApi.listScoreConfigs — no o11y span read', async () => {
    listScoreConfigs.mockResolvedValueOnce([{ name: 'quality', dataType: 'NUMERIC', minValue: 0, maxValue: 1, categories: [] }])
    const res = await O11yApi.scoreConfigs()
    expect(listScoreConfigs).toHaveBeenCalled()
    expect(restGet).not.toHaveBeenCalled()
    expect(res.data[0]).toMatchObject({ name: 'quality', dataType: 'NUMERIC' })
  })
})
