import { describe, expect, it } from 'vitest'

import { ADMIN_AGGREGATE_HEADS, allowAdminSurface } from '~/lib/server/admin-aggregate'
import { CLOUD_HEADS, allowCloudSurface } from '~/lib/server/proxy-allow'

/**
 * The operator-cockpit wiring is a trust boundary: the fleet management surfaces
 * (customers/revenue/analytics + the admin enablement set) must ride the GLOBAL-
 * ADMIN-gated aggregate proxy, and the customer self-service enablement (opt-in)
 * must ride the per-tenant /v1 bearer BFF — never the reverse, and never widening the
 * least-privilege allow-lists to reach iam/kms.
 */
describe('operator cockpit wiring', () => {
  it('the admin aggregate admits the new cockpit heads (read + :org sub-paths)', () => {
    for (const h of ['customers', 'revenue', 'analytics', 'enablement']) {
      expect(allowAdminSurface(`v1/admin/${h}`)).toBe(true)
      expect(allowAdminSurface(`v1/admin/${h}/acme`)).toBe(true)
      expect(allowAdminSurface(`v1/admin/${h}/acme/credit`)).toBe(true)
      expect(ADMIN_AGGREGATE_HEADS).toContain(h)
    }
  })

  it('does NOT widen the surface — iam/kms and a bare admin stay refused', () => {
    expect(allowAdminSurface('v1/admin/iam')).toBe(false)
    expect(allowAdminSurface('v1/admin/kms')).toBe(false)
    expect(allowAdminSurface('v1/admin')).toBe(false)
    // a traversal whose normalized head is iam is refused (head ∉ ALLOWED)
    expect(allowAdminSurface('v1/admin/iam/get-users')).toBe(false)
  })

  it('the customer self-service enablement rides the per-tenant /v1 bearer BFF', () => {
    expect(CLOUD_HEADS).toContain('enablement')
    expect(allowCloudSurface('v1/enablement')).toBe(true)
    expect(allowCloudSurface('v1/enablement/optin')).toBe(true)
    expect(allowCloudSurface('v1/enablement/optout')).toBe(true)
  })
})
