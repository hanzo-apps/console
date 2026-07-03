import { describe, it, expect } from 'vitest'

import { allowAdminSurface, ADMIN_AGGREGATE_HEADS } from './admin-aggregate'

/**
 * The admin aggregate proxy is the console-side server gate for the cross-tenant
 * all-orgs god view (RED H1). The route runs `getAdminGate` (global-admin only)
 * first; this predicate is the least-privilege SURFACE gate that then keeps the
 * proxy from becoming a general cloud-api tunnel. It must admit ONLY the admin
 * read heads and NEVER `iam`/`kms` (which have their own tenant-scoped proxies).
 */
describe('allowAdminSurface — least-privilege admin read surface', () => {
  it('admits every declared aggregate read head', () => {
    for (const h of ADMIN_AGGREGATE_HEADS) {
      expect(allowAdminSurface(`admin/${h}`)).toBe(true)
    }
  })

  it('admits a sub-path under an allowed head', () => {
    expect(allowAdminSurface('admin/usage/by-org')).toBe(true)
    expect(allowAdminSurface('admin/audit/')).toBe(true) // trailing slash tolerated
  })

  it('admits the finance aggregate (the SaaS profitability read)', () => {
    expect(allowAdminSurface('admin/finance')).toBe(true)
  })

  it('admits the compute aggregate (the datastore fleets/bots/spend read)', () => {
    expect(allowAdminSurface('admin/compute')).toBe(true)
    expect(allowAdminSurface('admin/compute/by-org')).toBe(true)
  })

  it('REFUSES the tenant-scoped admin proxies (iam / kms) — never a tunnel', () => {
    expect(allowAdminSurface('admin/iam')).toBe(false)
    expect(allowAdminSurface('admin/iam/get-users')).toBe(false)
    expect(allowAdminSurface('admin/kms')).toBe(false)
    expect(allowAdminSurface('admin/kms/list')).toBe(false)
  })

  it('REFUSES a bare admin, an unknown head, and anything outside admin/', () => {
    expect(allowAdminSurface('admin')).toBe(false)
    expect(allowAdminSurface('admin/')).toBe(false)
    expect(allowAdminSurface('admin/secrets')).toBe(false)
    expect(allowAdminSurface('iam/get-users')).toBe(false)
    expect(allowAdminSurface('v1/agents')).toBe(false)
    expect(allowAdminSurface('')).toBe(false)
  })

  it('is not fooled by a leading slash on the normalized path', () => {
    expect(allowAdminSurface('/admin/overview')).toBe(true)
    expect(allowAdminSurface('/admin/iam')).toBe(false)
  })
})
