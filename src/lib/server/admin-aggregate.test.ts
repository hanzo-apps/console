import { describe, it, expect } from 'vitest'

import { allowAdminSurface, ADMIN_AGGREGATE_HEADS } from './admin-aggregate'

/**
 * The admin aggregate proxy is the console-side server gate for the cross-tenant
 * all-orgs god view (RED H1). The route runs `getAdminGate` (global-admin only)
 * first; this predicate is the least-privilege SURFACE gate that then keeps the
 * proxy from becoming a general cloud-api tunnel. It must admit ONLY the admin
 * read heads and NEVER `iam`/`kms` (which have their own tenant-scoped proxies).
 *
 * The gate validates the EXACT forwarded upstream shape — `v1/admin/<head>` — because
 * cloud serves every admin route under `/v1/admin/*` and `route.ts` rebuilds the path
 * with the `v1/` prefix (`forwardWithUserBearer` forwards it VERBATIM). The bare
 * `admin/<head>` form (the pre-fix, wrong path that 404'd at cloud) is NOT admitted.
 */
describe('allowAdminSurface — least-privilege admin read surface (v1/admin/<head>)', () => {
  it('admits every declared aggregate read head under v1/admin/', () => {
    for (const h of ADMIN_AGGREGATE_HEADS) {
      expect(allowAdminSurface(`v1/admin/${h}`)).toBe(true)
    }
  })

  it('admits a sub-path under an allowed head', () => {
    expect(allowAdminSurface('v1/admin/usage/by-org')).toBe(true)
    expect(allowAdminSurface('v1/admin/audit/')).toBe(true) // trailing slash tolerated
  })

  it('admits the finance aggregate (the SaaS profitability read)', () => {
    expect(allowAdminSurface('v1/admin/finance')).toBe(true)
  })

  it('admits the compute aggregate (the datastore fleets/bots/spend read)', () => {
    expect(allowAdminSurface('v1/admin/compute')).toBe(true)
    expect(allowAdminSurface('v1/admin/compute/by-org')).toBe(true)
  })

  it('admits the fleet o11y aggregate (the cross-org datastore observability read)', () => {
    expect(allowAdminSurface('v1/admin/o11y')).toBe(true)
    expect(ADMIN_AGGREGATE_HEADS).toContain('o11y')
  })

  it('admits the treasury aggregate (the reserve-fund report + policy/sweep/seed/anchor)', () => {
    expect(allowAdminSurface('v1/admin/treasury')).toBe(true)
    expect(allowAdminSurface('v1/admin/treasury/policy')).toBe(true)
    expect(allowAdminSurface('v1/admin/treasury/sweep')).toBe(true)
    expect(allowAdminSurface('v1/admin/treasury/seed')).toBe(true)
    expect(allowAdminSurface('v1/admin/treasury/anchor')).toBe(true)
    expect(ADMIN_AGGREGATE_HEADS).toContain('treasury')
  })

  it('admits the promos singleton (the platform plan promo — GET + PUT)', () => {
    expect(allowAdminSurface('v1/admin/promos')).toBe(true)
    expect(ADMIN_AGGREGATE_HEADS).toContain('promos')
  })

  it('admits the caps oversight surface — the list AND the :id edit/delete sub-path', () => {
    expect(allowAdminSurface('v1/admin/caps')).toBe(true)
    // PATCH/DELETE /v1/admin/caps/:id ride the same head via the sub-path rule.
    expect(allowAdminSurface('v1/admin/caps/alert-123')).toBe(true)
    expect(ADMIN_AGGREGATE_HEADS).toContain('caps')
  })

  it('admits the providers control board — the list AND the two mutation sub-paths', () => {
    expect(allowAdminSurface('v1/admin/providers')).toBe(true)
    // The POST mutations (toggle enable/disable, set primary) ride the same head.
    expect(allowAdminSurface('v1/admin/providers/toggle')).toBe(true)
    expect(allowAdminSurface('v1/admin/providers/primary')).toBe(true)
  })

  it('REFUSES the tenant-scoped admin proxies (iam / kms) — never a tunnel', () => {
    expect(allowAdminSurface('v1/admin/iam')).toBe(false)
    expect(allowAdminSurface('v1/admin/iam/get-users')).toBe(false)
    expect(allowAdminSurface('v1/admin/kms')).toBe(false)
    expect(allowAdminSurface('v1/admin/kms/list')).toBe(false)
  })

  it('REFUSES the normalized traversal target (v1/admin/iam reached via ../ collapse)', () => {
    // pathIsClean rejects the raw `v1/admin/providers/../iam` at layer 1 (literal `..`);
    // this is the belt-and-suspenders layer-2 refusal of the WHATWG-normalized form.
    expect(allowAdminSurface('v1/admin/iam')).toBe(false)
    expect(allowAdminSurface('v1/admin/kms')).toBe(false)
  })

  it('REFUSES a bare v1/admin, an unknown head, and anything outside v1/admin/', () => {
    expect(allowAdminSurface('v1/admin')).toBe(false)
    expect(allowAdminSurface('v1/admin/')).toBe(false)
    expect(allowAdminSurface('v1/admin/secrets')).toBe(false)
    expect(allowAdminSurface('v1/iam/get-users')).toBe(false)
    expect(allowAdminSurface('v1/agents')).toBe(false)
    expect(allowAdminSurface('')).toBe(false)
  })

  it('REFUSES the pre-fix bare admin/<head> shape (never reaches a real cloud route)', () => {
    // The old (buggy) path built `admin/providers` and 404'd at cloud. The gate now
    // keys strictly on `v1/admin/<head>`, so the bare form is refused — no second,
    // ambiguous accepted shape (one way only).
    expect(allowAdminSurface('admin/providers')).toBe(false)
    expect(allowAdminSurface('admin/overview')).toBe(false)
    expect(allowAdminSurface('admin/iam')).toBe(false)
  })

  it('is not fooled by a leading slash on the normalized path', () => {
    expect(allowAdminSurface('/v1/admin/overview')).toBe(true)
    expect(allowAdminSurface('/v1/admin/iam')).toBe(false)
  })
})
