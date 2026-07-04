import { createHash } from 'node:crypto'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { loginState, loginWithPassword } from './iam-login'

/**
 * Host-correct login wire (admin.hanzo.ai global-admin cutover).
 *
 * The credential POST to `/v1/iam/login` must carry the OPERATOR app + org on an
 * admin host (client_id/application=admin-console, organization=admin) so IAM mints
 * the code in the reserved `admin` org and the `/v1/iam/signin` exchange resolves
 * `admin-console` — while a TENANT host is unchanged (brand app, empty org so IAM
 * resolves the user across all orgs by email). The module reads `config` from
 * `window.location.hostname`, stubbed per-test (vitest runs in a node env).
 */
function stubHost(hostname: string): void {
  vi.stubGlobal('window', { location: { hostname, origin: `https://${hostname}` } })
}

const okCode = () =>
  vi.fn(async () => new Response(JSON.stringify({ status: 'ok', data: 'CODE123' }), { status: 200 }))

afterEach(() => vi.unstubAllGlobals())

describe('iam-login: host-correct OAuth params', () => {
  it('admin.hanzo.ai logs into the admin-console app IN the reserved admin org', async () => {
    stubHost('admin.hanzo.ai')
    const fetchMock = okCode()
    vi.stubGlobal('fetch', fetchMock)

    const res = await loginWithPassword('z@hanzo.ai', 'pw')
    expect(res.kind).toBe('code')
    if (res.kind !== 'code') throw new Error('expected a code')
    expect(res.code).toBe('CODE123')
    // Admin login carries the PKCE verifier the BFF needs to redeem the code (no secret).
    expect(typeof res.verifier).toBe('string')
    expect((res.verifier ?? '').length).toBeGreaterThan(20)

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const u = new URL(String(url))
    expect(u.origin + u.pathname).toBe('https://hanzo.id/v1/iam/login')
    expect(u.searchParams.get('clientId')).toBe('admin-console')
    // redirectUri is computed from the live window origin — host-correct.
    expect(u.searchParams.get('redirectUri')).toBe('https://admin.hanzo.ai/auth/callback')

    const body = JSON.parse(String(init.body)) as {
      application: string
      organization: string
      codeChallenge?: string
      codeChallengeMethod?: string
    }
    expect(body.application).toBe('admin-console')
    expect(body.organization).toBe('admin')
    // PKCE (S256): the challenge sent is EXACTLY base64url(SHA-256(verifier)) — what IAM
    // recomputes to authenticate the secretless admin-console redemption.
    expect(body.codeChallengeMethod).toBe('S256')
    expect(body.codeChallenge).toBe(createHash('sha256').update(res.verifier ?? '').digest('base64url'))
  })

  it('a tenant host is UNCHANGED — brand app, EMPTY org (resolve across orgs by email)', async () => {
    stubHost('console.hanzo.ai')
    const fetchMock = okCode()
    vi.stubGlobal('fetch', fetchMock)

    const res = await loginWithPassword('dave@maxpower.com', 'pw')

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(new URL(String(url)).searchParams.get('clientId')).toBe('hanzo-cloud')
    const body = JSON.parse(String(init.body)) as { application: string; organization: string; codeChallenge?: string }
    expect(body.application).toBe('hanzo-cloud')
    expect(body.organization).toBe('')
    // No PKCE on a tenant host — the cloud backend redeems its code with a confidential client.
    expect(body.codeChallenge).toBeUndefined()
    expect(res.kind === 'code' && res.verifier).toBeFalsy()
  })

  it('loginState carries the app name (the /v1/iam/signin exchange state)', () => {
    stubHost('admin.hanzo.ai')
    expect(loginState()).toBe('admin-console')
  })
})
