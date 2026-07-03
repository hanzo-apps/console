import { describe, it, expect, vi } from 'vitest'

// The config imports lucide icons for the metric-tile `icon` field; that ESM package
// isn't transformed in the node test env, so stub the icons the config uses with plain
// tokens (the tile carries them as opaque values — the tests assert tile KEYS, not icons).
vi.mock('@hanzogui/lucide-icons-2', () => {
  const names = ['Activity', 'DollarSign', 'Hash', 'Timer']
  return Object.fromEntries(names.map((n) => [n, `icon:${n}`]))
})

import { metricsProductFilter, productMetricsConfig } from './product-metrics'
import type { CatalogEntry } from '~/lib/products/registry'

// A minimal module catalog entry (only the fields the config reads).
const entry = (id: string, label: string): CatalogEntry =>
  ({ id, label, description: '', category: 'AI', status: 'enabled', kind: 'module', routes: [] }) as unknown as CatalogEntry

describe('metricsProductFilter', () => {
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
    expect(cfg.subtitle).toContain('Agents')
    // 4 KPI tiles: requests, tokens, spend, P95 latency
    expect(cfg.rows[0].map((t) => (t.tile === 'metric' ? t.key : t.tile))).toEqual(['requests', 'tokens', 'spendCents', 'latencyP95'])
    // 3 breakdowns: top-models-by-tokens, requests-by-status, spend-by-model
    expect(cfg.rows[2].map((t) => (t.tile === 'distribution' ? t.key : t.tile))).toEqual(['byModelTokens', 'byStatus', 'byModel'])
  })
})
