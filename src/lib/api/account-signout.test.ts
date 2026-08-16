/**
 * Sign-out reaches the address cloud registers it at.
 *
 * Measured on api.hanzo.ai and console.hanzo.ai: `POST /v1/signout` answers 404,
 * `POST /v1/ai/signout` answers 200. Cloud deleted its path-rewriting filters, so
 * every resource answers at exactly one URL and a near-miss is a miss — there is
 * no alias to fall back to.
 *
 * What the 404 cost is a real session, not a ping: `cloud_session_id` is minted by
 * `NewMemorySessions` and read by `GetSessionUser` in the auto-signin, authz and
 * billing-key paths, so a sign-out that never lands leaves the server-side row
 * alive after the browser has forgotten its tokens.
 *
 * Black-box: stub the global fetch (authedFetch calls it bare), drive the real
 * AccountApi, and read the request off the wire.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const iam = vi.hoisted(() => ({ signedOut: false }))

vi.mock('~/lib/auth/iam', () => ({
  iamAccessToken: () => 'live-access-token',
  iamValidAccessToken: async () => 'live-access-token',
  iamHasSession: () => true,
  iamExpiresInSeconds: () => 3600,
  iamUserInfo: async () => null,
  iamSignOut: () => {
    iam.signedOut = true
  },
}))

const { AccountApi } = await import('./account')

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  iam.signedOut = false
  fetchMock = vi.fn(
    async () => new Response(JSON.stringify({ status: 'ok', msg: '', data: '' }), { status: 200, headers: { 'content-type': 'application/json' } }),
  )
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('sign-out posts to the one address that exists', () => {
  it('POSTs /v1/ai/signout, never the unrouted /v1/signout', async () => {
    await AccountApi.signout()

    expect(fetchMock).toHaveBeenCalled()
    const url = String(fetchMock.mock.calls[0]![0])
    const init = fetchMock.mock.calls[0]![1] as RequestInit

    expect(init.method).toBe('POST')
    expect(new URL(url).pathname).toBe('/v1/ai/signout')
    // The bare path is the one production answers 404 on — assert it explicitly so
    // a revert reads as a failure here rather than as a silent best-effort catch.
    expect(new URL(url).pathname).not.toBe('/v1/signout')
  })

  it('clears the client identity even when the server call fails', async () => {
    fetchMock.mockImplementation(async () => {
      throw new Error('offline')
    })

    await expect(AccountApi.signout()).resolves.toBeUndefined()
    expect(iam.signedOut).toBe(true)
  })
})
