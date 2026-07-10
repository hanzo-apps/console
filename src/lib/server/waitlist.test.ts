import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The admin operator surface (admin.<brand>) is NEVER a waitlisted consumer product.
 * `waitlistAccess` must short-circuit to hasAccess=true on an admin host WITHOUT ever
 * consulting the waitlist plugin — so an operator (the seeded superuser) reaches the
 * cockpit even when the plugin would return a closed verdict for that email. Real
 * access to admin.<brand> is still enforced by admin-guard + the cloud global-admin
 * gate — this only lifts the consumer waitlist UX.
 *
 * The module reads WAITLIST_URL at import, so each case stubs the env then dynamically
 * imports a fresh module; global fetch is spied to prove whether the plugin was hit.
 */
afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  vi.restoreAllMocks()
})

describe('waitlistAccess — admin operator surface bypass', () => {
  it('grants access on an admin host WITHOUT consulting the plugin (even when it would say closed)', async () => {
    vi.stubEnv('WAITLIST_URL', 'http://base.hanzo.svc') // gate CONFIGURED
    vi.resetModules()
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ hasAccess: false, rank: 42, total: 100 }), { status: 200 }))
    const { waitlistAccess } = await import('./waitlist')

    const r = await waitlistAccess('z@hanzo.ai', 'admin.hanzo.ai')

    expect(r).toEqual({ hasAccess: true, status: null })
    expect(spy).not.toHaveBeenCalled() // operator surface never asks the plugin
  })

  it('also bypasses a brand admin host (admin.lux.cloud) with a port', async () => {
    vi.stubEnv('WAITLIST_URL', 'http://base.hanzo.svc')
    vi.resetModules()
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ hasAccess: false }), { status: 200 }))
    const { waitlistAccess } = await import('./waitlist')

    const r = await waitlistAccess('z@lux.network', 'admin.lux.cloud:443')

    expect(r).toEqual({ hasAccess: true, status: null })
    expect(spy).not.toHaveBeenCalled()
  })

  it('a non-admin host with the gate configured DOES consult the plugin and honors a closed verdict', async () => {
    vi.stubEnv('WAITLIST_URL', 'http://base.hanzo.svc')
    vi.resetModules()
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ hasAccess: false, rank: 42, total: 100 }), { status: 200 }))
    const { waitlistAccess } = await import('./waitlist')

    const r = await waitlistAccess('dave@maxpower.com', 'console.hanzo.ai')

    expect(spy).toHaveBeenCalled() // consumer surface still gated
    expect(r.hasAccess).toBe(false)
    expect(r.status?.rank).toBe(42)
  })
})
