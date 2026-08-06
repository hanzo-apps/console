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

import { O11yStatusApi, normalizeProductStatus, isUnknownService } from './o11y-status'

const probeBody = {
  product: 'iam',
  up: true,
  latencyMs: 42,
  source: 'probe',
  deployments: [{ instance: 'iam', up: true }],
  checkedAt: '2026-08-06T00:00:00Z',
}

describe('normalizeProductStatus', () => {
  it('maps a successful probe verdict, keeping the measured latency', () => {
    const s = normalizeProductStatus(probeBody)
    expect(s.up).toBe(true)
    expect(s.source).toBe('probe')
    expect(s.probeLatencyMs).toBe(42)
    expect(s.reachable).toBe(true)
    expect(s.deployments).toEqual([{ instance: 'iam', up: true }])
  })

  // TRAP A — the endpoint sends latencyMs:0 whenever the PROBE FAILED, not because the
  // service was fast. A non-probe verdict must expose null, so no UI can print "0ms"
  // for a service it never successfully reached.
  it('reports NO latency when the verdict did not come from a probe', () => {
    expect(normalizeProductStatus({ ...probeBody, source: 'datastore', latencyMs: 0 }).probeLatencyMs).toBeNull()
    expect(normalizeProductStatus({ ...probeBody, source: 'unreachable', latencyMs: 0, up: false }).probeLatencyMs).toBeNull()
    // Even a non-zero latency is not trustworthy off the probe path.
    expect(normalizeProductStatus({ ...probeBody, source: 'datastore', latencyMs: 99 }).probeLatencyMs).toBeNull()
  })

  it('carries the datastore (hanzo_service_up gauge) verdict', () => {
    const s = normalizeProductStatus({ ...probeBody, source: 'datastore', up: true, latencyMs: 0 })
    expect(s.source).toBe('datastore')
    expect(s.up).toBe(true)
  })

  it('treats unknown-service as "nothing to report", not as down', () => {
    const s = normalizeProductStatus({ product: 'made-up', up: false, source: 'unknown-service' })
    expect(isUnknownService(s)).toBe(true)
    expect(s.reachable).toBe(true)
  })

  it('degrades a garbage payload instead of throwing', () => {
    for (const junk of [null, undefined, 42, 'nope', [], { deployments: 'no' }]) {
      const s = normalizeProductStatus(junk, 'iam')
      expect(s.up).toBe(false)
      expect(s.deployments).toEqual([])
      expect(s.probeLatencyMs).toBeNull()
    }
    // An unrecognized source never becomes a confident verdict.
    expect(normalizeProductStatus({ source: 'wat' }).source).toBe('unreachable')
  })

  it('never reports up on a truthy-but-not-true flag', () => {
    expect(normalizeProductStatus({ ...probeBody, up: 'yes' }).up).toBe(false)
    expect(normalizeProductStatus({ ...probeBody, up: 1 }).up).toBe(false)
  })
})

describe('O11yStatusApi.product', () => {
  beforeEach(() => restGet.mockReset())

  it('GETs /v1/o11y/status with the product slug', async () => {
    restGet.mockResolvedValueOnce(probeBody)
    const s = await O11yStatusApi.product('IAM')
    const url = restGet.mock.calls[0][0] as string
    expect(url).toBe('/v1/o11y/status?product=iam')
    expect(s.up).toBe(true)
  })

  it('resolves to an honest unreachable carrying the status, never throwing', async () => {
    for (const code of [404, 503, 401, 403]) {
      restGet.mockRejectedValueOnce(new ApiError('nope', code))
      const s = await O11yStatusApi.product('iam')
      expect(s.reachable).toBe(false)
      expect(s.status).toBe(code)
      expect(s.up).toBe(false)
    }
  })

  it('does not call the API for an empty slug', async () => {
    const s = await O11yStatusApi.product('  ')
    expect(restGet).not.toHaveBeenCalled()
    expect(s.reachable).toBe(false)
  })
})
