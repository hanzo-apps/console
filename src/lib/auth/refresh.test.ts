import { afterEach, describe, expect, it, vi } from 'vitest'

import { refreshSession } from './refresh'

afterEach(() => vi.unstubAllGlobals())

describe('refreshSession (single-flight)', () => {
  it('POSTs /auth/refresh with credentials and returns ok', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(refreshSession()).resolves.toBe(true)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(String(url)).toBe('/auth/refresh')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
  })

  it('returns false on a 401 (no session / expired refresh token)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })))
    await expect(refreshSession()).resolves.toBe(false)
  })

  it('returns false (never throws) on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    await expect(refreshSession()).resolves.toBe(false)
  })

  it('in the static embed, skips the /auth/refresh POST entirely (no 405 noise)', async () => {
    // The embed has no BFF handler for /auth/refresh (POST → 405); the console runs on
    // the casibase session there, so refreshSession must resolve false WITHOUT fetching.
    vi.resetModules()
    vi.stubEnv('NEXT_PUBLIC_CONSOLE_EMBED', '1')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { refreshSession: embedRefresh } = await import('./refresh')
    await expect(embedRefresh()).resolves.toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('coalesces concurrent callers into ONE rotation (single-flight)', async () => {
    // Rotating refresh tokens are one-time-use: two concurrent refreshes would race
    // and the second would replay a now-invalid token. Assert both callers share the
    // SAME in-flight request.
    let resolveFetch: (r: Response) => void = () => {}
    const gate = new Promise<Response>((res) => (resolveFetch = res))
    const fetchMock = vi.fn(() => gate)
    vi.stubGlobal('fetch', fetchMock)

    const a = refreshSession()
    const b = refreshSession()
    expect(fetchMock).toHaveBeenCalledTimes(1) // one shared flight

    resolveFetch(new Response('{}', { status: 200 }))
    expect(await a).toBe(true)
    expect(await b).toBe(true)

    // A caller AFTER the round settles starts a fresh flight.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
    await expect(refreshSession()).resolves.toBe(true)
  })
})
