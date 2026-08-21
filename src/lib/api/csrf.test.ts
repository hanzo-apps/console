// Anti-CSRF token client for the embed ambient-cookie money-write path. Pins: the
// token is fetched from GET /v1/account/csrf and echoed as X-CSRF-Token on mutating
// writes only, cached (one fetch across concurrent/sequential writes), re-minted on a
// 403, and a strict no-op for reads / non-embed hosts (Bearer BFF ⇒ CSRF-immune).
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Default: embed mode (the ambient-cookie money path). The non-embed no-op is asserted
// in its own module-reset block below.
vi.mock('~/lib/embed', () => ({ IS_EMBED: true }))

const csrfResponse = (token = 'tok-abc', expiresIn = 43200): Response =>
  ({ ok: true, json: async () => ({ csrfToken: token, expiresIn }) }) as unknown as Response

describe('csrf (embed ambient-cookie money path)', () => {
  beforeEach(() => vi.resetModules())

  it('csrfRequired is true only for mutating verbs', async () => {
    const { csrfRequired } = await import('./csrf')
    for (const m of ['POST', 'put', 'Patch', 'DELETE']) expect(csrfRequired(m)).toBe(true)
    for (const m of ['GET', 'HEAD', 'OPTIONS', undefined]) expect(csrfRequired(m)).toBe(false)
  })

  it('csrfRequired is SCOPED to the money-write surfaces cloud gates (no spurious pre-auth mint)', async () => {
    const { csrfRequired } = await import('./csrf')
    // The cloud requireCSRF surfaces (apps/account/account.go) — must require a token.
    for (const u of ['/v1/account/keys', '/v1/account/orgs', '/v1/billing/alerts', '/v1/commerce/product'])
      expect(csrfRequired('POST', u)).toBe(true)
    // NON-money mutating writes (login/session/control-plane) must NOT trigger the
    // /v1/account/csrf mint — that pre-auth fetch was the SPA's only console error.
    // IAM's own key surface is in the list: cloud gates /v1/account/keys, IAM does not.
    for (const u of ['/v1/iam/keys', '/v1/iam/login', '/v1/iam/signin', '/auth/refresh', '/v1/agents', '/v1/todo/projects'])
      expect(csrfRequired('POST', u)).toBe(false)
  })

  it('mints the token once and caches it across writes', async () => {
    const { csrfToken } = await import('./csrf')
    const fetchImpl = vi.fn().mockResolvedValue(csrfResponse('tok-1'))
    expect(await csrfToken(fetchImpl)).toBe('tok-1')
    expect(await csrfToken(fetchImpl)).toBe('tok-1') // cache hit
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0][0]).toContain('/v1/account/csrf')
    expect(fetchImpl.mock.calls[0][1].credentials).toBe('include')
  })

  it('concurrent callers share ONE in-flight fetch (rotation-safe)', async () => {
    const { csrfToken } = await import('./csrf')
    const fetchImpl = vi.fn().mockResolvedValue(csrfResponse('tok-x'))
    const [a, b] = await Promise.all([csrfToken(fetchImpl), csrfToken(fetchImpl)])
    expect([a, b]).toEqual(['tok-x', 'tok-x'])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('re-mints after clearCsrfToken (the 403 path)', async () => {
    const { csrfToken, clearCsrfToken } = await import('./csrf')
    const fetchImpl = vi.fn().mockResolvedValueOnce(csrfResponse('old')).mockResolvedValueOnce(csrfResponse('new'))
    expect(await csrfToken(fetchImpl)).toBe('old')
    clearCsrfToken()
    expect(await csrfToken(fetchImpl)).toBe('new')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('returns null (no header) when the endpoint fails — server fail-secures', async () => {
    const { csrfToken } = await import('./csrf')
    expect(await csrfToken(vi.fn().mockResolvedValue({ ok: false } as Response))).toBeNull()
    vi.resetModules()
    const { csrfToken: c2 } = await import('./csrf')
    expect(await c2(vi.fn().mockRejectedValue(new Error('network')))).toBeNull()
  })

  it('applyCsrfToInit stamps X-CSRF-Token on a mutating write, across header shapes', async () => {
    const { applyCsrfToInit, CSRF_HEADER } = await import('./csrf')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(csrfResponse('stamp')))

    const record: RequestInit = { method: 'POST', headers: { Accept: 'application/json' } }
    await applyCsrfToInit(record)
    expect((record.headers as Record<string, string>)[CSRF_HEADER]).toBe('stamp')

    const hdrs: RequestInit = { method: 'DELETE', headers: new Headers() }
    await applyCsrfToInit(hdrs)
    expect((hdrs.headers as Headers).get(CSRF_HEADER)).toBe('stamp')

    vi.unstubAllGlobals()
  })

  it('applyCsrfToInit is a no-op for a read', async () => {
    const { applyCsrfToInit, CSRF_HEADER } = await import('./csrf')
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    const init: RequestInit = { method: 'GET', headers: {} }
    await applyCsrfToInit(init)
    expect((init.headers as Record<string, string>)[CSRF_HEADER]).toBeUndefined()
    expect(spy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})

describe('csrf (non-embed host — Bearer BFF, CSRF-immune)', () => {
  beforeEach(() => vi.resetModules())

  it('is a strict no-op: csrfRequired false, csrfToken null, no fetch', async () => {
    vi.doMock('~/lib/embed', () => ({ IS_EMBED: false }))
    const { csrfRequired, csrfToken, applyCsrfToInit, CSRF_HEADER } = await import('./csrf')
    expect(csrfRequired('POST')).toBe(false)
    const fetchImpl = vi.fn()
    expect(await csrfToken(fetchImpl)).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
    const init: RequestInit = { method: 'POST', headers: {} }
    await applyCsrfToInit(init)
    expect((init.headers as Record<string, string>)[CSRF_HEADER]).toBeUndefined()
    vi.doUnmock('~/lib/embed')
  })
})
