import { describe, it, expect, vi } from 'vitest'

// The config imports lucide icons for the metric-tile `icon` field; that ESM package
// isn't transformed in the node test env, so stub the icons the config uses with plain
// tokens (the tile carries them as opaque values — the tests assert tile KEYS, not icons).
vi.mock('@hanzogui/lucide-icons-2', () => {
  const names = ['Activity', 'DollarSign', 'Hash', 'Timer']
  return Object.fromEntries(names.map((n) => [n, `icon:${n}`]))
})

// The loader merges the REAL usage ledger with LIVE o11y latency; mock both boundaries.
// `fromCloudUsage` is mocked to a known empty base so the test isolates the o11y merge.
vi.mock('./adapters', () => ({
  fromCloudUsage: vi.fn(() => ({ kpi: {}, series: {}, distribution: {}, activity: [], alerts: [], health: [] })),
}))
vi.mock('~/lib/api/usage', () => ({ UsageApi: { overview: vi.fn(async () => ({})) } }))
vi.mock('~/lib/api/apm', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('~/lib/api/apm')
  return { ...actual, ApmApi: { ...actual.ApmApi, serviceHealth: vi.fn(async () => null) } }
})

import { metricsProductFilter, productMetricsConfig } from './product-metrics'
import { ApmApi } from '~/lib/api/apm'
import type { CatalogEntry } from '~/lib/products/registry'
import type { ServiceHealth } from '~/lib/api/apm'

// A minimal module catalog entry (only the fields the config reads).
const entry = (id: string, label: string): CatalogEntry =>
  ({ id, label, description: '', category: 'AI', status: 'enabled', kind: 'module', routes: [] }) as unknown as CatalogEntry

describe('metricsProductFilter (thin accessor over the ONE scope decision)', () => {
  it('raw model-serving surfaces read the WHOLE inference ledger (null filter)', () => {
    for (const id of ['inference', 'models', 'api', 'gateway']) {
      expect(metricsProductFilter(id)).toBeNull()
    }
  })
  it('every other product filters by its own product tag (honest per-product)', () => {
    expect(metricsProductFilter('agents')).toBe('agents')
    expect(metricsProductFilter('chat')).toBe('chat')
    expect(metricsProductFilter('functions')).toBe('functions')
    expect(metricsProductFilter('crm')).toBe('crm')
  })
})

describe('productMetricsConfig', () => {
  it('builds a per-product Metrics dashboard with the mockup tiles + a product-scoped loader', () => {
    const cfg = productMetricsConfig(entry('agents', 'Agents'))
    expect(cfg.id).toBe('metrics:agents')
    expect(cfg.title).toBe('Metrics')
    // A product-scoped surface is framed as "attributed to <label>".
    expect(cfg.subtitle).toContain('attributed to Agents')
    // 4 KPI tiles: requests, tokens, spend, p99 latency (the LIVE o11y RED metric)
    expect(cfg.rows[0].map((t) => (t.tile === 'metric' ? t.key : t.tile))).toEqual(['requests', 'tokens', 'spendCents', 'latencyP99'])
    // 3 breakdowns: top-models-by-tokens, requests-by-status, spend-by-model
    expect(cfg.rows[2].map((t) => (t.tile === 'distribution' ? t.key : t.tile))).toEqual(['byModelTokens', 'byStatus', 'byModel'])
  })

  it('frames a raw model-serving surface honestly as org-wide inference (not a fabricated slice)', () => {
    const cfg = productMetricsConfig(entry('gateway', 'Gateway'))
    expect(cfg.subtitle).toContain('Org-wide inference')
    expect(cfg.subtitle).toContain('Gateway')
  })
})

describe('productMetricsConfig.load — LIVE o11y latency merged into the ledger', () => {
  const health = (p99Ms: number): ServiceHealth => ({
    service: 'vector',
    numCalls: 100,
    callRate: 1.2,
    errorRatePct: 0.5,
    p99Ms,
    avgMs: 10,
    tone: 'green',
  })

  it('injects the REAL o11y p99 (ms) into kpi.latencyP99 when the service reports telemetry', async () => {
    vi.mocked(ApmApi.serviceHealth).mockResolvedValueOnce(health(142))
    const cfg = productMetricsConfig(entry('vector', 'Vector'))
    const data = await cfg.load({ range: '24h' })
    expect(data.kpi.latencyP99).toEqual({ value: 142 })
  })

  it('leaves latencyP99 ABSENT (honest "—") when o11y has no telemetry for the service', async () => {
    vi.mocked(ApmApi.serviceHealth).mockResolvedValueOnce(null)
    const cfg = productMetricsConfig(entry('vector', 'Vector'))
    const data = await cfg.load({ range: '24h' })
    expect(data.kpi.latencyP99).toBeUndefined()
  })

  it('never lets an o11y failure break the metrics load (latency just stays "—")', async () => {
    vi.mocked(ApmApi.serviceHealth).mockRejectedValueOnce(new Error('o11y 503'))
    const cfg = productMetricsConfig(entry('vector', 'Vector'))
    const data = await cfg.load({ range: '7d' })
    expect(data.kpi.latencyP99).toBeUndefined()
    expect(data.activity).toEqual([]) // the ledger half still resolved
  })
})
