import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  accessClaims,
  clearCookies,
  consoleSession,
  deviceCodeGrant,
  durableSessionClientId,
  open,
  passwordGrant,
  pkceCodeGrant,
  readRefreshToken,
  refreshGrant,
  sameSubject,
  seal,
  sealSession,
  setCookies,
  SessionError,
  SESSION_COOKIE,
  REFRESH_COOKIE,
  type CookieDirective,
} from './session'

/** A minimal NextRequest-shaped stub carrying a set of cookies. */
function reqWithCookies(map: Record<string, string>) {
  return {
    cookies: { get: (name: string) => (map[name] !== undefined ? { value: map[name] } : undefined) },
  } as unknown as import('next/server').NextRequest
}

/** The name→value map of the PRESENT (non-cleared) cookies in a directive set. */
function cookieMap(dirs: CookieDirective[]): Record<string, string> {
  const m: Record<string, string> = {}
  for (const d of dirs) if (d.maxAge > 0 && d.value) m[d.name] = d.value
  return m
}

/** A base64url JWT with the given payload claims (header + sig are inert here). */
function fakeJwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(payload)}.sig`
}

const Z_CLAIMS = { owner: 'hanzo', name: 'z', email: 'z@hanzo.ai', isAdmin: true, type: 'normal-user' }

describe('AEAD seal/open', () => {
  it('round-trips a sealed value', () => {
    const v = { e: Date.now() + 60_000, c: { owner: 'hanzo', name: 'z' } }
    const sealed = seal(v)
    expect(sealed).not.toContain('hanzo') // opaque, not plaintext
    expect(open(sealed)).toEqual(v)
  })

  it('rejects tampered, truncated, and garbage ciphertext (fail-closed)', () => {
    const sealed = seal({ t: 'refresh-token' })
    expect(open(undefined)).toBeNull()
    expect(open('')).toBeNull()
    expect(open('not-base64url!!')).toBeNull()
    expect(open(sealed.slice(0, 10))).toBeNull() // truncated
    const buf = Buffer.from(sealed, 'base64url')
    buf[buf.length - 1] ^= 0xff // flip a byte → GCM auth mismatch
    expect(open(buf.toString('base64url'))).toBeNull()
  })

  it('a foreign blob never opens (isolation)', () => {
    expect(open(Buffer.from('random-bytes-not-a-seal-abc').toString('base64url'))).toBeNull()
  })
})

describe('accessClaims', () => {
  it('projects owner/name/email/isAdmin/type from a JWT payload', () => {
    expect(accessClaims(fakeJwt(Z_CLAIMS))).toMatchObject({ owner: 'hanzo', name: 'z', email: 'z@hanzo.ai', isAdmin: true })
  })
  it('accepts email_verified (snake) as emailVerified', () => {
    expect(accessClaims(fakeJwt({ ...Z_CLAIMS, email_verified: true }))?.emailVerified).toBe(true)
  })
  it('never surfaces secret material even when present in the token', () => {
    const c = accessClaims(fakeJwt({ ...Z_CLAIMS, password: 'hash', totpSecret: 's' })) as Record<string, unknown>
    expect(c.password).toBeUndefined()
    expect(c.totpSecret).toBeUndefined()
  })
  it('returns null on a malformed token', () => {
    expect(accessClaims('not-a-jwt')).toBeNull()
    expect(accessClaims('aaa.notvalidjson.sig')).toBeNull()
  })
})

describe('sealSession (identity + refresh, browser-safe)', () => {
  it('seals a SMALL identity cookie (projected claims, NOT the ~KB access JWT)', () => {
    const bigAccess = fakeJwt({ ...Z_CLAIMS, blob: 'x'.repeat(6000) }) // simulate a fat IAM token
    const r = sealSession({ accessToken: bigAccess, refreshToken: 'rt', expiresIn: 3600 })
    expect(r?.expiresInMs).toBe(3600_000)
    expect(r?.claims.name).toBe('z')
    // The identity cookie is bounded — it does NOT carry the fat access token.
    expect(r!.identity).not.toContain(bigAccess.slice(0, 500))
    expect(Buffer.from(r!.identity, 'base64url').length).toBeLessThan(2048)
    // The identity opens to {e, c}; the refresh opens to {t}.
    expect(open<{ c: { name: string } }>(r!.identity)?.c.name).toBe('z')
    expect(open<{ t: string }>(r!.refresh)?.t).toBe('rt')
  })

  it('returns null when the access token carries no usable identity', () => {
    expect(sealSession({ accessToken: 'not-a-jwt', refreshToken: 'r', expiresIn: 3600 })).toBeNull()
    expect(sealSession({ accessToken: fakeJwt({ owner: 'hanzo' }), refreshToken: 'r', expiresIn: 3600 })).toBeNull()
  })

  it('defaults a missing expires_in to 1h', () => {
    expect(sealSession({ accessToken: fakeJwt(Z_CLAIMS), refreshToken: 'r', expiresIn: 0 })?.expiresInMs).toBe(3600_000)
  })
})

describe('cookies: setCookies / clearCookies / round-trip', () => {
  it('identity is Path=/ small; refresh is Path=/auth, CHUNKED for a big token', () => {
    // A big refresh token → sealed > one cookie → multiple hz_rt chunks, each browser-safe.
    const bigRefresh = 'R'.repeat(5000)
    const s = sealSession({ accessToken: fakeJwt(Z_CLAIMS), refreshToken: bigRefresh, expiresIn: 3600 })!
    const dirs = setCookies(s.identity, s.refresh)
    const id = dirs.find((d) => d.name === SESSION_COOKIE)!
    expect(id.path).toBe('/')
    expect(Buffer.byteLength(id.value)).toBeLessThan(4096) // browser cap
    const rtChunks = dirs.filter((d) => d.name.startsWith(REFRESH_COOKIE) && d.maxAge > 0)
    expect(rtChunks.length).toBeGreaterThanOrEqual(2) // chunked
    for (const c of rtChunks) {
      expect(c.path).toBe('/auth') // scoped away from /v1 + the BFF
      expect(Buffer.byteLength(c.value)).toBeLessThan(4096)
    }
    // Reassembling the chunks recovers the exact refresh token.
    expect(readRefreshToken(reqWithCookies(cookieMap(dirs)))).toBe(bigRefresh)
  })

  it('consoleSession reads the fresh identity; refresh is invisible to it', () => {
    const s = sealSession({ accessToken: fakeJwt(Z_CLAIMS), refreshToken: 'rt', expiresIn: 3600 })!
    const req = reqWithCookies(cookieMap(setCookies(s.identity, s.refresh)))
    const sess = consoleSession(req)
    expect(sess?.claims.name).toBe('z')
    expect(sess?.claims.isAdmin).toBe(true)
    expect(sess?.expiresInSec).toBeGreaterThan(3000)
    expect(readRefreshToken(req)).toBe('rt')
  })

  it('a near-expiry identity is treated as absent (→ refresh)', () => {
    // Seal an identity that expires within the 60s skew.
    const identity = seal({ e: Date.now() + 10_000, c: Z_CLAIMS })
    expect(consoleSession(reqWithCookies({ [SESSION_COOKIE]: identity }))).toBeNull()
  })

  it('nameless / absent / tampered identity → null', () => {
    expect(consoleSession(reqWithCookies({ [SESSION_COOKIE]: seal({ e: Date.now() + 3600_000, c: {} }) }))).toBeNull()
    expect(consoleSession(reqWithCookies({}))).toBeNull()
    expect(consoleSession(reqWithCookies({ [SESSION_COOKIE]: 'garbage' }))).toBeNull()
  })

  it('readRefreshToken is null with no chunks or a tampered chunk', () => {
    expect(readRefreshToken(reqWithCookies({}))).toBeNull()
    expect(readRefreshToken(reqWithCookies({ [`${REFRESH_COOKIE}0`]: 'garbage' }))).toBeNull()
  })

  it('clearCookies expires the identity (Path=/) and every refresh chunk (Path=/auth)', () => {
    const dirs = clearCookies()
    expect(dirs.every((d) => d.maxAge === 0 && d.value === '')).toBe(true)
    expect(dirs.find((d) => d.name === SESSION_COOKIE)?.path).toBe('/')
    expect(dirs.filter((d) => d.name.startsWith(REFRESH_COOKIE)).every((d) => d.path === '/auth')).toBe(true)
  })

  it('setCookies blanks stale higher chunks from a prior LARGER token', () => {
    const dirs = setCookies(seal({ e: 1, c: Z_CLAIMS }), seal({ t: 'small' })) // one small chunk
    const blanked = dirs.filter((d) => d.name.startsWith(REFRESH_COOKIE) && d.maxAge === 0)
    expect(blanked.length).toBeGreaterThanOrEqual(1) // higher chunks explicitly expired
  })
})

describe('sameSubject', () => {
  it('matches equal ids, rejects different ids/lengths', () => {
    expect(sameSubject('hanzo/z', 'hanzo/z')).toBe(true)
    expect(sameSubject('hanzo/z', 'hanzo/y')).toBe(false)
    expect(sameSubject('hanzo/z', 'maxpower/z')).toBe(false)
    expect(sameSubject('a', 'ab')).toBe(false)
  })
})

describe('OAuth grants (fetch-mocked)', () => {
  afterEach(() => vi.unstubAllGlobals())
  const okToken = { access_token: 'AT', refresh_token: 'RT2', expires_in: 3600 }

  it('passwordGrant returns tokens; the password rides the body, never the URL', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(okToken), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await passwordGrant('z@hanzo.ai', 'pw')).toEqual({ accessToken: 'AT', refreshToken: 'RT2', expiresIn: 3600 })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(String(url)).not.toContain('pw')
    expect(String(init.body)).toContain('grant_type=password')
  })

  it('refreshGrant maps invalid_grant → 401, other errors → 502, network → 502', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })))
    await expect(refreshGrant('old')).rejects.toMatchObject({ status: 401 })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'server_error' }), { status: 500 })))
    await expect(refreshGrant('old')).rejects.toBeInstanceOf(SessionError)
    await expect(refreshGrant('old')).rejects.toMatchObject({ status: 502 })
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('econnrefused') }))
    await expect(passwordGrant('u', 'p')).rejects.toMatchObject({ status: 502 })
  })

  it('retries a TRANSIENT non-JSON blip once, then succeeds (the /auth/refresh self-heal)', async () => {
    // First: IAM mid-roll answers an HTML page (non-JSON, no error envelope); second: the token.
    let n = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      n += 1
      return n === 1
        ? new Response('<!doctype html><html>rolling</html>', { status: 503, headers: { 'content-type': 'text/html' } })
        : new Response(JSON.stringify(okToken), { status: 200 })
    }))
    expect(await refreshGrant('rt')).toEqual({ accessToken: 'AT', refreshToken: 'RT2', expiresIn: 3600 })
    expect(n).toBe(2)
  })

  it('does NOT retry a definitive OAuth error envelope (invalid_grant → 401, one call only)', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }))
    vi.stubGlobal('fetch', f)
    await expect(refreshGrant('old')).rejects.toMatchObject({ status: 401 })
    expect(f).toHaveBeenCalledTimes(1)
  })
})

describe('deviceCodeGrant (RFC 8628 poll, fetch-mocked)', () => {
  afterEach(() => vi.unstubAllGlobals())

  const errRes = (error: string, status = 400) =>
    vi.fn(async () => new Response(JSON.stringify({ error }), { status }))

  it('redeems the device_code as a PUBLIC client — no secret, the grant + client_id + code ride the body', async () => {
    const f = vi.fn(async () =>
      new Response(JSON.stringify({ access_token: fakeJwt(Z_CLAIMS), refresh_token: 'RT', expires_in: 3600 }), { status: 200 }),
    )
    vi.stubGlobal('fetch', f)
    const r = await deviceCodeGrant('DC-1', 'hanzo-cloud')
    expect(r.status).toBe('ok')
    if (r.status === 'ok') {
      expect(r.claims.name).toBe('z')
      expect(r.expiresInMs).toBe(3600_000)
      expect(open<{ t: string }>(r.refresh)?.t).toBe('RT')
    }
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    const body = String(init.body)
    expect(body).toContain('grant_type=urn')
    expect(body).toContain('device_code=DC-1')
    expect(body).toContain('client_id=hanzo-cloud')
    // Public device client — no client_secret_basic header.
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it('surfaces authorization_pending and slow_down as `pending` (keep polling), one call each', async () => {
    const pending = errRes('authorization_pending')
    vi.stubGlobal('fetch', pending)
    expect(await deviceCodeGrant('DC', 'hanzo-cloud')).toEqual({ status: 'pending' })
    expect(pending).toHaveBeenCalledTimes(1) // an OAuth envelope is definitive — not retried

    vi.unstubAllGlobals()
    vi.stubGlobal('fetch', errRes('slow_down'))
    expect(await deviceCodeGrant('DC', 'hanzo-cloud')).toEqual({ status: 'pending' })
  })

  it('surfaces expired_token as `expired`', async () => {
    vi.stubGlobal('fetch', errRes('expired_token'))
    expect(await deviceCodeGrant('DC', 'hanzo-cloud')).toEqual({ status: 'expired' })
  })

  it('rethrows a hard OAuth error (invalid_client) as a SessionError — not a polling state', async () => {
    vi.stubGlobal('fetch', errRes('invalid_client', 401))
    await expect(deviceCodeGrant('DC', 'hanzo-cloud')).rejects.toBeInstanceOf(SessionError)
  })
})

describe('admin-console redemption is host-aware (public client, no secret)', () => {
  afterEach(() => vi.unstubAllGlobals())
  const okToken = { access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }
  const mockFetch = () => {
    const f = vi.fn(async () => new Response(JSON.stringify(okToken), { status: 200 }))
    vi.stubGlobal('fetch', f)
    return f
  }
  const initOf = (f: ReturnType<typeof mockFetch>) =>
    (f.mock.calls[0] as unknown as [string, RequestInit])[1]
  const headersOf = (f: ReturnType<typeof mockFetch>) => (initOf(f).headers ?? {}) as Record<string, string>
  const bodyOf = (f: ReturnType<typeof mockFetch>) => String(initOf(f).body)

  it('durableSessionClientId → admin-console on an admin host, null on a tenant host', () => {
    expect(durableSessionClientId('admin.hanzo.ai')).toBe('admin-console')
    expect(durableSessionClientId('admin.lux.network')).toBe('admin-console')
    expect(durableSessionClientId('console.hanzo.ai')).toBeNull()
    expect(durableSessionClientId('cloud.hanzo.ai')).toBeNull()
    expect(durableSessionClientId(null)).toBeNull()
  })

  it('pkceCodeGrant redeems as admin-console with the verifier and NO client secret (public)', async () => {
    const f = mockFetch()
    await pkceCodeGrant({ clientId: 'admin-console', code: 'C', codeVerifier: 'VERIF', redirectUri: 'https://admin.hanzo.ai/auth/callback' })
    const body = bodyOf(f)
    expect(body).toContain('grant_type=authorization_code')
    expect(body).toContain('client_id=admin-console')
    expect(body).toContain('code_verifier=VERIF')
    // Public client — the exchange carries no Authorization (client_secret_basic) header.
    expect(headersOf(f).Authorization).toBeUndefined()
  })

  it('refreshGrant rotates the ADMIN session as admin-console (no secret), the TENANT session as the confidential client', async () => {
    const admin = mockFetch()
    await refreshGrant('rt', 'admin-console')
    expect(bodyOf(admin)).toContain('client_id=admin-console')
    expect(headersOf(admin).Authorization).toBeUndefined()

    vi.unstubAllGlobals()
    const tenant = mockFetch()
    await refreshGrant('rt')
    expect(headersOf(tenant).Authorization).toMatch(/^Basic /)
  })
})
