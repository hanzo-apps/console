import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The confidential client is read at module scope, and the ONE IAM transport
// refuses to call without it (every route checks `mintConfigured()` first, so a
// configured client is the production precondition for the mint/issue primitives
// exercised below). Set before the import — `vi.hoisted` runs ahead of it.
vi.hoisted(() => {
  process.env.IAM_MINT_CLIENT_ID = 'hanzo-console'
  process.env.IAM_MINT_CLIENT_SECRET = 'test-secret'
})

// Control the console-session claims the resolver sees. (The casibase fallback is
// exercised by stubbing the get-account fetch below.)
vi.mock('./session', () => ({ consoleClaims: vi.fn() }))

import { consoleClaims } from './session'
import { resolveUser, issueUserToken, adminBearer, type SessionUser } from './identity'

const mockClaims = vi.mocked(consoleClaims)

/** A NextRequest-shaped stub with an arbitrary cookie header. */
function req(cookie: string | null) {
  return { headers: { get: (h: string) => (h === 'cookie' ? cookie : null) } } as unknown as import('next/server').NextRequest
}

afterEach(() => vi.unstubAllGlobals())
beforeEach(() => mockClaims.mockReset())

describe('resolveUser — console session preferred, casibase fallback', () => {
  it('resolves from the console session WITHOUT any IAM round-trip', async () => {
    mockClaims.mockReturnValue({ owner: 'hanzo', name: 'z', email: 'z@hanzo.ai', isAdmin: true, type: 'normal-user' })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const u = await resolveUser(req('anything'))
    expect(u).toMatchObject({ owner: 'hanzo', name: 'z', id: 'hanzo/z', email: 'z@hanzo.ai', isAdmin: true })
    expect(fetchMock).not.toHaveBeenCalled() // no get-account when the console session resolves
  })

  it('derives SuperAdmin from owner === admin org (owner-canonical, no claim needed)', async () => {
    mockClaims.mockReturnValue({ owner: 'admin', name: 'root', type: 'normal-user' })
    vi.stubGlobal('fetch', vi.fn())
    expect((await resolveUser(req('x')))?.isSuperAdmin).toBe(true)
  })

  it('honors the `isSuperAdmin` claim for a tenant-org user', async () => {
    mockClaims.mockReturnValue({ owner: 'hanzo', name: 'z', isSuperAdmin: true, type: 'normal-user' })
    vi.stubGlobal('fetch', vi.fn())
    expect((await resolveUser(req('x')))?.isSuperAdmin).toBe(true)
  })

  it('resolves SuperAdmin from the casibase get-account `isSuperAdmin` claim', async () => {
    mockClaims.mockReturnValue(null)
    const account = { owner: 'hanzo', name: 'ops', email: 'ops@hanzo.ai', type: 'normal-user', isSuperAdmin: true, emailVerified: true }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'ok', data: account }), { status: 200 })))
    expect((await resolveUser(req('cloud_session_id=abc')))?.isSuperAdmin).toBe(true)
  })

  it('falls back to the casibase get-account when there is no console session', async () => {
    mockClaims.mockReturnValue(null)
    const account = { owner: 'maxpower', name: 'dave', email: 'dave@maxpower.io', type: 'normal-user', isAdmin: true, emailVerified: true }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'ok', data: account }), { status: 200 })))

    const u = await resolveUser(req('cloud_session_id=abc'))
    expect(u).toMatchObject({ owner: 'maxpower', name: 'dave', id: 'maxpower/dave' })
  })

  it('returns null when there is neither a console session nor a cookie', async () => {
    mockClaims.mockReturnValue(null)
    vi.stubGlobal('fetch', vi.fn())
    expect(await resolveUser(req(null))).toBeNull()
  })

  it('ignores an anonymous-user console claim (not signed in)', async () => {
    mockClaims.mockReturnValue({ owner: 'hanzo', name: 'u-123', type: 'anonymous-user' })
    // With the console claim rejected AND no cookie, resolveUser must be null (not the anon).
    vi.stubGlobal('fetch', vi.fn())
    expect(await resolveUser(req(null))).toBeNull()
  })
})

/**
 * Audience-scoped bearer mint — the /v1/admin/* 403 fix. The operator is a member of
 * the reserved `admin` org, whose OWN app (`admin-console`) is NOT in cloud's audience
 * allowlist, so the default-audience `issue-user-token` bearer is rejected → 403. The
 * admin-aggregate passes the brand cloud audience (RFC 8707 `aud`) so cloud accepts the
 * token and, seeing owner=admin + isAdmin=true, sets X-User-IsAdmin=true. The token's
 * `owner`/`isAdmin` come from the TARGET user (admin/z) unchanged — only the `aud` is set.
 */
describe('issueUserToken / adminBearer — RFC 8707 audience', () => {
  const user = (id: string): SessionUser =>
    ({ owner: 'admin', name: 'z', id, accessKey: '', email: '', emailVerified: true, isAdmin: true, isSuperAdmin: true })

  /** Stub the IAM POST; capture the request URL and return a token envelope. */
  const stubIam = (token = 'jwt') => {
    const urls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (u: unknown) => {
        urls.push(String(u))
        return new Response(JSON.stringify({ status: 'ok', data: { accessToken: token, expiresIn: 3600 } }), { status: 200 })
      }),
    )
    return urls
  }

  it('passes the audience as the issue-user-token `aud` query (the cloud-accepted resource)', async () => {
    const urls = stubIam()
    const t = await issueUserToken(user('admin/z'), 'hanzo-cloud')
    expect(t.accessToken).toBe('jwt')
    const q = new URL(urls[0])
    expect(q.pathname).toBe('/v1/iam/issue-user-token')
    expect(q.searchParams.get('id')).toBe('admin/z')
    expect(q.searchParams.get('aud')).toBe('hanzo-cloud')
  })

  it('OMITS `aud` when no audience is given (tenant proxies unchanged — target-app default)', async () => {
    const urls = stubIam()
    await issueUserToken(user('hanzo/dave'), undefined)
    expect(new URL(urls[0]).searchParams.has('aud')).toBe(false)
  })

  it('adminBearer caches per (user, audience) — a different audience mints a distinct token', async () => {
    let n = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        n += 1
        return new Response(JSON.stringify({ status: 'ok', data: { accessToken: `jwt-${n}`, expiresIn: 3600 } }), { status: 200 })
      }),
    )
    const u = user(`admin/z-${Math.random()}`) // unique id so the module cache starts cold
    const a1 = await adminBearer(u, 'hanzo-cloud')
    const a2 = await adminBearer(u, 'hanzo-cloud') // cache hit — no new mint
    const dflt = await adminBearer(u) // no audience → distinct cache key → new mint
    expect(a1).toBe(a2)
    expect(a1).not.toBe(dflt)
    expect(n).toBe(2)
  })
})
