import { describe, expect, it } from 'vitest'

import {
  subpageSourcesFor,
  metricsScopeFor,
  settingsConfigFor,
  INFERENCE_SURFACE_PRODUCTS,
} from './sources'
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

describe('metricsScopeFor — the ONE per-product Metrics ledger scope (DRY)', () => {
  it('the raw model-serving surface reads the WHOLE inference ledger, framed as org-wide', () => {
    for (const id of ['inference', 'models', 'api', 'gateway']) {
      expect(metricsScopeFor(id)).toEqual({ product: null, scope: 'inference-all' })
      expect(INFERENCE_SURFACE_PRODUCTS.has(id)).toBe(true)
    }
  })
  it('every OTHER product filters by its own product tag — never the org aggregate', () => {
    for (const id of ['agents', 'chat', 'functions', 'vector', 'kms', 'crm', 'commerce']) {
      expect(metricsScopeFor(id)).toEqual({ product: id, scope: 'product' })
    }
  })
  it('subpageSourcesFor carries the same scope decision (one source)', () => {
    expect(subpageSourcesFor(entry('gateway', { category: 'Network' })).metrics).toEqual({ product: null, scope: 'inference-all' })
    expect(subpageSourcesFor(entry('vector', { repo: 'hanzoai/vector' })).metrics).toEqual({ product: 'vector', scope: 'product' })
  })
})

describe('subpageSourcesFor — per-product Status/Logs service (real, derived + overrides)', () => {
  it('uses the overview health spec service when the product declares one', () => {
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

  it('applies the verified operator-service overrides (real health, not a false "not deployed")', () => {
    // repo hanzoai/ai would derive `ai`; the real operator app is `models`.
    expect(subpageSourcesFor(entry('models', { repo: 'hanzoai/ai', category: 'AI' })).service).toBe('models')
    // repo hanzoai/bot would derive `bot`; the real operator app is `bot-gateway`.
    expect(subpageSourcesFor(entry('bot', { repo: 'hanzoai/bot', category: 'Apps' })).service).toBe('bot-gateway')
    // id `helpdesk`; the real operator app is `help`.
    expect(subpageSourcesFor(entry('helpdesk', { category: 'Apps' })).service).toBe('help')
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

describe('settingsConfigFor — REAL, product-specific configuration (not a generic form)', () => {
  it('reuses a registered overview spec verbatim (one per-product content source, DRY)', () => {
    // gateway has a bespoke spec with Base URL / Auth facts + Create API key action.
    const cfg = settingsConfigFor(entry('gateway', { category: 'Network' }))
    expect(cfg.facts.some((f) => f.label === 'Base URL' && f.value === 'api.hanzo.ai/v1')).toBe(true)
    expect(cfg.links.some((l) => l.to === '/api-keys')).toBe(true)
  })

  it('an AI product that hits the gateway shows the endpoint + credential + an API-keys link', () => {
    const cfg = settingsConfigFor(entry('inference', { category: 'AI', repo: 'hanzoai/cloud' }))
    expect(cfg.facts.find((f) => f.label === 'Endpoint')?.value).toBe('api.hanzo.ai/v1')
    expect(cfg.facts.some((f) => f.label === 'Auth')).toBe(true)
    expect(cfg.links.some((l) => l.label === 'Manage API keys' && l.to === '/api-keys')).toBe(true)
  })

  it('a managed data resource shows a connection pointer + its own page (never a dead form)', () => {
    const cfg = settingsConfigFor(entry('vector', { category: 'Data', repo: 'hanzoai/vector' }))
    expect(cfg.facts.some((f) => f.label === 'Access')).toBe(true)
    expect(cfg.links[0]).toEqual({ label: 'Open Vector', to: '/vector' })
  })

  it('a product with no self-serve config still links to its own page (honest default)', () => {
    const cfg = settingsConfigFor(entry('oracles', { category: 'Web3' }))
    expect(cfg.facts.length).toBeGreaterThan(0)
    expect(cfg.links).toEqual([{ label: 'Open Oracles', to: '/oracles' }])
  })

  it('never fabricates — every fact is a real value or an explicit honest state', () => {
    for (const id of ['vector', 'inference', 'oracles', 'iam']) {
      const cfg = settingsConfigFor(entry(id, { category: id === 'iam' ? 'Security' : 'Data' }))
      // A fact value is either a real string or null (rendered as an em dash), never undefined-as-real.
      for (const f of cfg.facts) expect(f.value === null || typeof f.value === 'string').toBe(true)
      expect(cfg.links.length).toBeGreaterThan(0)
    }
  })
})
