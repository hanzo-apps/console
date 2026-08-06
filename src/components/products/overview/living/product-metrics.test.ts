import { describe, it, expect, vi } from 'vitest'

// The config imports lucide icons for the metric-tile `icon` field; that ESM package
// isn't transformed in the node test env, so stub the icons the config uses with plain
// tokens (the tile carries them as opaque values — the tests assert tile KEYS, not icons).
vi.mock('@hanzogui/lucide-icons-2', () => {
  const names = ['Activity', 'AlertTriangle', 'DollarSign', 'Hash', 'Timer']
  return Object.fromEntries(names.map((n) => [n, `icon:${n}`]))
})

// The loader fuses the REAL billed ledger with the LIVE o11y RED window; mock both
// boundaries. `fromCloudUsage` is mocked to a known empty base so the tests isolate the
// o11y half — anything that appears on `data` came from the fusion, not the ledger.
vi.mock('./adapters', () => ({
  fromCloudUsage: vi.fn(() => ({ kpi: {}, series: {}, distribution: {}, activity: [], alerts: [], health: [] })),
}))
vi.mock('~/lib/api/usage', () => ({ UsageApi: { overview: vi.fn(async () => ({})) } }))
vi.mock('~/lib/api/o11y-metrics', () => ({ O11yMetricsApi: { service: vi.fn() } }))

import { metricsProductFilter, productMetricsConfig } from './product-metrics'
import { O11yMetricsApi, type ServiceMetrics } from '~/lib/api/o11y-metrics'
import type { CatalogEntry } from '~/lib/products/registry'

// A minimal module catalog entry (only the fields the config reads).
const entry = (id: string, label: string): CatalogEntry =>
  ({ id, label, description: '', category: 'AI', status: 'enabled', kind: 'module', routes: [] }) as unknown as CatalogEntry

/** A RED window as the per-product o11y read returns it. */
const red = (over: Partial<ServiceMetrics> = {}): ServiceMetrics => ({
  product: 'vector',
  requests: [{ t: '2026-08-06T00:00:00Z', v: 10 }, { t: '2026-08-06T01:00:00Z', v: 14 }],
  errors: [{ t: '2026-08-06T00:00:00Z', v: 0 }, { t: '2026-08-06T01:00:00Z', v: 2 }],
  latencyP50Ms: [],
  latencyP95Ms: [],
  summary: { requests: 24, errors: 2, errorRate: 8.3, p95Ms: 142 },
  usage: { calls: 0, tokens: 0, costCents: 0 },
  hasData: true,
  connected: true,
  ...over,
})

/** The honest empty/not-connected shape the client resolves to on any o11y miss. */
const noRed = (connected: boolean): ServiceMetrics =>
  red({
    requests: [],
    errors: [],
    summary: { requests: 0, errors: 0, errorRate: 0, p95Ms: 0 },
    hasData: false,
    connected,
  })

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
  it('builds a per-product Metrics dashboard with the RED tiles + a product-scoped loader', () => {
    const cfg = productMetricsConfig(entry('agents', 'Agents'))
    expect(cfg.id).toBe('metrics:agents')
    expect(cfg.title).toBe('Metrics')
    // A product-scoped surface names BOTH sources: traffic served, plus attributed spend.
    expect(cfg.subtitle).toContain('Traffic served by Agents')
    expect(cfg.subtitle).toContain('attributed to it')
    // KPI row leads with the RED signals, then the billed ledger's own dimensions.
    expect(cfg.rows[0].map((t) => (t.tile === 'metric' ? t.key : t.tile))).toEqual([
      'requests',
      'errorRatePct',
      'latencyP95',
      'tokens',
      'spendCents',
    ])
    // Requests + errors over time are the o11y series; spend stays the ledger's.
    expect(cfg.rows[1].map((t) => (t.tile === 'timeseries' ? t.key : t.tile))).toEqual(['requests', 'errors', 'spendCents'])
    // 3 breakdowns: top-models-by-tokens, requests-by-status, spend-by-model
    expect(cfg.rows[2].map((t) => (t.tile === 'distribution' ? t.key : t.tile))).toEqual(['byModelTokens', 'byStatus', 'byModel'])
  })

  it('frames a raw model-serving surface honestly as org-wide inference (not a fabricated slice)', () => {
    const cfg = productMetricsConfig(entry('gateway', 'Gateway'))
    expect(cfg.subtitle).toContain('Org-wide inference')
    expect(cfg.subtitle).toContain('Gateway')
  })
})

describe('productMetricsConfig.load — the ledger fused with the LIVE o11y RED window', () => {
  it('takes requests, error rate, p95 and both series from o11y when it reported data', async () => {
    vi.mocked(O11yMetricsApi.service).mockResolvedValueOnce(red())
    const cfg = productMetricsConfig(entry('vector', 'Vector'))
    const data = await cfg.load({ range: '24h' })

    // Telemetry wins for what was SERVED — the ledger only counts billed calls.
    expect(data.kpi.requests).toEqual({ value: 24 })
    // Neither of these has any ledger equivalent at all.
    expect(data.kpi.errorRatePct).toEqual({ value: 8.3 })
    expect(data.kpi.latencyP95).toEqual({ value: 142 })
    expect(data.series.requests.points).toEqual([
      { t: '2026-08-06T00:00:00Z', value: 10 },
      { t: '2026-08-06T01:00:00Z', value: 14 },
    ])
    expect(data.series.errors.points.map((p) => p.value)).toEqual([0, 2])
  })

  it('asks o11y for the window matching the range, capped at the 7d the endpoint serves', async () => {
    const cfg = productMetricsConfig(entry('vector', 'Vector'))
    for (const [range, rangeSec] of [
      ['24h', 86_400],
      ['7d', 604_800],
      ['30d', 604_800],
    ] as const) {
      vi.mocked(O11yMetricsApi.service).mockResolvedValueOnce(noRed(true))
      await cfg.load({ range })
      expect(vi.mocked(O11yMetricsApi.service).mock.lastCall).toEqual(['vector', { rangeSec }])
    }
  })

  it('leaves the RED tiles ABSENT (honest "—") when the service reports no telemetry', async () => {
    vi.mocked(O11yMetricsApi.service).mockResolvedValueOnce(noRed(true))
    const cfg = productMetricsConfig(entry('vector', 'Vector'))
    const data = await cfg.load({ range: '24h' })
    // Absent, not zero — a zero here would claim "no errors" for a service we never measured.
    expect(data.kpi.errorRatePct).toBeUndefined()
    expect(data.kpi.latencyP95).toBeUndefined()
    expect(data.kpi.requests).toBeUndefined()
  })

  it('never lets an o11y outage break the metrics load — the ledger half still resolves', async () => {
    // The client resolves (never throws) to an honest not-connected on 503/404/401/403.
    vi.mocked(O11yMetricsApi.service).mockResolvedValueOnce(noRed(false))
    const cfg = productMetricsConfig(entry('vector', 'Vector'))
    const data = await cfg.load({ range: '7d' })
    expect(data.kpi.latencyP95).toBeUndefined()
    expect(data.activity).toEqual([])
  })
})
