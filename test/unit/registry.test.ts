import { describe, it, expect } from 'vitest'

import {
  catalog,
  categoryOrder,
  productModules,
  findModule,
  findEntry,
  catalogByCategory,
  visibleCatalog,
  type CatalogEntry,
} from '~/lib/products/registry'

/**
 * The catalog is the single source of truth for nav + routing. If it drifts
 * (duplicate id, dead route, empty category, admin entry that leaks), the whole
 * console drifts. These invariants are the guard rails.
 */
describe('catalog integrity', () => {
  it('is non-empty', () => {
    expect(catalog.length).toBeGreaterThan(50)
  })

  it('has unique ids', () => {
    const ids = catalog.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('only uses declared categories', () => {
    for (const e of catalog) {
      expect(categoryOrder, `${e.id} category`).toContain(e.category)
    }
  })

  it('only uses the three honest statuses', () => {
    for (const e of catalog) {
      expect(['enabled', 'external', 'soon']).toContain(e.status)
    }
  })

  it('every module entry has routes, an index route, and real components', () => {
    const modules = catalog.filter((e): e is Extract<CatalogEntry, { kind: 'module' }> => e.kind === 'module')
    for (const m of modules) {
      expect(m.routes.length, `${m.id} routes`).toBeGreaterThan(0)
      expect(m.routes.some((r) => r.path === ''), `${m.id} has index route`).toBe(true)
      for (const r of m.routes) {
        expect(typeof r.component, `${m.id}#${r.path} component`).toBe('function')
        // Route patterns are simple segment lists, never absolute paths.
        expect(r.path.startsWith('/'), `${m.id}#${r.path} not absolute`).toBe(false)
      }
    }
  })

  it('every external entry has a real https href', () => {
    const externals = catalog.filter((e): e is Extract<CatalogEntry, { kind: 'external' }> => e.kind === 'external')
    expect(externals.length).toBeGreaterThan(0)
    for (const e of externals) {
      expect(e.href, `${e.id} href`).toMatch(/^https:\/\//)
    }
  })

  it('soon entries are honest modules (single index route)', () => {
    for (const e of catalog) {
      if (e.status === 'soon') {
        expect(e.kind, `${e.id} soon kind`).toBe('module')
      }
    }
  })

  it('derives productModules as exactly the module subset, in order', () => {
    const moduleIds = catalog.filter((e) => e.kind === 'module').map((e) => e.id)
    expect(productModules.map((m) => m.id)).toEqual(moduleIds)
  })

  it('findModule resolves every module and rejects external ids', () => {
    for (const m of productModules) expect(findModule(m.id)?.id).toBe(m.id)
    expect(findModule('dns')).toBeUndefined() // external
    expect(findModule('nope')).toBeUndefined()
  })

  it('findEntry resolves any catalog id', () => {
    expect(findEntry('models')?.kind).toBe('module')
    expect(findEntry('gateway')?.kind).toBe('module') // in-console gateway view
    expect(findEntry('dns')?.kind).toBe('external')
    expect(findEntry('nope')).toBeUndefined()
  })
})

describe('catalogByCategory', () => {
  it('returns all ten categories in declared order with no empty groups', () => {
    const groups = catalogByCategory()
    expect(groups.map((g) => g.category)).toEqual(categoryOrder)
    for (const g of groups) expect(g.entries.length, `${g.category}`).toBeGreaterThan(0)
  })

  it('partitions the catalog exactly (no entry lost or duplicated)', () => {
    const flat = catalogByCategory().flatMap((g) => g.entries)
    expect(flat.length).toBe(catalog.length)
  })
})

describe('admin visibility (least privilege)', () => {
  it('marks the sensitive surfaces admin-only', () => {
    const adminIds = catalog.filter((e) => e.admin).map((e) => e.id).sort()
    // IAM/KMS/Secrets/Audit/Clusters/Kubernetes are admin-gated.
    expect(adminIds).toEqual(
      ['audit', 'clusters', 'iam', 'kms', 'kubernetes', 'secrets'].sort(),
    )
  })

  it('hides admin entries from non-admins, shows everything to admins', () => {
    const asAdmin = visibleCatalog(true)
    const asMember = visibleCatalog(false)
    expect(asAdmin.length).toBe(catalog.length)
    expect(asMember.length).toBeLessThan(catalog.length)
    // No admin entry survives for a non-admin.
    expect(asMember.some((e) => e.admin)).toBe(false)
    // A non-admin still sees ordinary products.
    expect(asMember.some((e) => e.id === 'models')).toBe(true)
  })
})
