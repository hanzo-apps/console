import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { type NextRequest } from 'next/server'

// Mock the identity boundary so the end-to-end forward test never touches IAM/cloud:
// a resolved user + a static bearer, so we exercise ONLY the path/allow-list/forward
// logic. If a traversal reaches the mint/fetch, the test fails (it must 404 first).
vi.mock('./identity', () => ({
  resolveUser: vi.fn(async () => ({ owner: 'maxpower', name: 'dave', id: 'maxpower/dave' })),
  adminBearer: vi.fn(async () => 'test-bearer'),
}))

import { errorBody, upstreamHeaders, pathIsClean, sameOriginOK, forwardWithUserBearer } from './bearer-proxy'
import { allowCloudSurface } from './proxy-allow'

describe('pathIsClean (traversal / encoded-slash guard — RED HIGH)', () => {
  it('admits real resource paths', () => {
    expect(pathIsClean('v1/vector')).toBe(true)
    expect(pathIsClean('v1/functions/foo/logs')).toBe(true)
    expect(pathIsClean('v1/collections/tenants/records')).toBe(true)
  })

  it('REJECTS dot-segment traversal (the %2f-decoded escape that slips a foreign head past the allow-list)', () => {
    expect(pathIsClean('v1/functions/../../iam')).toBe(false)
    expect(pathIsClean('v1/collections/tenants/records/../../users/records')).toBe(false)
    expect(pathIsClean('v1/tasks/../admin')).toBe(false)
    expect(pathIsClean('v1/./functions')).toBe(false)
  })

  it('rejects empty segments, a surviving encoded slash, and the empty path', () => {
    expect(pathIsClean('v1//iam')).toBe(false)
    expect(pathIsClean('v1/functions%2f..%2fiam')).toBe(false)
    expect(pathIsClean('v1/functions%2F..')).toBe(false)
    expect(pathIsClean('')).toBe(false)
  })

  it('REJECTS the double-encoded dot-segment (%252e%252e → Next decodes once → %2e%2e → undici normalizes to ../) — RED re-review HIGH', () => {
    // What reaches the handler after Next.js single-decodes the catch-all segment:
    expect(pathIsClean('v1/functions/%2e%2e/get-account')).toBe(false)
    expect(pathIsClean('v1/sql/%2e%2e/%2e%2e/admin/overview')).toBe(false)
    expect(pathIsClean('v1/collections/tenants/records/%2E%2E/_superusers/records')).toBe(false)
    expect(pathIsClean('v1/%2e%2e/metrics')).toBe(false)
  })

  it('REJECTS N≥3 encoding, overlong, and matrix-param traversal — RED final hardening', () => {
    expect(pathIsClean('v1/functions/%25252e%25252e/get-account')).toBe(false) // triple-encoded
    expect(pathIsClean('v1/functions/%c0%ae%c0%ae/x')).toBe(false) // overlong UTF-8
    expect(pathIsClean('v1/functions/..;/get-account')).toBe(false) // matrix-param `..;`
    expect(pathIsClean('v1/functions/%5c%2e%2e/x')).toBe(false) // backslash-escaped
  })

  it('does NOT over-reject a legit segment with a literal percent (no surviving %XX after one decode)', () => {
    expect(pathIsClean('v1/functions/50%off')).toBe(true) // `%of` — `o` is not hex → allowed
  })
})

describe('sameOriginOK (CSRF guard on the cookie-authenticated proxy — RED)', () => {
  const HOST = 'console.hanzo.ai'
  /** Build the OriginSignals bag with sensible defaults for a case. */
  const sig = (
    over: Partial<{ host: string; origin: string | null; referer: string | null; secFetchSite: string | null }> = {},
  ) => ({ host: HOST, origin: null, referer: null, secFetchSite: null, ...over })

  it('always allows safe methods (GET/HEAD/OPTIONS), even cross-origin', () => {
    for (const m of ['GET', 'HEAD', 'OPTIONS', 'get']) {
      expect(sameOriginOK(m, sig({ origin: 'https://evil.example', secFetchSite: 'cross-site' }))).toBe(true)
      expect(sameOriginOK(m, sig())).toBe(true)
    }
  })

  it('allows a mutating request whose Origin host matches Host', () => {
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(sameOriginOK(m, sig({ origin: `https://${HOST}` }))).toBe(true)
    }
  })

  it('REFUSES a mutating request from a different Origin (the CSRF case)', () => {
    expect(sameOriginOK('POST', sig({ origin: 'https://evil.example' }))).toBe(false)
    expect(sameOriginOK('DELETE', sig({ origin: 'https://console.hanzo.ai.evil.com' }))).toBe(false)
    // a look-alike subdomain must not match (host compare is exact)
    expect(sameOriginOK('POST', sig({ origin: 'https://notconsole.hanzo.ai' }))).toBe(false)
  })

  it('REFUSES when Sec-Fetch-Site is cross-site (unforgeable), even if Origin looks same', () => {
    expect(sameOriginOK('POST', sig({ origin: `https://${HOST}`, secFetchSite: 'cross-site' }))).toBe(false)
  })

  it('allows a same-origin fetch that omits Origin but sets Sec-Fetch-Site: same-origin', () => {
    expect(sameOriginOK('POST', sig({ secFetchSite: 'same-origin' }))).toBe(true)
  })

  it('falls back to the Referer host when Origin is absent', () => {
    expect(sameOriginOK('POST', sig({ referer: `https://${HOST}/agents` }))).toBe(true)
    expect(sameOriginOK('POST', sig({ referer: 'https://evil.example/x' }))).toBe(false)
  })

  it('fails CLOSED on a mutating request with no Origin/Referer/Sec-Fetch-Site', () => {
    expect(sameOriginOK('POST', sig())).toBe(false)
    expect(sameOriginOK('DELETE', sig())).toBe(false)
  })

  it('fails CLOSED when there is no Host to compare against', () => {
    expect(sameOriginOK('POST', sig({ host: '', origin: `https://${HOST}` }))).toBe(false)
  })

  it('ignores an unparseable Origin/Referer (treated as absent)', () => {
    expect(sameOriginOK('POST', sig({ origin: 'not-a-url' }))).toBe(false)
    expect(sameOriginOK('POST', sig({ origin: 'not-a-url', referer: `https://${HOST}` }))).toBe(true)
  })
})

/** A minimal NextRequest stand-in — the header rebuild only reads `headers.get`. */
const reqWith = (headers: Record<string, string>): NextRequest =>
  ({ headers: new Headers(headers) }) as unknown as NextRequest

describe('errorBody', () => {
  it('shapes the AI/OpenAI envelope with a code', () => {
    expect(errorBody('openai', 'Sign in.', 'unauthenticated')).toEqual({
      error: { message: 'Sign in.', type: 'unauthenticated', code: 'unauthenticated' },
    })
  })

  it('shapes the casibase envelope', () => {
    expect(errorBody('casibase', 'nope')).toEqual({ status: 'error', msg: 'nope' })
  })

  it('shapes the plain envelope (default)', () => {
    expect(errorBody('plain', 'boom')).toEqual({ error: 'boom' })
  })
})

describe('upstreamHeaders', () => {
  it('stamps the token owner as X-Org-Id and never leaks the browser cookie or its X-Org-Id', () => {
    const req = reqWith({ cookie: 'session=leak', 'X-Org-Id': 'evil-tenant' })
    const h = upstreamHeaders(req, 'maxpower', false, {})
    expect(h['X-Org-Id']).toBe('maxpower') // the OWNER, not the browser's spoof
    expect(h.cookie).toBeUndefined()
    expect(h.Cookie).toBeUndefined()
    expect(h.Authorization).toBeUndefined() // added by the caller after the mint
    expect(h['Content-Type']).toBeUndefined() // no body
  })

  it('adds Content-Type only when the request carries a body', () => {
    const h = upstreamHeaders(reqWith({}), 'maxpower', true, {})
    expect(h['Content-Type']).toBe('application/json')
  })

  it('forwards the tenant sub-scope only when forwardScope is set and present', () => {
    const req = reqWith({ 'X-Project-Id': 'proj-1', 'X-Environment': 'mainnet' })
    expect(upstreamHeaders(req, 'maxpower', false, {})['X-Project-Id']).toBeUndefined()
    const scoped = upstreamHeaders(req, 'maxpower', false, { forwardScope: true })
    expect(scoped['X-Project-Id']).toBe('proj-1')
    expect(scoped['X-Environment']).toBe('mainnet')
  })

  it('merges caller extra headers (e.g. the AI retrieval switch)', () => {
    const h = upstreamHeaders(reqWith({}), 'maxpower', false, { extraHeaders: { 'X-Retrieval': '1' } })
    expect(h['X-Retrieval']).toBe('1')
    expect(h['X-Org-Id']).toBe('maxpower')
  })
})

/**
 * CROSS-TENANT ISOLATION INVARIANT (RED MED-1) — the `/cloud` proxy MUST drop the
 * browser-controlled `X-Project-Id` sub-scope, because it is EXCLUDED from cloud's
 * SanitizeIdentity.authorityHeaders (client-controllable) and the cloud evals facade
 * (`clients/eval` `tenant()`) TRUSTS `X-Project-Id` over the bearer-pinned org to
 * select a per-project console API key pair from KMS. If `/cloud` ever forwarded a
 * client `X-Project-Id`, a signed-in user could set `X-Project-Id: victim-org` and
 * read another org's eval scores. `/cloud` does NOT pass `forwardScope`, so this
 * suite pins that the sub-scope is dropped (and only rides when explicitly opted in,
 * as `/vm` does under its own org-membership re-validation). Never remove `forwardScope`
 * defaulting to off here without a project-membership check upstream.
 */
describe('X-Project-Id drop — cross-tenant eval isolation (RED MED-1)', () => {
  it('DROPS a client-forged X-Project-Id when forwardScope is unset (the /cloud default)', () => {
    // The browser stamps X-Project-Id (client.ts baseHeaders); a forged one must NOT survive.
    const req = reqWith({ 'X-Project-Id': 'victim-org', 'X-Environment': 'mainnet' })
    const h = upstreamHeaders(req, 'maxpower', false, {}) // no forwardScope = the /cloud call
    expect(h['X-Project-Id']).toBeUndefined()
    expect(h['X-Environment']).toBeUndefined()
    expect(h['X-Org-Id']).toBe('maxpower') // org stays the bearer owner, authoritative
  })

  it('DROPS X-Project-Id even on a mutating (body) request without forwardScope', () => {
    const req = reqWith({ 'X-Project-Id': 'victim-org' })
    const h = upstreamHeaders(req, 'maxpower', true, {})
    expect(h['X-Project-Id']).toBeUndefined()
  })

  it('rides X-Project-Id ONLY when a proxy explicitly opts in (e.g. /vm), never /cloud', () => {
    const req = reqWith({ 'X-Project-Id': 'proj-1' })
    expect(upstreamHeaders(req, 'maxpower', false, { forwardScope: true })['X-Project-Id']).toBe('proj-1')
  })
})

/**
 * End-to-end forward (RED LOW-2) — the two-stage normalize→revalidate defense at the
 * TOP of forwardWithUserBearer, exercised through the real function with a mocked
 * fetch + identity. A rewrite-fed traversal (what reaches `app/cloud/[...path]` after
 * Next single-decodes the catch-all) must 404 and NEVER issue the upstream fetch —
 * proving the allow-list can't be bypassed via a foreign head, not just that the
 * pure `pathIsClean` helper rejects strings.
 */
describe('forwardWithUserBearer — rewrite-fed traversal fails closed (RED LOW-2)', () => {
  const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))

  /** A NextRequest stand-in with the fields forwardWithUserBearer reads. */
  const req = (method: string, headers: Record<string, string> = {}, search = ''): NextRequest =>
    ({
      method,
      headers: new Headers({ host: 'console.hanzo.ai', origin: 'https://console.hanzo.ai', ...headers }),
      nextUrl: { search },
      signal: undefined,
      text: async () => '',
    }) as unknown as NextRequest

  const forward = (path: string, method = 'GET') =>
    forwardWithUserBearer(req(method), {
      target: 'http://cloud-api.hanzo.svc.cluster.local:8000',
      path,
      allow: allowCloudSurface,
      unauthorizedMessage: 'Sign in to use Hanzo Cloud.',
    })

  beforeEach(() => {
    fetchMock.mockClear()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('404s a %2e%2e traversal to a foreign head and never fetches upstream', async () => {
    // A DOUBLE-encoded dot-segment (`%252e%252e`) reaches the handler as literal
    // `%2e%2e` after Next single-decodes the catch-all — pathIsClean rejects it as a
    // surviving %XX. (A single-encoded `%2e%2e` would arrive as `..`, covered below.)
    const res = await forward('v1/agents/%2e%2e/iam/get-users')
    expect(res.status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('404s a literal ../ traversal and never fetches upstream', async () => {
    const res = await forward('v1/agents/../iam/get-users')
    expect(res.status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('404s an encoded-slash smuggle (agents%2f..%2f..%2fiam) and never fetches', async () => {
    const res = await forward('v1/agents%2f..%2f..%2fiam')
    expect(res.status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('404s a matrix-param traversal (..;) and never fetches', async () => {
    const res = await forward('v1/agents/..;/iam')
    expect(res.status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('404s a foreign head reached directly (v1/iam) — not a general tunnel', async () => {
    const res = await forward('v1/iam/get-users')
    expect(res.status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('FORWARDS a clean allow-listed path (proves the 404s above are the guard, not a broken forward)', async () => {
    const res = await forward('v1/agents')
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // The upstream URL is exactly the normalized allow-listed path (no traversal residue).
    const calledUrl = String((fetchMock.mock.calls[0] as unknown[])[0])
    expect(calledUrl).toBe('http://cloud-api.hanzo.svc.cluster.local:8000/v1/agents')
  })
})
