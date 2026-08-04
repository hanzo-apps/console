import { describe, it, expect, vi, beforeEach } from 'vitest'

const restGet = vi.fn()
const { ApiError } = vi.hoisted(() => {
  class ApiError extends Error {
    status: number
    constructor(message: string, status = 0) {
      super(message)
      this.status = status
    }
  }
  return { ApiError }
})
vi.mock('./client', () => ({
  cloudProxyV1Url: (p: string) => `/v1/${p}`,
  restGet: (...a: unknown[]) => restGet(...a),
  ApiError,
}))

import { O11yMetricsApi, normalizeServiceMetrics } from './o11y-metrics'

const body = {
  product: 'iam',
  range: { sinceSec: 3600, stepSec: 60 },
  series: {
    requests: [{ t: '2026-07-10T00:00:00Z', v: 10 }, { t: '2026-07-10T00:01:00Z', v: 12 }],
    errors: [{ t: '2026-07-10T00:00:00Z', v: 0 }, { t: '2026-07-10T00:01:00Z', v: 1 }],
    latencyP50Ms: [{ t: '2026-07-10T00:00:00Z', v: 20 }],
    latencyP95Ms: [{ t: '2026-07-10T00:00:00Z', v: 88 }],
  },
  usage: { calls: 22, tokens: 100, costCents: 5, series: [] },
  summary: { requests: 22, errors: 1, errorRate: 4.5, p95Ms: 88 },
}

describe('normalizeServiceMetrics', () => {
  it('maps the real metricsResponse shape to typed series + summary', () => {
    const m = normalizeServiceMetrics(body)
    expect(m.product).toBe('iam')
    expect(m.requests.map((p) => p.v)).toEqual([10, 12])
    expect(m.errors.map((p) => p.v)).toEqual([0, 1])
    expect(m.latencyP95Ms.map((p) => p.v)).toEqual([88])
    expect(m.summary).toEqual({ requests: 22, errors: 1, errorRate: 4.5, p95Ms: 88 })
    expect(m.usage).toEqual({ calls: 22, tokens: 100, costCents: 5 })
    expect(m.hasData).toBe(true)
    expect(m.connected).toBe(true)
  })

  it('honest-empty: an unbacked product (empty series, zero summary) is connected but hasData=false', () => {
    const m = normalizeServiceMetrics({ product: 'my-app', series: {}, summary: { requests: 0, errors: 0, errorRate: 0, p95Ms: 0 } })
    expect(m.hasData).toBe(false)
    expect(m.connected).toBe(true)
    expect(m.requests).toEqual([])
  })

  it('tolerates garbage without throwing', () => {
    const m = normalizeServiceMetrics(null)
    expect(m.requests).toEqual([])
    expect(m.hasData).toBe(false)
  })
})

describe('O11yMetricsApi.service', () => {
  beforeEach(() => restGet.mockReset())

  it('GETs /v1/o11y/product/metrics with the product + range and maps the body', async () => {
    restGet.mockResolvedValueOnce(body)
    const m = await O11yMetricsApi.service('iam', { rangeSec: 3600 })
    const url = restGet.mock.calls[0][0] as string
    expect(url).toContain('/v1/o11y/product/metrics')
    expect(url).toContain('product=iam')
    expect(url).toContain('range=3600')
    expect(m.connected).toBe(true)
    expect(m.summary.requests).toBe(22)
  })

  it('an o11y transport error (503) returns connected:false — never throws, never fabricates', async () => {
    restGet.mockRejectedValueOnce(new ApiError('datastore not connected', 503))
    const m = await O11yMetricsApi.service('iam')
    expect(m.connected).toBe(false)
    expect(m.hasData).toBe(false)
  })

  it('a 400 (bad slug for one app) is honest-empty, not a not-connected verdict', async () => {
    restGet.mockRejectedValueOnce(new ApiError('bad product', 400))
    const m = await O11yMetricsApi.service('Bad Slug')
    expect(m.connected).toBe(true)
    expect(m.hasData).toBe(false)
  })
})
