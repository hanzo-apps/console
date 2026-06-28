import { describe, it, expect, vi, beforeEach } from 'vitest'

import { AccountApi } from '~/lib/api/account'

/**
 * This is an ADMIN console: casibase auto-creates an "anonymous-user" session,
 * which is NOT a real sign-in. `current()` MUST treat it (and any failure) as
 * logged-out, or the AuthGate would let an unauthenticated visitor in.
 */
function jsonRes(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

describe('AccountApi.current', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('returns the account for a real sign-in', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonRes({ status: 'ok', msg: '', data: { owner: 'hanzo', name: 'a', type: 'normal-user', isAdmin: true } }),
    ))
    const acct = await AccountApi.current()
    expect(acct).toMatchObject({ name: 'a', isAdmin: true })
  })

  it('treats an anonymous-user session as logged-out (null)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonRes({ status: 'ok', msg: '', data: { owner: 'hanzo', name: 'anon', type: 'anonymous-user' } }),
    ))
    expect(await AccountApi.current()).toBeNull()
  })

  it('returns null on a 401 (no valid session)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes({}, 401)))
    expect(await AccountApi.current()).toBeNull()
  })

  it('returns null when get-account errors out (never throws)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network') }))
    expect(await AccountApi.current()).toBeNull()
  })

  it('returns null for an ok envelope with empty data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ status: 'ok', msg: '', data: null })))
    expect(await AccountApi.current()).toBeNull()
  })
})

describe('AccountApi.updatePreferences', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('posts the partial and returns the merged map', async () => {
    const fetchMock = vi.fn(async () =>
      jsonRes({ status: 'ok', msg: '', data: { favorites: ['chat'], theme: 'dark' } }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const merged = await AccountApi.updatePreferences({ theme: 'dark' })
    expect(merged).toEqual({ favorites: ['chat'], theme: 'dark' })
    expect(fetchMock.mock.calls[0][0]).toBe('https://console.hanzo.ai/v1/update-preferences')
    expect(fetchMock.mock.calls[0][1].method).toBe('POST')
  })

  it('returns {} when the backend omits data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ status: 'ok', msg: '', data: undefined })))
    expect(await AccountApi.updatePreferences({ x: 1 })).toEqual({})
  })
})
