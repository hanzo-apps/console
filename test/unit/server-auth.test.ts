import { describe, it, expect, vi, beforeEach } from 'vitest'

import { getServerAccount, isAdminAccount } from '~/lib/auth/server'

const ORIGIN = 'https://console.hanzo.ai'
const envRes = (account: unknown) =>
  new Response(JSON.stringify({ status: 'ok', msg: '', data: account }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

describe('getServerAccount (fail-secure)', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('returns null with no cookie and makes NO network call', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    expect(await getServerAccount(null, ORIGIN)).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })

  it('returns the account for a real session', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => envRes({ owner: 'hanzo', name: 'ada', isAdmin: true, type: 'normal-user' })))
    expect(await getServerAccount('sid=1', ORIGIN)).toMatchObject({ name: 'ada', isAdmin: true })
  })

  it('treats an anonymous casibase session as logged-out', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => envRes({ owner: 'hanzo', name: 'anonymous', type: 'anonymous-user' })))
    expect(await getServerAccount('sid=1', ORIGIN)).toBeNull()
  })

  it('returns null on a non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })))
    expect(await getServerAccount('sid=1', ORIGIN)).toBeNull()
  })

  it('returns null on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('down')
    }))
    expect(await getServerAccount('sid=1', ORIGIN)).toBeNull()
  })

  it('returns null on an unparseable (HTML) body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } })))
    expect(await getServerAccount('sid=1', ORIGIN)).toBeNull()
  })

  it('forwards the cookie to same-origin /v1/get-account', async () => {
    const f = vi.fn(async () => envRes({ owner: 'hanzo', name: 'ada', isAdmin: true, type: 'normal-user' }))
    vi.stubGlobal('fetch', f)
    await getServerAccount('sid=abc', ORIGIN)
    const [url, init] = f.mock.calls[0] as [string, RequestInit]
    expect(String(url)).toBe(`${ORIGIN}/v1/get-account`)
    expect(init.headers).toMatchObject({ cookie: 'sid=abc' })
  })
})

describe('isAdminAccount (deny-by-default)', () => {
  it('null and non-admin are false; admin is true', () => {
    expect(isAdminAccount(null)).toBe(false)
    expect(isAdminAccount({ owner: 'h', name: 'mo', isAdmin: false })).toBe(false)
    expect(isAdminAccount({ owner: 'h', name: 'ada', isAdmin: true })).toBe(true)
  })
})
