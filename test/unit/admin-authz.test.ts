import { describe, it, expect } from 'vitest'

import { ADMIN_PRODUCT_IDS, isAdminProductId } from '~/lib/auth/admin'
import { catalog } from '~/lib/products/registry'

describe('admin product ids — single source of truth', () => {
  it('exactly mirrors the catalog `admin: true` entries (drift guard)', () => {
    const fromCatalog = new Set(catalog.filter((e) => e.admin).map((e) => e.id))
    expect(fromCatalog).toEqual(new Set(ADMIN_PRODUCT_IDS))
  })

  it('every admin id is a real catalog entry', () => {
    const ids = new Set(catalog.map((e) => e.id))
    for (const id of ADMIN_PRODUCT_IDS) expect(ids.has(id), `${id} exists`).toBe(true)
  })

  it('covers the sensitive surfaces', () => {
    for (const id of ['iam', 'kms', 'secrets', 'audit', 'clusters', 'kubernetes']) {
      expect(isAdminProductId(id), `${id} is admin-gated`).toBe(true)
    }
  })

  it('ordinary products are not admin-gated', () => {
    for (const id of ['models', 'chat', 'settings', 'playground', 'vector']) {
      expect(isAdminProductId(id), `${id} is open`).toBe(false)
    }
  })
})
