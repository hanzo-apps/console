import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

import { GET, POST, PATCH, DELETE } from '../../app/paas/[...path]/route'

const ORIGIN = 'https://console.hanzo.ai'
const CLOUD = 'https://cloud-api.test'
const ctx = (path: string[]) => ({ params: Promise.resolve({ path }) })

const reqWith = (method: string, cookie?: string, pathSuffix = 'apps?cluster=hanzo'): NextRequest =>
  new NextRequest(`${ORIGIN}/paas/${pathSuffix}`, {
    method,
    headers: cookie ? { cookie } : {},
    body: method === 'GET' || method === 'HEAD' ? undefined : '{}',
  })

// GLOBAL admin: owner is the admin org → reaches the global control plane.
const GLOBAL_ADMIN = { owner: 'admin', name: 'root', isAdmin: true, isGlobalAdmin: false, type: 'normal-user' }
// ORG admin (the C1 case): admin OF a tenant org, NOT global → must be refused.
const ORG_ADMIN = { owner: 'maxpower', name: 'davelorenzini', isAdmin: true, isGlobalAdmin: false, type: 'normal-user' }
const MEMBER = { owner: 'hanzo', name: 'mo', isAdmin: false, isGlobalAdmin: false, type: 'normal-user' }
const ANON = { owner: 'hanzo', name: 'anonymous', type: 'anonymous-user' }

const accountRes = (account: unknown) =>
  new Response(JSON.stringify({ status: 'ok', msg: '', data: account }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

function fetchFor(account: unknown, platform?: { status?: number; body?: string }) {
  return vi.fn(async (url: string) => {
    if (String(url).includes('/v1/get-account')) return accountRes(account)
    return new Response(platform?.body ?? '{"apps":[]}', {
      status: platform?.status ?? 200,
      headers: { 'content-type': 'application/json' },
    })
  })
}

const VERBS = [
  ['GET', GET],
  ['POST', POST],
  ['PATCH', PATCH],
  ['DELETE', DELETE],
] as const

describe('/paas proxy — deny-by-default GLOBAL-admin authz', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.stubEnv('CLOUD_URL', CLOUD) // pin the session authority
  })
  afterEach(() => vi.unstubAllEnvs())

  it('401 for every verb when there is no session (and no backend call)', async () => {
    vi.stubEnv('PAAS_SERVICE_TOKEN', 'secret-token')
    const f = fetchFor(ANON)
    vi.stubGlobal('fetch', f)
    for (const [method, handler] of VERBS) {
      const r = await handler(reqWith(method), ctx(['apps']))
      expect(r.status, `${method} unauth → 401`).toBe(401)
    }
    expect(f).not.toHaveBeenCalled() // short-circuits with no cookie
  })

  it('401 for an anonymous casibase session', async () => {
    vi.stubEnv('PAAS_SERVICE_TOKEN', 'secret-token')
    vi.stubGlobal('fetch', fetchFor(ANON))
    const r = await GET(reqWith('GET', 'sid=anon'), ctx(['apps']))
    expect(r.status).toBe(401)
  })

  it('403 for every verb for an authenticated NON-admin', async () => {
    vi.stubEnv('PAAS_SERVICE_TOKEN', 'secret-token')
    vi.stubGlobal('fetch', fetchFor(MEMBER))
    for (const [method, handler] of VERBS) {
      const r = await handler(reqWith(method, 'sid=mo'), ctx(['apps']))
      expect(r.status, `${method} non-admin → 403`).toBe(403)
    }
  })

  // THE C1 FIX: a tenant ORG admin (isAdmin=true, owner=maxpower) must NOT reach
  // the global platform — the token forwards no user scope, so org-admin ≠ global.
  it('403 for every verb for a tenant ORG admin (isAdmin=true but not global)', async () => {
    vi.stubEnv('PAAS_SERVICE_TOKEN', 'secret-token')
    const f = fetchFor(ORG_ADMIN, { status: 200, body: '{"apps":[{"id":"leak"}]}' })
    vi.stubGlobal('fetch', f)
    for (const [method, handler] of VERBS) {
      const r = await handler(reqWith(method, 'sid=dave'), ctx(['apps']))
      expect(r.status, `${method} org-admin → 403`).toBe(403)
    }
    // never forwarded to the platform → no token ever attached for an org admin
    expect(f.mock.calls.some(([u]) => String(u).includes('platform'))).toBe(false)
  })

  it('a GLOBAL admin reaches upstream; the service token is attached server-side only', async () => {
    vi.stubEnv('PAAS_SERVICE_TOKEN', 'secret-token')
    vi.stubEnv('PLATFORM_URL', 'https://platform.test')
    const f = fetchFor(GLOBAL_ADMIN, { status: 200, body: '{"apps":[{"id":"x"}]}' })
    vi.stubGlobal('fetch', f)

    const r = await GET(reqWith('GET', 'sid=root'), ctx(['apps']))
    expect(r.status).toBe(200)
    expect(await r.text()).toContain('apps')

    const forwarded = f.mock.calls.find(([u]) => String(u).startsWith('https://platform.test'))
    expect(forwarded, 'forwarded to platform').toBeTruthy()
    expect(String(forwarded![0])).toBe('https://platform.test/v1/apps?cluster=hanzo')
    expect((forwarded![1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer secret-token' })
  })

  it('a GLOBAL admin gets an honest 501 when the token is unset (no token leak to anyone)', async () => {
    // PAAS_SERVICE_TOKEN intentionally unset
    vi.stubGlobal('fetch', fetchFor(GLOBAL_ADMIN))
    const r = await GET(reqWith('GET', 'sid=root'), ctx(['apps']))
    expect(r.status).toBe(501)
  })

  // Path-traversal: even a global admin cannot escape /v1 on the platform.
  it('400 on a `..` traversal segment (cannot escape /v1), for a global admin', async () => {
    vi.stubEnv('PAAS_SERVICE_TOKEN', 'secret-token')
    vi.stubEnv('PLATFORM_URL', 'https://platform.test')
    const f = fetchFor(GLOBAL_ADMIN, { status: 200, body: '{}' })
    vi.stubGlobal('fetch', f)
    const r = await GET(reqWith('GET', 'sid=root', 'x'), ctx(['..', '..', 'admin']))
    expect(r.status).toBe(400)
    // never forwarded to the platform
    expect(f.mock.calls.some(([u]) => String(u).startsWith('https://platform.test'))).toBe(false)
  })

  it('400 on a `.` segment and on an empty segment', async () => {
    vi.stubEnv('PAAS_SERVICE_TOKEN', 'secret-token')
    vi.stubGlobal('fetch', fetchFor(GLOBAL_ADMIN))
    expect((await GET(reqWith('GET', 'sid=root', 'x'), ctx(['.', 'apps']))).status).toBe(400)
    expect((await GET(reqWith('GET', 'sid=root', 'x'), ctx(['apps', '']))).status).toBe(400)
  })

  it('allows legit multi-segment platform paths (org/{org}/cluster)', async () => {
    vi.stubEnv('PAAS_SERVICE_TOKEN', 'secret-token')
    vi.stubEnv('PLATFORM_URL', 'https://platform.test')
    const f = fetchFor(GLOBAL_ADMIN, { status: 200, body: '{"clusters":[]}' })
    vi.stubGlobal('fetch', f)
    const r = await GET(reqWith('GET', 'sid=root', 'org/maxpower/cluster'), ctx(['org', 'maxpower', 'cluster']))
    expect(r.status).toBe(200)
    const forwarded = f.mock.calls.find(([u]) => String(u).startsWith('https://platform.test'))
    expect(String(forwarded![0])).toBe('https://platform.test/v1/org/maxpower/cluster')
  })
})
