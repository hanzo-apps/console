import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Control the console-session claims the resolver sees. (The casibase fallback is
// exercised by stubbing the get-account fetch below.)
vi.mock('./session', () => ({ consoleClaims: vi.fn() }))

import { consoleClaims } from './session'
import { resolveUser } from './identity'

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

  it('derives global-admin from owner === admin org', async () => {
    mockClaims.mockReturnValue({ owner: 'admin', name: 'root', type: 'normal-user' })
    vi.stubGlobal('fetch', vi.fn())
    expect((await resolveUser(req('x')))?.isGlobalAdmin).toBe(true)
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
