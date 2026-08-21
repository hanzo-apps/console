import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { type NextRequest } from 'next/server'

// Mock the identity boundary so the end-to-end forward test never touches IAM/cloud:
// a resolved user + a static bearer, so we exercise ONLY the path/allow-list/forward
// logic. If a traversal reaches the mint/fetch, the test fails (it must 404 first).
vi.mock('./identity', () => ({
  resolveUser: vi.fn(async () => ({ owner: 'maxpower', name: 'dave', id: 'maxpower/dave' })),
  adminBearer: vi.fn(async () => 'test-bearer'),
}))

import { errorBody, upstreamHeaders, pathIsClean, sameOriginOK, csrfRefusal, forwardWithUserBearer } from './bearer-proxy'
import { adminBearer } from './identity'
import { allowCloudSurface } from './proxy-allow'
import { allowAdminSurface } from './admin-aggregate'
import { cloudAudience } from '~/config'

describe('pathIsClean (traversal / encoded-slash guard — RED HIGH)', () => {
  it('admits real resource paths', () => {
    expect(pathIsClean('v1/provisioning/vector')).toBe(true)
    expect(pathIsClean('v1/functions/foo/logs')).toBe(true)
    expect(pathIsClean('v1/todo/projects/hanzo/issues')).toBe(true)
  })

  it('REJECTS dot-segment traversal (the %2f-decoded escape that slips a foreign head past the allow-list)', () => {
    expect(pathIsClean('v1/functions/../../iam')).toBe(false)
    expect(pathIsClean('v1/todo/projects/hanzo/../../iam/users')).toBe(false)
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
    expect(pathIsClean('v1/functions/%2e%2e/ai/account')).toBe(false)
    expect(pathIsClean('v1/provisioning/sql/%2e%2e/%2e%2e/admin/overview')).toBe(false)
    expect(pathIsClean('v1/todo/projects/hanzo/%2E%2E/%2E%2E/iam/users')).toBe(false)
    expect(pathIsClean('v1/%2e%2e/metrics')).toBe(false)
  })

  it('REJECTS N≥3 encoding, overlong, and matrix-param traversal — RED final hardening', () => {
    expect(pathIsClean('v1/functions/%25252e%25252e/ai/account')).toBe(false) // triple-encoded
    expect(pathIsClean('v1/functions/%c0%ae%c0%ae/x')).toBe(false) // overlong UTF-8
    expect(pathIsClean('v1/functions/..;/ai/account')).toBe(false) // matrix-param `..;`
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

describe('csrfRefusal (the ONE guard every hand-rolled cookie-auth route calls — RED)', () => {
  const HOST = 'console.hanzo.ai'
  const req = (method: string, headers: Record<string, string> = {}): NextRequest =>
    ({ method, headers: new Headers({ host: HOST, ...headers }) }) as unknown as NextRequest

  it('returns null (no refusal) for safe methods, even cross-origin', () => {
    expect(csrfRefusal(req('GET', { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }))).toBeNull()
    expect(csrfRefusal(req('HEAD'))).toBeNull()
    expect(csrfRefusal(req('OPTIONS'))).toBeNull()
  })

  it('returns null for a same-origin mutation (Origin host == Host, or Sec-Fetch-Site same-origin)', () => {
    expect(csrfRefusal(req('POST', { origin: `https://${HOST}` }))).toBeNull()
    expect(csrfRefusal(req('DELETE', { 'sec-fetch-site': 'same-origin' }))).toBeNull()
    expect(csrfRefusal(req('PATCH', { referer: `https://${HOST}/kms` }))).toBeNull()
  })

  it('REFUSES a cross-origin mutation with a fail-closed 403 forbidden envelope', async () => {
    const res = csrfRefusal(req('POST', { origin: 'https://evil.example' }))
    expect(res).not.toBeNull()
    expect(res!.status).toBe(403)
    expect(await res!.json()).toEqual({ error: 'Cross-origin request refused.' })
  })

  it('REFUSES when Sec-Fetch-Site is cross-site even if Origin looks same-origin', () => {
    expect(csrfRefusal(req('POST', { origin: `https://${HOST}`, 'sec-fetch-site': 'cross-site' }))?.status).toBe(403)
  })

  it('fails CLOSED on a mutation with no Origin/Referer/Sec-Fetch-Site (403)', () => {
    expect(csrfRefusal(req('POST'))?.status).toBe(403)
    expect(csrfRefusal(req('DELETE'))?.status).toBe(403)
  })

  it('shapes the refusal for the requesting client (casibase/openai)', async () => {
    const c = csrfRefusal(req('POST', { origin: 'https://evil.example' }), 'casibase')
    expect(await c!.json()).toEqual({ status: 'error', msg: 'Cross-origin request refused.' })
    const o = csrfRefusal(req('POST', { origin: 'https://evil.example' }), 'openai')
    expect((await o!.json()).error.message).toBe('Cross-origin request refused.')
  })
})

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

  it('PRESERVES a non-JSON Content-Type on a body (a zip/tar.gz deploy artifact upload)', () => {
    expect(upstreamHeaders(reqWith({ 'content-type': 'application/zip' }), 'maxpower', true, {})['Content-Type']).toBe('application/zip')
    expect(upstreamHeaders(reqWith({ 'content-type': 'application/gzip' }), 'maxpower', true, {})['Content-Type']).toBe('application/gzip')
    // multipart boundary must ride through so the backend can parse the parts.
    const mp = 'multipart/form-data; boundary=abc123'
    expect(upstreamHeaders(reqWith({ 'content-type': mp }), 'maxpower', true, {})['Content-Type']).toBe(mp)
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
 * CROSS-TENANT ISOLATION INVARIANT (RED MED-1) — the `/v1` proxy MUST drop the
 * browser-controlled `X-Project-Id` sub-scope, because it is EXCLUDED from cloud's
 * SanitizeIdentity.authorityHeaders (client-controllable) and the cloud evals facade
 * (`clients/eval` `tenant()`) TRUSTS `X-Project-Id` over the bearer-pinned org to
 * select a per-project console API key pair from KMS. If `/v1` ever forwarded a
 * client `X-Project-Id`, a signed-in user could set `X-Project-Id: victim-org` and
 * read another org's eval scores. `/v1` does NOT pass `forwardScope`, so this
 * suite pins that the sub-scope is dropped (and only rides when explicitly opted in,
 * as `/v1/vm` does under its own org-membership re-validation). Never remove `forwardScope`
 * defaulting to off here without a project-membership check upstream.
 */
describe('X-Project-Id drop — cross-tenant eval isolation (RED MED-1)', () => {
  it('DROPS a client-forged X-Project-Id when forwardScope is unset (the /v1 default)', () => {
    // The browser stamps X-Project-Id (client.ts baseHeaders); a forged one must NOT survive.
    const req = reqWith({ 'X-Project-Id': 'victim-org', 'X-Environment': 'mainnet' })
    const h = upstreamHeaders(req, 'maxpower', false, {}) // no forwardScope = the /v1 call
    expect(h['X-Project-Id']).toBeUndefined()
    expect(h['X-Environment']).toBeUndefined()
    expect(h['X-Org-Id']).toBe('maxpower') // org stays the bearer owner, authoritative
  })

  it('DROPS X-Project-Id even on a mutating (body) request without forwardScope', () => {
    const req = reqWith({ 'X-Project-Id': 'victim-org' })
    const h = upstreamHeaders(req, 'maxpower', true, {})
    expect(h['X-Project-Id']).toBeUndefined()
  })

  it('rides X-Project-Id ONLY when a proxy explicitly opts in (e.g. /vm), never /v1', () => {
    const req = reqWith({ 'X-Project-Id': 'proj-1' })
    expect(upstreamHeaders(req, 'maxpower', false, { forwardScope: true })['X-Project-Id']).toBe('proj-1')
  })
})

/**
 * INTENT NEVER REACHES A BACKEND — `X-Act-As-Project` (client.ts baseHeaders) is a
 * REQUEST to act in a project, not a claim of one. It is addressed to whichever
 * boundary can VALIDATE it against the caller's scope set and mint the authoritative
 * `X-Project-Id`; a backend that received the raw intent would be reading an
 * unvalidated, browser-chosen value under a different name — the very confusion the
 * two names exist to prevent. `upstreamHeaders` rebuilds the upstream header set from
 * scratch, so the intent is dropped by construction; this pins it, including under
 * `forwardScope` (a proxy opting into the sub-scope must forward the ASSERTION it
 * trusts, never the intent).
 */
describe('X-Act-As-Project — the intent is consumed by a boundary, never forwarded', () => {
  it('never rides to a backend, with or without forwardScope', () => {
    const req = reqWith({ 'X-Act-As-Project': 'atlas', 'X-Project-Id': 'atlas' })
    expect(upstreamHeaders(req, 'maxpower', false, {})['X-Act-As-Project']).toBeUndefined()
    expect(upstreamHeaders(req, 'maxpower', false, { forwardScope: true })['X-Act-As-Project']).toBeUndefined()
  })

  it('a forged intent cannot smuggle a project past the /v1 drop', () => {
    // The RED MED-1 drop above removes X-Project-Id; the intent must not be a way
    // back in for the same browser-chosen value under another name.
    const req = reqWith({ 'X-Act-As-Project': 'victim-org' })
    const h = upstreamHeaders(req, 'maxpower', false, {})
    expect(Object.values(h)).not.toContain('victim-org')
    expect(h['X-Org-Id']).toBe('maxpower') // org stays the bearer owner, authoritative
  })
})

/**
 * End-to-end forward (RED LOW-2) — the two-stage normalize→revalidate defense at the
 * TOP of forwardWithUserBearer, exercised through the real function with a mocked
 * fetch + identity. A rewrite-fed traversal (what reaches `app/v1/[...path]` after
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

/**
 * A BINARY deploy artifact (a zip/tar.gz static build) must forward through the ONE
 * proxy VERBATIM — its bytes intact and its OWN Content-Type — never text-decoded
 * (which UTF-8-corrupts binary) and never re-stamped `application/json`. This is the
 * deploy-upload path (`POST /v1/projects/:slug/deploy`).
 */
describe('forwardWithUserBearer — binary artifact passthrough (deploy upload)', () => {
  // "PK\x03\x04" (zip magic) + a byte (0xFF) that is INVALID UTF-8 — a text read would drop/replace it.
  const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0xff, 0x00])
  const fetchMock = vi.fn(async () => new Response('{"status":"live"}', { status: 200 }))

  const req = (): NextRequest =>
    ({
      method: 'POST',
      headers: new Headers({
        host: 'console.hanzo.ai',
        origin: 'https://console.hanzo.ai',
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/zip',
      }),
      nextUrl: { search: '' },
      signal: undefined,
      text: async () => {
        throw new Error('binary body must NOT be read as text')
      },
      arrayBuffer: async () => zip.buffer,
    }) as unknown as NextRequest

  beforeEach(() => {
    fetchMock.mockClear()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('forwards the exact bytes + the artifact Content-Type (not application/json)', async () => {
    const res = await forwardWithUserBearer(req(), {
      target: 'http://cloud-api.hanzo.svc.cluster.local:8000',
      path: 'v1/projects/my-app/deploy',
      allow: allowCloudSurface,
    })
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const init = (fetchMock.mock.calls[0] as unknown[])[1] as RequestInit
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/zip')
    const body = init.body as Uint8Array
    expect(body).toBeInstanceOf(Uint8Array)
    expect(Array.from(body)).toEqual(Array.from(zip)) // byte-identical, no UTF-8 corruption
  })
})

/**
 * The admin AGGREGATE proxy (`app/admin/aggregate/[...path]`) forwards to cloud under
 * `/v1/admin/*` — every admin route in cloud (`clients/admin` + hanzoai/ai's
 * `/v1/admin/providers*`) is served there, and `forwardWithUserBearer` forwards the
 * path VERBATIM. This suite pins THROUGH the real function (mocked fetch + identity)
 * that:
 *   1. the forwarded upstream path is exactly `v1/admin/<head>` (the integration-path
 *      fix — the pre-fix bare `admin/<head>` landed on a non-existent cloud route and
 *      404'd, silently breaking the provider dashboard's list/toggle/primary calls);
 *   2. GET (list) and POST (`providers/{toggle,primary}`) both forward;
 *   3. a traversal via the head (`providers/../iam`, encoded, matrix-param) 404s and
 *      NEVER fetches upstream (the two-layer pathIsClean + allow-list defense holds on
 *      the new `v1/admin/...` shape);
 *   4. `iam`/`kms` are refused (no general-tunnel), so the shared allow-list can't be
 *      widened via this aggregate proxy.
 */
describe('forwardWithUserBearer — admin aggregate targets /v1/admin/* (integration-path fix)', () => {
  const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
  const CLOUD = 'http://cloud-api.hanzo.svc.cluster.local:8000'

  const req = (method: string, headers: Record<string, string> = {}, search = ''): NextRequest =>
    ({
      method,
      headers: new Headers({ host: 'admin.hanzo.ai', origin: 'https://admin.hanzo.ai', ...headers }),
      nextUrl: { search },
      signal: undefined,
      text: async () => '',
    }) as unknown as NextRequest

  // Mirrors app/admin/aggregate/[...path]/route.ts: it rebuilds `v1/admin/<tail>` from
  // the rewrite's catch-all and forwards with allowAdminSurface as the least-privilege
  // gate. `head` is the raw catch-all tail (what params.path.join('/') yields).
  const forwardAdmin = (head: string, method = 'GET') =>
    forwardWithUserBearer(req(method), {
      target: CLOUD,
      path: `v1/admin/${head}`.replace(/\/+$/, ''),
      allow: allowAdminSurface,
      errorShape: 'casibase',
      unauthorizedMessage: 'Sign in as an administrator.',
    })

  beforeEach(() => {
    fetchMock.mockClear()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('forwards the providers LIST to cloud /v1/admin/providers (not bare /admin/providers)', async () => {
    const res = await forwardAdmin('providers')
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const calledUrl = String((fetchMock.mock.calls[0] as unknown[])[0])
    expect(calledUrl).toBe(`${CLOUD}/v1/admin/providers`)
    // The old bug forwarded here — assert we no longer do.
    expect(calledUrl).not.toBe(`${CLOUD}/admin/providers`)
  })

  // The /v1/admin/* 403 fix: the route scopes the minted user bearer to the brand
  // cloud audience (`<brand>-cloud`). The reserved-admin operator's own app is
  // `admin-console`, which cloud's audience allowlist does NOT trust — so a
  // default-audience bearer was rejected (anonymous → 403). With the cloud audience,
  // cloud validates the token and (owner=admin + isAdmin=true) grants admin.
  it('scopes the minted user bearer to the brand cloud audience on an admin host', async () => {
    const mintedFor = vi.mocked(adminBearer)
    mintedFor.mockClear()
    // Mirror the route EXACTLY: forward with audience = cloudAudience(host).
    await forwardWithUserBearer(req('GET'), {
      target: CLOUD,
      path: 'v1/admin/overview',
      allow: allowAdminSurface,
      errorShape: 'casibase',
      audience: cloudAudience('admin.hanzo.ai'),
    })
    // adminBearer is asked to mint a token scoped to hanzo-cloud (NOT admin-console).
    expect(mintedFor).toHaveBeenCalledWith(expect.objectContaining({ id: 'maxpower/dave' }), 'hanzo-cloud')
  })

  it('a proxy that omits audience mints the default (target-app) bearer — tenants unchanged', async () => {
    const mintedFor = vi.mocked(adminBearer)
    mintedFor.mockClear()
    await forwardWithUserBearer(req('GET'), { target: CLOUD, path: 'v1/admin/overview', allow: allowAdminSurface })
    expect(mintedFor).toHaveBeenCalledWith(expect.objectContaining({ id: 'maxpower/dave' }), undefined)
  })

  it('forwards the other read heads (overview/finance/compute) under /v1/admin/*', async () => {
    for (const head of ['overview', 'finance', 'compute', 'usage', 'orgs', 'audit', 'products']) {
      fetchMock.mockClear()
      const res = await forwardAdmin(head)
      expect(res.status).toBe(200)
      expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe(`${CLOUD}/v1/admin/${head}`)
    }
  })

  it('forwards the provider POST mutations (toggle / primary) under /v1/admin/providers/*', async () => {
    for (const sub of ['toggle', 'primary']) {
      fetchMock.mockClear()
      const res = await forwardAdmin(`providers/${sub}`, 'POST')
      expect(res.status).toBe(200)
      expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe(`${CLOUD}/v1/admin/providers/${sub}`)
    }
  })

  it('404s a traversal via the head (providers/../iam) and NEVER fetches upstream', async () => {
    for (const evil of ['providers/../iam', 'providers/%2e%2e/iam', 'providers%2f..%2fiam', 'providers/..;/iam']) {
      fetchMock.mockClear()
      const res = await forwardAdmin(evil)
      expect(res.status).toBe(404)
      expect(fetchMock).not.toHaveBeenCalled()
    }
  })

  it('404s iam / kms reached directly through the aggregate proxy (not a tunnel)', async () => {
    for (const head of ['iam', 'iam/get-users', 'kms', 'kms/list']) {
      fetchMock.mockClear()
      const res = await forwardAdmin(head)
      expect(res.status).toBe(404)
      expect(fetchMock).not.toHaveBeenCalled()
    }
  })

  it('refuses a cross-origin POST (CSRF) to an admin mutation before any fetch', async () => {
    fetchMock.mockClear()
    const res = await forwardWithUserBearer(
      req('POST', { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }),
      { target: CLOUD, path: 'v1/admin/providers/credit', allow: allowAdminSurface, errorShape: 'casibase' },
    )
    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
