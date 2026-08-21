import { describe, expect, it } from 'vitest'

import { ADMIN_AGGREGATE_HEADS, allowAdminSurface } from '~/lib/server/admin-aggregate'
import { CLOUD_HEADS, allowCloudSurface } from '~/lib/server/proxy-allow'

/**
 * The operator-cockpit wiring is a trust boundary: the fleet management surfaces
 * (customers/revenue/analytics + the admin pricing set) must ride the GLOBAL-
 * ADMIN-gated aggregate proxy, and the customer self-service enablement (opt-in)
 * must ride the per-tenant /v1 bearer BFF — never the reverse, and never widening the
 * least-privilege allow-lists to reach iam/kms.
 */
describe('operator cockpit wiring', () => {
  it('the admin aggregate admits the new cockpit heads (read + :org sub-paths)', () => {
    for (const h of ['customers', 'revenue', 'analytics', 'pricing']) {
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
    // Enablement is the pricing registry's, on both sides: the operator's view at
    // /v1/admin/pricing/enablement and the customer's at /v1/pricing/enablement.
    expect(CLOUD_HEADS).toContain('pricing')
    expect(allowCloudSurface('v1/pricing/enablement')).toBe(true)
    expect(allowCloudSurface('v1/pricing/enablement/optin')).toBe(true)
    expect(allowCloudSurface('v1/pricing/enablement/optout')).toBe(true)
    expect(allowAdminSurface('v1/admin/pricing/enablement')).toBe(true)
  })
})
