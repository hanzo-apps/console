import { describe, expect, it } from 'vitest'

import { resolveProductView, resolveRoute } from './match-core'
import type { CatalogEntry, ProductModule } from './registry'

// The registry itself can't load in vitest (icon ESM), so this proves the Sentry
// face's routing against the PURE resolver with a fixture that mirrors the real
// `sentry` entry exactly: routes ['', ':tab', ':tab/:id'] + declared sub-pages
// (discover, logs, traces, stats, projects, members). The sharp edge it guards:
// `logs` is a uniform BASE sub-page slug, so `/sentry/logs` would otherwise resolve
// to the shared per-product sub-page — but because Sentry OWNS `logs` as a declared
// specific, it must resolve to the module's own `:tab` panel instead.
const C = (() => null) as unknown as ProductModule['routes'][number]['component']
const I = (() => null) as unknown as ProductModule['icon']

const SUBPAGES = [
  { slug: 'discover', label: 'Discover' },
  { slug: 'logs', label: 'Logs' },
  { slug: 'traces', label: 'Traces' },
  { slug: 'stats', label: 'Monitor' },
  { slug: 'projects', label: 'Projects' },
  { slug: 'members', label: 'Members' },
]

const sentryEntry: CatalogEntry = {
  id: 'sentry',
  label: 'Sentry',
  icon: I,
  description: '',
  category: 'Observe',
  shell: 'sentry',
  kind: 'module',
  subpages: SUBPAGES,
  routes: [
    { path: '', component: C },
    { path: ':tab', component: C },
    { path: ':tab/:id', component: C },
  ],
}

const sentryModule: ProductModule = {
  id: 'sentry',
  label: 'Sentry',
  icon: I,
  description: '',
  routes: sentryEntry.kind === 'module' ? sentryEntry.routes : [],
}

const catalog: CatalogEntry[] = [sentryEntry]
const modules: ProductModule[] = [sentryModule]
const view = (slug: string[]) => resolveProductView(catalog, modules, slug)

describe('Sentry face routing', () => {
  it('/sentry → the Issues index (empty route)', () => {
    const v = view(['sentry'])
    expect(v.kind).toBe('route')
    if (v.kind === 'route') {
      expect(v.matched.route.path).toBe('')
      expect(v.matched.params).toEqual({})
    }
  })

  it('/sentry/discover → the :tab panel {tab:"discover"}', () => {
    const v = view(['sentry', 'discover'])
    expect(v.kind).toBe('route')
    if (v.kind === 'route') {
      expect(v.matched.route.path).toBe(':tab')
      expect(v.matched.params).toEqual({ tab: 'discover' })
    }
  })

  it('/sentry/logs → the module\'s OWN :tab panel, NOT the shared base sub-page', () => {
    const v = view(['sentry', 'logs'])
    // Sentry declares `logs` as a specific, so `resolveProductView` must NOT divert
    // it to the shared per-product Logs sub-page — it resolves the module route.
    expect(v.kind).toBe('route')
    if (v.kind === 'route') {
      expect(v.matched.route.path).toBe(':tab')
      expect(v.matched.params).toEqual({ tab: 'logs' })
    }
  })

  it('/sentry/issues/:id → the :tab/:id detail {tab:"issues", id}', () => {
    const v = view(['sentry', 'issues', 'abc123'])
    expect(v.kind).toBe('route')
    if (v.kind === 'route') {
      expect(v.matched.route.path).toBe(':tab/:id')
      expect(v.matched.params).toEqual({ tab: 'issues', id: 'abc123' })
    }
  })

  it('/sentry/traces/:id → the :tab/:id trace detail', () => {
    const v = view(['sentry', 'traces', 'trace-xyz'])
    expect(v.kind).toBe('route')
    if (v.kind === 'route') {
      expect(v.matched.params).toEqual({ tab: 'traces', id: 'trace-xyz' })
    }
  })

  it('a base slug Sentry does NOT own (status) still resolves to the shared sub-page', () => {
    // Proves the base-subpage machinery is intact — only the OWNED `logs` diverts.
    const v = view(['sentry', 'status'])
    expect(v.kind).toBe('subpage')
    if (v.kind === 'subpage') expect(v.subpage.slug).toBe('status')
  })

  it('resolveRoute matches by exact segment count (:tab vs :tab/:id unambiguous)', () => {
    expect(resolveRoute(modules, ['sentry', 'projects'])?.route.path).toBe(':tab')
    expect(resolveRoute(modules, ['sentry', 'projects', 'p1'])?.route.path).toBe(':tab/:id')
  })
})
