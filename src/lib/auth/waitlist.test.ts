import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { fetchWaitlist } from './waitlist'

/**
 * The client access wire. Proves the ACTUAL GET to `/auth/waitlist` and the
 * FAIL-OPEN contract: a non-ok response or a thrown fetch must resolve to
 * hasAccess:true so a blip never traps a signed-in user on the gate. A concrete
 * closed verdict (hasAccess:false) is passed through untouched.
 */
describe('fetchWaitlist', () => {
  const realFetch = globalThis.fetch
  beforeEach(() => {
    vi.restoreAllMocks()
  })
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('passes through a concrete access verdict', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ hasAccess: false, status: { rank: 42, refCode: 'Ab12' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch
    const v = await fetchWaitlist()
    expect(v.hasAccess).toBe(false)
    expect(v.status?.rank).toBe(42)
    expect((globalThis.fetch as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      '/auth/waitlist',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('fails OPEN on a non-ok response', async () => {
    globalThis.fetch = vi.fn(async () => new Response('nope', { status: 502 })) as unknown as typeof fetch
    const v = await fetchWaitlist()
    expect(v).toEqual({ hasAccess: true, status: null })
  })

  it('fails OPEN when fetch throws', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch
    const v = await fetchWaitlist()
    expect(v).toEqual({ hasAccess: true, status: null })
  })

  it('treats a missing hasAccess field as access (open)', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ status: null }), { status: 200 }),
    ) as unknown as typeof fetch
    const v = await fetchWaitlist()
    expect(v.hasAccess).toBe(true)
  })
})
