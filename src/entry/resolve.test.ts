import { describe, it, expect } from 'vitest'

import { resolve, type Session, type Stage, type Surface } from './resolve'

/** A fully-satisfied session that resolves to the app. Every case overrides from here. */
const READY: Session = {
  loading: false,
  authed: true,
  surface: 'guarded',
  owner: 'acme',
  adminHost: false,
  superAdmin: false,
  waitlistLoading: false,
  access: true,
  orgEntered: true,
  onboardable: true,
  onboardReady: true,
  onboarded: true,
}

const at = (patch: Partial<Session>): Stage => resolve({ ...READY, ...patch })

describe('resolve(session) → stage', () => {
  it('a fully-satisfied session → ready', () => {
    expect(resolve(READY)).toBe('ready')
  })

  describe('auth (stage: signin)', () => {
    it('loading → signin (fail-closed, even with an account)', () => {
      expect(at({ loading: true })).toBe('signin')
    })
    it('unknown surface (pre-mount) → signin', () => {
      expect(at({ surface: null })).toBe('signin')
    })
    it('the /auth/callback surface → signin (Auth completes the PKCE exchange), even if authed', () => {
      expect(at({ surface: 'callback' })).toBe('signin')
      expect(at({ surface: 'callback', authed: true })).toBe('signin')
    })
    it('the /signin surface → signin, even if authed (SignIn bounces to /)', () => {
      expect(at({ surface: 'signin' })).toBe('signin')
      expect(at({ surface: 'signin', authed: true })).toBe('signin')
    })
    it('anonymous on the landing surface → signin (public marketing landing)', () => {
      expect(at({ surface: 'landing', authed: false })).toBe('signin')
    })
    it('anonymous on a guarded surface → signin (redirect to /signin)', () => {
      expect(at({ surface: 'guarded', authed: false })).toBe('signin')
    })
    it('authed on the landing surface advances past signin', () => {
      expect(at({ surface: 'landing', authed: true })).toBe('ready')
    })
  })

  describe('product access (stage: waitlist)', () => {
    it('authed, non-operator, no access → waitlist', () => {
      expect(at({ access: false })).toBe('waitlist')
    })
    it('authed, non-operator, check in flight → waitlist (holds, never flashes the app)', () => {
      expect(at({ waitlistLoading: true, access: false })).toBe('waitlist')
    })
    it('a SuperAdmin bypasses the waitlist even with no access', () => {
      expect(at({ superAdmin: true, access: false })).toBe('ready')
    })
    it('an admin host bypasses the waitlist (via a SuperAdmin, who is not bounced)', () => {
      expect(at({ adminHost: true, superAdmin: true, access: false })).toBe('ready')
    })
  })

  describe('org scope (stage: org)', () => {
    it('authed, no org → org (create one)', () => {
      expect(at({ owner: '' })).toBe('org')
    })
    it('a non-SuperAdmin on an admin host → org (bounced to the tenant host)', () => {
      expect(at({ adminHost: true, superAdmin: false })).toBe('org')
    })
    it('a SuperAdmin on an admin host is NOT bounced', () => {
      expect(at({ adminHost: true, superAdmin: true })).toBe('ready')
    })
    it('org not yet hydrated (null) → org (Scope shows a spinner)', () => {
      expect(at({ orgEntered: null })).toBe('org')
    })
    it('org not yet entered (false) → org (Scope shows the picker)', () => {
      expect(at({ orgEntered: false })).toBe('org')
    })
  })

  describe('first-run onboarding (stage: onboard)', () => {
    it('entered, onboardable, ready, not onboarded → onboard', () => {
      expect(at({ onboarded: false })).toBe('onboard')
    })
    it('inputs not ready yet → ready (show the console while the preference loads)', () => {
      expect(at({ onboarded: false, onboardReady: false })).toBe('ready')
    })
    it('not onboardable (static embed / admin host) → ready, never onboard', () => {
      expect(at({ onboarded: false, onboardable: false })).toBe('ready')
    })
    it('already onboarded → ready', () => {
      expect(at({ onboarded: true })).toBe('ready')
    })
  })
})

/**
 * The load-bearing security property: `ready` (the real app + its data) is reachable ONLY
 * for a loaded, authenticated session that has an ENTERED org. Red verifies the dashboard
 * cannot leak to an unauthed / org-less session — these sweeps prove `resolve` can't.
 */
describe('fail-closed — resolve NEVER yields ready when it must not', () => {
  const SURFACES: Surface[] = ['callback', 'signin', 'landing', 'guarded', null]
  const BOOLS = [true, false]
  const ENTERED: Array<boolean | null> = [true, false, null]

  it('never ready while loading', () => {
    for (const surface of SURFACES)
      for (const authed of BOOLS)
        expect(resolve({ ...READY, loading: true, surface, authed })).not.toBe('ready')
  })

  it('never ready for an unauthenticated session', () => {
    for (const surface of SURFACES)
      expect(resolve({ ...READY, authed: false, surface })).not.toBe('ready')
  })

  it('never ready without an org', () => {
    for (const entered of ENTERED)
      expect(resolve({ ...READY, owner: '', orgEntered: entered })).not.toBe('ready')
  })

  it('never ready until an org is ENTERED', () => {
    expect(resolve({ ...READY, orgEntered: false })).not.toBe('ready')
    expect(resolve({ ...READY, orgEntered: null })).not.toBe('ready')
  })

  it('never ready on the auth surfaces (callback / signin / unknown)', () => {
    for (const surface of ['callback', 'signin', null] as Surface[])
      for (const authed of BOOLS)
        expect(resolve({ ...READY, surface, authed })).not.toBe('ready')
  })

  it('ready implies authed + loaded + owner + entered (exhaustive over the toggles)', () => {
    for (const loading of BOOLS)
      for (const authed of BOOLS)
        for (const surface of SURFACES)
          for (const entered of ENTERED)
            for (const owner of ['acme', '']) {
              const stage = resolve({ ...READY, loading, authed, surface, orgEntered: entered, owner })
              if (stage === 'ready') {
                expect(loading).toBe(false)
                expect(authed).toBe(true)
                expect(owner).not.toBe('')
                expect(entered).toBe(true)
                expect(surface === 'landing' || surface === 'guarded').toBe(true)
              }
            }
  })
})
