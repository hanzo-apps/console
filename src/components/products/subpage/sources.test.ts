import { describe, expect, it } from 'vitest'

import { subpageSourcesFor, O11Y_METRICS_PRODUCTS } from './sources'
import type { CatalogEntry } from '~/lib/products/registry'

// Minimal CatalogEntry fixtures (icons/components are type-only, never rendered).
const I = (() => null) as unknown as CatalogEntry['icon']
const entry = (id: string, extra: Partial<CatalogEntry> = {}): CatalogEntry =>
  ({
    id,
    label: id[0].toUpperCase() + id.slice(1),
    icon: I,
    description: '',
    category: 'Data',
    status: 'enabled',
    kind: 'module',
    routes: [],
    ...extra,
  }) as unknown as CatalogEntry

describe('subpageSourcesFor — per-product real-feed metadata (DRY, derived)', () => {
  it('AI/LLM products read real o11y trace analytics for Metrics', () => {
    for (const id of ['models', 'chat', 'agents', 'inference', 'embeddings', 'gateway']) {
      expect(subpageSourcesFor(entry(id, { category: 'AI' })).metrics).toBe('o11y')
      expect(O11Y_METRICS_PRODUCTS.has(id)).toBe(true)
    }
  })

  it('every other product reads the usage ledger (per-product spend) for Metrics', () => {
    for (const id of ['gpus', 'vector', 'kms', 'functions', 'dns']) {
      expect(subpageSourcesFor(entry(id)).metrics).toBe('usage')
    }
  })

  it('uses the overview health spec service for Status when the product declares one', () => {
    // gateway/dns/cdn have a platform-app health spec — Status probes that service.
    const s = subpageSourcesFor(entry('gateway', { category: 'Network' }))
    expect(s.status.kind).toBe('platform-app')
    expect(s.service).toBe('gateway')
  })

  it('derives a candidate service from the repo basename, else the id', () => {
    expect(subpageSourcesFor(entry('vector', { repo: 'hanzoai/vector' })).service).toBe('vector')
    expect(subpageSourcesFor(entry('search', { repo: 'hanzoai/search-go' })).service).toBe('search-go')
    expect(subpageSourcesFor(entry('memory')).service).toBe('memory') // no repo → id
  })

  it('has NO service (honest managed) for pure org/account + rollup products', () => {
    for (const id of ['settings', 'team', 'profile', 'billing', 'plans', 'wallet']) {
      expect(subpageSourcesFor(entry(id, { category: 'Settings' })).service).toBeNull()
    }
  })

  it('defaults Settings to the honest managed state (no fabricated dead form)', () => {
    expect(subpageSourcesFor(entry('vector')).settings).toEqual({ kind: 'managed' })
  })
})
