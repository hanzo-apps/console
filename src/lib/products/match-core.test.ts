import { describe, expect, it } from 'vitest'

import {
  resolveRoute,
  entryMatches,
  productSubpages,
  resolveProductView,
  subpageIsWired,
  isAdminView,
  destinationsFor,
  BASE_SUBPAGES,
} from './match-core'
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

// ── The level-2 sub-page contract (asks 1 & 2) ───────────────────────────────

/** Build a module catalog entry with optional declared sub-pages + routes. */
const mod = (
  id: string,
  extra: Partial<CatalogEntry> & { routes?: ProductModule['routes'] } = {},
): CatalogEntry =>
  ({
    id,
    label: id[0].toUpperCase() + id.slice(1),
    icon: I,
    description: '',
    category: 'AI',
    status: 'enabled',
    kind: 'module',
    routes: extra.routes ?? [{ path: '', component: C }],
    ...extra,
  }) as unknown as CatalogEntry

// A registry mirroring the real shape: a :tab product (models, with an admin-only
// Routing specific), a single-screen product (vpc), a product with a declared
// specific that has NO route yet (tasks › queues), and an admin product.
const models = mod('models', {
  subpages: [{ slug: 'routing', label: 'Routing', admin: true }],
  routes: [
    { path: '', component: C },
    { path: ':tab', component: C },
  ],
})
const vpc = mod('vpc')
const tasks = mod('tasks', {
  subpages: [{ slug: 'queues', label: 'Queues' }],
  routes: [
    { path: '', component: C },
    { path: ':ns/:wid', component: C },
  ],
})
const providers = mod('providers', { admin: true })
const external = mod('gateway', { kind: 'external', href: 'https://api', routes: undefined } as never)

const CATALOG: CatalogEntry[] = [models, vpc, tasks, providers, external]
const MODULES = CATALOG.filter((e) => e.kind === 'module').map((e) => e as unknown as ProductModule)

describe('productSubpages — Overview + specifics + uniform base set', () => {
  const slugs = (e: CatalogEntry, showAdmin = true) => productSubpages(e, showAdmin).map((s) => s.slug)

  it('auto-adds Overview + the base set to a single-screen product', () => {
    expect(slugs(vpc)).toEqual(['', 'settings', 'status', 'logs', 'metrics'])
  })
  it('places a specific between Overview and the base set', () => {
    // models declares Routing (admin) — visible to an admin, before the base set.
    expect(slugs(models, true)).toEqual(['', 'routing', 'settings', 'status', 'logs', 'metrics'])
  })
  it('does NOT duplicate a base slug a product declares as a specific', () => {
    const withMetrics = mod('x', { subpages: [{ slug: 'metrics', label: 'Metrics' }] })
    expect(slugs(withMetrics)).toEqual(['', 'metrics', 'settings', 'status', 'logs'])
  })
  it('hides an admin-only specific from a customer', () => {
    expect(slugs(models, false)).toEqual(['', 'settings', 'status', 'logs', 'metrics'])
  })
  it('is empty for an external entry', () => {
    expect(productSubpages(external)).toEqual([])
  })
  it('BASE_SUBPAGES is exactly Settings · Status · Logs · Metrics', () => {
    expect(BASE_SUBPAGES.map((s) => s.slug)).toEqual(['settings', 'status', 'logs', 'metrics'])
  })
})

describe('resolveProductView — route wins, known sub-pages stub, else 404 (ask 2)', () => {
  const view = (slug: string[]) => resolveProductView(CATALOG, MODULES, slug)

  it('renders a real route (index and :tab) when one matches', () => {
    expect(view(['models']).kind).toBe('route')
    expect(view(['models', 'routing']).kind).toBe('route') // :tab catches it
  })
  it('stubs an undeclared BASE sub-page on a single-screen product', () => {
    const v = view(['vpc', 'status'])
    expect(v.kind).toBe('stub')
    if (v.kind === 'stub') expect(v.subpage.slug).toBe('status')
  })
  it('stubs a DECLARED specific that has no route yet (Tasks › Queues)', () => {
    const v = view(['tasks', 'queues'])
    expect(v.kind).toBe('stub')
    if (v.kind === 'stub') expect(v.subpage.label).toBe('Queues')
  })
  it('404s an unknown product or an unknown deep path', () => {
    expect(view(['nope']).kind).toBe('notfound')
    expect(view(['vpc', 'nope', 'deep']).kind).toBe('notfound')
  })
})

describe('subpageIsWired — mirrors the render (route vs. stub)', () => {
  it('is wired for the index and a :tab specific, not for an unrouted sub-page', () => {
    expect(subpageIsWired(MODULES, 'models', '')).toBe(true)
    expect(subpageIsWired(MODULES, 'models', 'routing')).toBe(true)
    expect(subpageIsWired(MODULES, 'vpc', 'status')).toBe(false)
    expect(subpageIsWired(MODULES, 'tasks', 'queues')).toBe(false)
  })
})

describe('isAdminView — admin product OR admin sub-page (customer gating)', () => {
  it('flags an admin product and an admin sub-page, not customer surfaces', () => {
    expect(isAdminView(CATALOG, ['providers'])).toBe(true)
    expect(isAdminView(CATALOG, ['models'])).toBe(false)
    expect(isAdminView(CATALOG, ['models', 'routing'])).toBe(true)
    expect(isAdminView(CATALOG, ['models', 'status'])).toBe(false)
  })
})

describe('destinationsFor — ⌘K indexes products + specifics, admin-gated (ask 3)', () => {
  it('indexes products then declared specifics; a deep sub-page carries its path', () => {
    const dests = destinationsFor(CATALOG, true)
    expect(dests.some((d) => d.kind === 'product' && d.entry.id === 'models')).toBe(true)
    const q = dests.find((d) => d.kind === 'subpage' && d.entry.id === 'tasks' && d.subpage.slug === 'queues')
    expect(q).toBeTruthy()
    if (q && q.kind === 'subpage') expect(q.path).toBe('/tasks/queues')
  })
  it('gates the admin product AND the admin sub-page for a customer', () => {
    const customer = destinationsFor(CATALOG, false)
    expect(customer.some((d) => d.entry.id === 'providers')).toBe(false)
    expect(customer.some((d) => d.kind === 'subpage' && d.subpage.slug === 'routing')).toBe(false)
    const admin = destinationsFor(CATALOG, true)
    expect(admin.some((d) => d.entry.id === 'providers')).toBe(true)
    expect(admin.some((d) => d.kind === 'subpage' && d.subpage.slug === 'routing')).toBe(true)
  })
})
