import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { getServerAccount, isGlobalAdminAccount } from '~/lib/auth/server'

const CLOUD = 'https://cloud-api.test'
const envRes = (account: unknown) =>
  new Response(JSON.stringify({ status: 'ok', msg: '', data: account }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

describe('getServerAccount (fail-secure, pinned authority)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.stubEnv('CLOUD_URL', CLOUD)
  })
  afterEach(() => vi.unstubAllEnvs())

  it('returns null with no cookie and makes NO network call', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    expect(await getServerAccount(null)).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })

  it('returns the account for a real session', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => envRes({ owner: 'hanzo', name: 'ada', isAdmin: true, type: 'normal-user' })))
    expect(await getServerAccount('sid=1')).toMatchObject({ owner: 'hanzo', name: 'ada', isAdmin: true })
  })

  it('treats an anonymous casibase session as logged-out', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => envRes({ owner: 'hanzo', name: 'anonymous', type: 'anonymous-user' })))
    expect(await getServerAccount('sid=1')).toBeNull()
  })

  it('returns null on a non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })))
    expect(await getServerAccount('sid=1')).toBeNull()
  })

  it('returns null on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('down')
    }))
    expect(await getServerAccount('sid=1')).toBeNull()
  })

  it('returns null on an unparseable (HTML) body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } })))
    expect(await getServerAccount('sid=1')).toBeNull()
  })

  it('calls the PINNED CLOUD_URL authority — never a request-derived origin', async () => {
    const f = vi.fn(async () => envRes({ owner: 'hanzo', name: 'ada', isAdmin: true, type: 'normal-user' }))
    vi.stubGlobal('fetch', f)
    await getServerAccount('sid=abc')
    const [url, init] = f.mock.calls[0] as [string, RequestInit]
    expect(String(url)).toBe(`${CLOUD}/v1/get-account`)
    expect(init.headers).toMatchObject({ cookie: 'sid=abc' })
  })

  it('FAILS SECURE when no authority is pinned (CLOUD_URL unset): null, no network call', async () => {
    vi.unstubAllEnvs() // CLOUD_URL + NEXT_PUBLIC_CLOUD_URL both unset
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    expect(await getServerAccount('sid=1')).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })
})

describe('isGlobalAdminAccount (deny-by-default, GLOBAL admin only)', () => {
  it('null is false', () => {
    expect(isGlobalAdminAccount(null)).toBe(false)
  })

  it('a GLOBAL admin (owner == admin org) is true', () => {
    expect(isGlobalAdminAccount({ owner: 'admin', name: 'root', isAdmin: true, isGlobalAdmin: false })).toBe(true)
  })

  it("casdoor's reserved built-in org is global admin", () => {
    expect(isGlobalAdminAccount({ owner: 'built-in', name: 'admin', isAdmin: true, isGlobalAdmin: false })).toBe(true)
  })

  it('an explicit isGlobalAdmin flag (any owner) is true (future-proof)', () => {
    expect(isGlobalAdminAccount({ owner: 'hanzo', name: 'x', isAdmin: false, isGlobalAdmin: true })).toBe(true)
  })

  // THE C1 FIX: a tenant ORG admin must NOT be a global admin.
  it('an ORG admin (isAdmin=true) of a customer org is NOT a global admin', () => {
    expect(isGlobalAdminAccount({ owner: 'maxpower', name: 'davelorenzini', isAdmin: true, isGlobalAdmin: false })).toBe(false)
  })

  it('the hanzo tenant org admin is NOT a global admin', () => {
    expect(isGlobalAdminAccount({ owner: 'hanzo', name: 'z', isAdmin: true, isGlobalAdmin: false })).toBe(false)
  })

  // Mirror the backend exactly: IsGlobalAdmin() == (Owner == conf.AdminOrg),
  // owner-only — membership of the admin org IS global, no org-admin flag needed.
  it('a member of the admin org is global admin even without the org-admin flag', () => {
    expect(isGlobalAdminAccount({ owner: 'admin', name: 'x', isAdmin: false, isGlobalAdmin: false })).toBe(true)
  })

  it('a normal customer user is not a global admin', () => {
    expect(isGlobalAdminAccount({ owner: 'maxpower', name: 'mo', isAdmin: false, isGlobalAdmin: false })).toBe(false)
  })
})
