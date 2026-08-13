import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { get, iamList, ApiError } from './client'

/**
 * A refusal must arrive carrying the server's OWN reason.
 *
 * The client answered every 401/403 with the constant string "Not authorized",
 * returning before the body was read at all — so the one thing the server took the
 * trouble to say was thrown away at the door, and the honest-error classifier
 * downstream could only guess. The guess was wrong in the case that sent us looking:
 * signed in as z@hanzo.ai (org `hanzo`) with the console scoped to `lux`,
 * `/v1/iam/get-organization-projects?organization=lux` answers
 * 403 {"status":"error","msg":"forbidden: this credential is scoped to organization hanzo"},
 * and the console rendered "it's an admin-only surface, or it isn't enabled for your
 * organization yet" — two claims that are both false. The account is an admin; the
 * surface is enabled; the sign-in simply belongs to a different org.
 *
 * Black-box: stub the global fetch (authedFetch calls it bare) and read what the
 * real client throws.
 */
function refusing(status: number, body: unknown) {
  return vi.fn(
    async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }),
  )
}

async function thrown(run: () => Promise<unknown>): Promise<ApiError> {
  try {
    await run()
  } catch (e) {
    return e as ApiError
  }
  throw new Error('expected the call to throw')
}

describe('a refusal keeps the reason the server gave', () => {
  afterEach(() => vi.unstubAllGlobals())
  beforeEach(() => vi.stubGlobal('fetch', refusing(403, { status: 'error', msg: '', data: null })))

  it('403: the casibase envelope `msg` survives, with the status', async () => {
    vi.stubGlobal(
      'fetch',
      refusing(403, {
        status: 'error',
        msg: 'forbidden: this credential is scoped to organization hanzo',
        data: null,
      }),
    )
    const err = await thrown(() => iamList('get-organization-projects', { organization: 'lux' }))
    expect(err.status).toBe(403)
    expect(err.message).toBe('forbidden: this credential is scoped to organization hanzo')
  })

  it('403: a plain-REST `error` field survives too (the other envelope)', async () => {
    vi.stubGlobal('fetch', refusing(403, { error: 'org_mismatch' }))
    const err = await thrown(() => get('agents'))
    expect(err.status).toBe(403)
    expect(err.message).toBe('org_mismatch')
  })

  it('401: same — the reason survives and the status still says re-auth', async () => {
    vi.stubGlobal('fetch', refusing(401, { status: 'error', msg: 'token expired', data: null }))
    const err = await thrown(() => get('agents'))
    expect(err.status).toBe(401)
    expect(err.message).toBe('token expired')
  })

  it('a refusal with no reason (or an unreadable body) still throws, and still 403s', async () => {
    vi.stubGlobal('fetch', refusing(403, '<html>gateway</html>'))
    const err = await thrown(() => get('agents'))
    expect(err.status).toBe(403)
    expect(err.message).toBe('Not authorized')
  })
})
