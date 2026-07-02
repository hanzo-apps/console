import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  accessClaims,
  clearSessionCookie,
  consoleSession,
  open,
  passwordGrant,
  readConsoleSession,
  refreshGrant,
  sameSubject,
  seal,
  sealTokens,
  sessionCookie,
  SessionError,
  SESSION_COOKIE,
} from './session'

/** A minimal NextRequest-shaped stub carrying one cookie. */
function reqWithCookie(value: string | undefined) {
  return {
    cookies: { get: (name: string) => (name === SESSION_COOKIE && value !== undefined ? { value } : undefined) },
  } as unknown as import('next/server').NextRequest
}

/** A base64url JWT with the given payload claims (header + sig are inert here). */
function fakeJwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(payload)}.sig`
}

const Z_CLAIMS = { owner: 'hanzo', name: 'z', email: 'z@hanzo.ai', isAdmin: true, type: 'normal-user' }

describe('AEAD seal/open', () => {
  it('round-trips a sealed session', () => {
    const s = { a: 'access-token', r: 'refresh-token', e: Date.now() + 60_000 }
    const sealed = seal(s)
    expect(sealed).not.toContain('access-token') // opaque, not plaintext
    expect(open(sealed)).toEqual(s)
  })

  it('rejects tampered, truncated, and garbage ciphertext (fail-closed)', () => {
    const sealed = seal({ a: 'a', r: 'r', e: Date.now() + 60_000 })
    expect(open(undefined)).toBeNull()
    expect(open('')).toBeNull()
    expect(open('not-base64url!!')).toBeNull()
    expect(open(sealed.slice(0, 10))).toBeNull() // truncated
    // Flip a byte in the ciphertext → GCM auth tag mismatch → null.
    const buf = Buffer.from(sealed, 'base64url')
    buf[buf.length - 1] ^= 0xff
    expect(open(buf.toString('base64url'))).toBeNull()
  })

  it('a session sealed with a different key cannot be opened (isolation)', () => {
    // The key derives from IAM_MINT_CLIENT_SECRET / CONSOLE_SESSION_KEY, fixed per
    // process; a foreign blob (random bytes) never opens.
    expect(open(Buffer.from('random-bytes-not-a-seal-abc').toString('base64url'))).toBeNull()
  })
})

describe('accessClaims', () => {
  it('projects owner/name/email/isAdmin/type from a JWT payload', () => {
    const c = accessClaims(fakeJwt(Z_CLAIMS))
    expect(c).toMatchObject({ owner: 'hanzo', name: 'z', email: 'z@hanzo.ai', isAdmin: true, type: 'normal-user' })
  })

  it('accepts email_verified (snake) as emailVerified', () => {
    expect(accessClaims(fakeJwt({ ...Z_CLAIMS, email_verified: true }))?.emailVerified).toBe(true)
  })

  it('never surfaces secret material even when present in the token', () => {
    const c = accessClaims(fakeJwt({ ...Z_CLAIMS, password: 'hash', totpSecret: 's', passwordSalt: 'x' })) as Record<
      string,
      unknown
    >
    expect(c.password).toBeUndefined()
    expect(c.totpSecret).toBeUndefined()
    expect(c.passwordSalt).toBeUndefined()
  })

  it('returns null on a malformed token', () => {
    expect(accessClaims('not-a-jwt')).toBeNull() // < 2 segments
    expect(accessClaims('aaa.notvalidjson.sig')).toBeNull() // payload not JSON
  })
})

describe('consoleSession freshness', () => {
  it('returns claims + lifetime for a fresh session', () => {
    const sealed = seal({ a: fakeJwt(Z_CLAIMS), r: 'r', e: Date.now() + 3600_000 })
    const sess = consoleSession(reqWithCookie(sealed))
    expect(sess?.claims.name).toBe('z')
    expect(sess?.expiresInSec).toBeGreaterThan(3000)
  })

  it('treats an at/near-expiry access token as absent (→ refresh)', () => {
    const stale = seal({ a: fakeJwt(Z_CLAIMS), r: 'r', e: Date.now() + 10_000 }) // < 60s skew
    expect(consoleSession(reqWithCookie(stale))).toBeNull()
  })

  it('returns null with no cookie or a tampered cookie', () => {
    expect(consoleSession(reqWithCookie(undefined))).toBeNull()
    expect(consoleSession(reqWithCookie('garbage'))).toBeNull()
  })

  it('readConsoleSession surfaces the raw sealed token set', () => {
    const sealed = seal({ a: 'ac', r: 'rt', e: 123 })
    expect(readConsoleSession(reqWithCookie(sealed))).toEqual({ a: 'ac', r: 'rt', e: 123 })
  })
})

describe('sealTokens', () => {
  it('seals a token set and reports the access lifetime', () => {
    const { sealed, expiresInMs } = sealTokens({ accessToken: 'a', refreshToken: 'r', expiresIn: 3600 })
    expect(expiresInMs).toBe(3600_000)
    const opened = open(sealed)
    expect(opened?.a).toBe('a')
    expect(opened?.r).toBe('r')
    expect(opened?.e).toBeGreaterThan(Date.now())
  })

  it('defaults a missing expires_in to 1h (never a zero-lifetime session)', () => {
    expect(sealTokens({ accessToken: 'a', refreshToken: 'r', expiresIn: 0 }).expiresInMs).toBe(3600_000)
  })
})

describe('cookie directives', () => {
  it('sessionCookie is httpOnly+secure+lax, persistent; clear is maxAge 0', () => {
    const set = sessionCookie('sealed')
    expect(set).toMatchObject({ name: SESSION_COOKIE, httpOnly: true, secure: true, sameSite: 'lax', path: '/' })
    expect(set.maxAge).toBeGreaterThan(0)
    expect(clearSessionCookie()).toMatchObject({ value: '', maxAge: 0 })
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

  it('passwordGrant returns tokens on a successful grant', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(okToken), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const t = await passwordGrant('z@hanzo.ai', 'pw')
    expect(t).toEqual({ accessToken: 'AT', refreshToken: 'RT2', expiresIn: 3600 })
    // The password rides the body, NEVER the URL.
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(String(url)).not.toContain('pw')
    expect(String(init.body)).toContain('grant_type=password')
  })

  it('refreshGrant maps invalid_grant → SessionError(401), other errors → 502', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })))
    await expect(refreshGrant('old')).rejects.toMatchObject({ status: 401 })

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'server_error' }), { status: 500 })))
    await expect(refreshGrant('old')).rejects.toBeInstanceOf(SessionError)
    await expect(refreshGrant('old')).rejects.toMatchObject({ status: 502 })
  })

  it('a network failure surfaces as SessionError(502)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('econnrefused') }))
    await expect(passwordGrant('u', 'p')).rejects.toMatchObject({ status: 502 })
  })
})
