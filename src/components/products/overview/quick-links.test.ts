import { describe, it, expect } from 'vitest'

import type { CatalogEntry } from '~/lib/products/registry'
import type { CloudUsageOverview } from '~/lib/api/usage'
import {
  showsQuickLinks,
  quickLinkTargetsFor,
  usageProductFilter,
  statsFromOverview,
  QUICK_LINKS_EXCLUDE,
} from './quick-links'

// A minimal catalog entry — only the fields the quick-links decisions read.
const entry = (over: Partial<CatalogEntry> = {}): CatalogEntry =>
  ({
    id: 'agents',
    label: 'Agents',
    description: '',
    category: 'AI',
    status: 'enabled',
    kind: 'module',
    routes: [],
    ...over,
  }) as unknown as CatalogEntry

describe('showsQuickLinks — only enabled, customer-visible product modules qualify', () => {
  it('shows for a normal enabled module product', () => {
    expect(showsQuickLinks(entry())).toBe(true)
    expect(showsQuickLinks(entry({ id: 'gpus', label: 'GPUs' }))).toBe(true)
    expect(showsQuickLinks(entry({ id: 'models', label: 'Models' }))).toBe(true)
  })
  it('hides for the money / account / rollup surfaces', () => {
    for (const id of QUICK_LINKS_EXCLUDE) {
      expect(showsQuickLinks(entry({ id }))).toBe(false)
    }
  })
  it('hides for admin god-views and external launches', () => {
    expect(showsQuickLinks(entry({ id: 'business', admin: true }))).toBe(false)
    expect(showsQuickLinks(entry({ id: 'auto', kind: 'external' } as Partial<CatalogEntry>))).toBe(false)
  })
})

describe('usageProductFilter — the ONE product→meter decision, reused from metricsScopeFor', () => {
  it('filters a normal product by its own tag', () => {
    expect(usageProductFilter('agents')).toBe('agents')
    expect(usageProductFilter('gpus')).toBe('gpus')
    expect(usageProductFilter('crm')).toBe('crm')
  })
  it('reads the whole inference ledger for the raw model-serving surfaces (null tag)', () => {
    for (const id of ['inference', 'models', 'api', 'gateway']) {
      expect(usageProductFilter(id)).toBeNull()
    }
  })
})

describe('quickLinkTargetsFor — real, derived, never-404 destinations', () => {
  it('a product-scoped entry: Billing pre-filtered by tag, Usage+Metrics to its own Metrics sub-page', () => {
    const t = quickLinkTargetsFor(entry({ id: 'gpus' }))
    expect(t.billing).toBe('/billing/reports?product=gpus')
    expect(t.usage).toBe('/gpus/metrics')
    expect(t.metrics).toBe('/gpus/metrics')
  })
  it('an inference-surface entry: Billing is the UNfiltered Cost Reports (its spend is the whole ledger)', () => {
    const t = quickLinkTargetsFor(entry({ id: 'models', label: 'Models' }))
    expect(t.billing).toBe('/billing/reports')
    expect(t.usage).toBe('/models/metrics')
    expect(t.metrics).toBe('/models/metrics')
  })
  it('url-encodes a product tag defensively', () => {
    const t = quickLinkTargetsFor(entry({ id: 'a b' }))
    expect(t.billing).toBe('/billing/reports?product=a%20b')
  })
})

// A minimal usage overview — only totals + byStatus are read by statsFromOverview.
const overview = (over: Partial<CloudUsageOverview>): CloudUsageOverview =>
  ({
    totals: { tokens: 0, promptTokens: 0, completionTokens: 0, requests: 0, spendCents: 0, models: 0, providers: 0 },
    byStatus: [],
    ...over,
  }) as unknown as CloudUsageOverview

describe('statsFromOverview — real figures, honest-empty success rate', () => {
  it('passes through real totals and computes success rate from the status mix', () => {
    const s = statsFromOverview(
      overview({
        totals: { tokens: 4200, promptTokens: 0, completionTokens: 0, requests: 100, spendCents: 1240, models: 3, providers: 2 },
        byStatus: [
          { status: 'success', requests: 95, pct: 95 },
          { status: 'error', requests: 5, pct: 5 },
        ],
      }),
    )
    expect(s.spendCents).toBe(1240)
    expect(s.requests).toBe(100)
    expect(s.tokens).toBe(4200)
    expect(s.successRate).toBeCloseTo(0.95, 5)
  })
  it('counts 2xx / ok / complete as success', () => {
    const s = statsFromOverview(
      overview({
        byStatus: [
          { status: '200', requests: 2, pct: 50 },
          { status: 'OK', requests: 1, pct: 25 },
          { status: 'completed', requests: 1, pct: 25 },
        ],
      }),
    )
    expect(s.successRate).toBe(1)
  })
  it('honest-empty: no requests → success rate is null (never a fabricated 100%)', () => {
    const s = statsFromOverview(overview({ byStatus: [] }))
    expect(s.successRate).toBeNull()
    expect(s.spendCents).toBe(0)
    expect(s.requests).toBe(0)
  })
})
