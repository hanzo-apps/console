import { describe, it, expect } from 'vitest'

import { resolveRouting, type OrgRoutingDefaults } from './ai-accounts'

/**
 * `resolveRouting` is the ONE pure resolution of the effective smart-routing state
 * from the user's tri-state cookie override (`true`/`false`/`null`) and the
 * server-driven org defaults (or `null` when the defaults endpoint was unreachable —
 * older cloud-api / network error → FAIL SOFT to the preference alone).
 */
const org = (autoRoutingActive: boolean, defaultSessionRouting: boolean): OrgRoutingDefaults => ({
  autoRoutingActive,
  defaultSessionRouting,
})

describe('resolveRouting', () => {
  it('fails soft to the preference alone when there are no org defaults', () => {
    // No org info (older cloud-api / error). Behaves exactly as before the endpoint:
    // the user's own preference, off when never set.
    expect(resolveRouting(null, null)).toEqual({ enabled: false, toggleDisabled: false, orgDefault: null })
    expect(resolveRouting(true, null)).toEqual({ enabled: true, toggleDisabled: false, orgDefault: null })
    expect(resolveRouting(false, null)).toEqual({ enabled: false, toggleDisabled: false, orgDefault: null })
  })

  it('an unset override follows the org default', () => {
    expect(resolveRouting(null, org(true, true))).toEqual({ enabled: true, toggleDisabled: false, orgDefault: true })
    expect(resolveRouting(null, org(true, false))).toEqual({ enabled: false, toggleDisabled: false, orgDefault: false })
  })

  it('an explicit override wins over the org default (both directions)', () => {
    expect(resolveRouting(false, org(true, true))).toEqual({ enabled: false, toggleDisabled: false, orgDefault: true })
    expect(resolveRouting(true, org(true, false))).toEqual({ enabled: true, toggleDisabled: false, orgDefault: false })
  })

  it('an org that disabled routing wins — toggle off + disabled regardless of the user preference', () => {
    expect(resolveRouting(true, org(false, true))).toEqual({ enabled: false, toggleDisabled: true, orgDefault: null })
    expect(resolveRouting(null, org(false, false))).toEqual({ enabled: false, toggleDisabled: true, orgDefault: null })
    expect(resolveRouting(false, org(false, true))).toEqual({ enabled: false, toggleDisabled: true, orgDefault: null })
  })
})
