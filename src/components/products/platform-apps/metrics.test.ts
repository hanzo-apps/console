import { describe, expect, it } from 'vitest'

import type { ServiceMetrics } from '~/lib/api/o11y-metrics'
import type { PlatformApp } from '~/lib/api/platform-apps'
import { cardMetric, productForApp } from './metrics'

function app(over: Partial<PlatformApp>): PlatformApp {
  return {
    id: 'a1', org: 'o', projectId: 'p1', slug: 'api', name: 'API', environment: 'production',
    source: 'image', repo: {}, image: { repository: 'hanzoai/api', tag: 'v1' }, env: [], port: 8080,
    replicas: 1, domains: [], status: 'live', createdAt: 0, updatedAt: 0, ...over,
  }
}

function metrics(over: Partial<ServiceMetrics>): ServiceMetrics {
  return {
    product: 'api', requests: [], errors: [], latencyP50Ms: [], latencyP95Ms: [],
    summary: { requests: 0, errors: 0, errorRate: 0, p95Ms: 0 }, usage: { calls: 0, tokens: 0, costCents: 0 },
    hasData: false, connected: true, ...over,
  }
}

describe('productForApp', () => {
  it('uses the app slug (the DNS-safe workload name the o11y endpoint resolves)', () => {
    expect(productForApp(app({ slug: 'vector' }))).toBe('vector')
  })
  it('falls back to name then id when slug is absent', () => {
    expect(productForApp(app({ slug: '', name: 'My App', id: 'x' }))).toBe('My App')
    expect(productForApp(app({ slug: '', name: '', id: 'x' }))).toBe('x')
  })
})

describe('cardMetric', () => {
  it('folds the requests series into a Requests ServiceMetric with a compact total', () => {
    const m = cardMetric(metrics({
      hasData: true,
      requests: [{ t: '', v: 1 }, { t: '', v: 2 }, { t: '', v: 3 }],
      summary: { requests: 1500, errors: 0, errorRate: 0, p95Ms: 0 },
    }))
    expect(m).toEqual({ label: 'req', points: [1, 2, 3], value: '1.5K' })
  })

  it('is undefined (honest empty — no sparkline) when the service has no telemetry', () => {
    expect(cardMetric(metrics({ hasData: false }))).toBeUndefined()
  })

  it('is undefined when o11y is not connected', () => {
    expect(cardMetric(metrics({ connected: false, hasData: false }))).toBeUndefined()
  })
})
