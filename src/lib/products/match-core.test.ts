import { describe, expect, it } from 'vitest'

import { resolveRoute, entryMatches } from './match-core'
import type { CatalogEntry, ProductModule } from './registry'

// Runtime stubs for the type-only icon/component fields (matching never renders).
const C = (() => null) as unknown as ProductModule['routes'][number]['component']
const I = (() => null) as unknown as ProductModule['icon']

/**
 * Fixtures mirror the REAL registry shape after the models merge:
 *   /models                → catalog (index)
 *   /models/<tab>          → tab view  (e.g. routing)
 *   /models/routing/<name> → edit/create a route
 */
const modules: ProductModule[] = [
  {
    id: 'models',
    label: 'Models',
    icon: I,
    description: 'Browse the live model catalog and configure routing policy.',
    routes: [
      { path: '', component: C },
      { path: ':tab', component: C },
      { path: 'routing/:name', component: C },
    ],
  },
  {
    id: 'providers',
    label: 'Providers',
    icon: I,
    description: '',
    routes: [
      { path: '', component: C },
      { path: ':name', component: C },
    ],
  },
]

describe('resolveRoute — the models merge routing (ask 1)', () => {
  it('lands /models on the catalog (index) by default', () => {
    const m = resolveRoute(modules, ['models'])
    expect(m?.module.id).toBe('models')
    expect(m?.route.path).toBe('')
    expect(m?.params).toEqual({})
  })

  it('resolves the secondary routing tab', () => {
    const m = resolveRoute(modules, ['models', 'routing'])
    expect(m?.route.path).toBe(':tab')
    expect(m?.params).toEqual({ tab: 'routing' })
  })

  it('resolves create + edit under routing/<name>', () => {
    expect(resolveRoute(modules, ['models', 'routing', 'new'])?.params).toEqual({ name: 'new' })
    expect(resolveRoute(modules, ['models', 'routing', 'gpt-4o'])?.params).toEqual({ name: 'gpt-4o' })
    // The deeper pattern is matched by segment count, never the shorter :tab.
    expect(resolveRoute(modules, ['models', 'routing', 'new'])?.route.path).toBe('routing/:name')
  })

  it('returns null for an unknown module or over-long slug', () => {
    expect(resolveRoute(modules, ['nope'])).toBeNull()
    expect(resolveRoute(modules, [])).toBeNull()
    expect(resolveRoute(modules, ['models', 'routing', 'a', 'b'])).toBeNull()
  })
})

describe('entryMatches — the sidebar filter (ask 4)', () => {
  const entry = {
    id: 'vector',
    label: 'Vector',
    icon: I,
    description: 'Managed vector database — embeddings & semantic search.',
    category: 'Data',
    status: 'enabled',
    gcp: 'Vertex Vector Search',
    kind: 'module',
    routes: [],
  } as unknown as CatalogEntry

  it('is permissive on empty query and case-insensitive on real matches', () => {
    expect(entryMatches(entry, '')).toBe(true)
    expect(entryMatches(entry, '   ')).toBe(true)
    expect(entryMatches(entry, 'VECTOR')).toBe(true)
    expect(entryMatches(entry, 'vec')).toBe(true)
  })

  it('matches across id, category, gcp, and description — not just the label', () => {
    expect(entryMatches(entry, 'data')).toBe(true) // category
    expect(entryMatches(entry, 'vertex')).toBe(true) // gcp
    expect(entryMatches(entry, 'semantic')).toBe(true) // description
    expect(entryMatches(entry, 'kubernetes')).toBe(false)
  })
})
