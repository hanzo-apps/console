import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

import { GET, POST, PATCH, DELETE } from '../../app/paas/[...path]/route'

const ORIGIN = 'https://console.hanzo.ai'
const ctx = (path: string[]) => ({ params: Promise.resolve({ path }) })

const reqWith = (method: string, cookie?: string): NextRequest =>
  new NextRequest(`${ORIGIN}/paas/apps?cluster=hanzo`, {
    method,
    headers: cookie ? { cookie } : {},
    body: method === 'GET' || method === 'HEAD' ? undefined : '{}',
  })

const ADMIN = { owner: 'hanzo', name: 'ada', isAdmin: true, type: 'normal-user' }
const MEMBER = { owner: 'hanzo', name: 'mo', isAdmin: false, type: 'normal-user' }
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

describe('/paas proxy — deny-by-default authz', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
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

  it('admin reaches upstream; the service token is attached server-side only', async () => {
    vi.stubEnv('PAAS_SERVICE_TOKEN', 'secret-token')
    vi.stubEnv('PLATFORM_URL', 'https://platform.test')
    const f = fetchFor(ADMIN, { status: 200, body: '{"apps":[{"id":"x"}]}' })
    vi.stubGlobal('fetch', f)

    const r = await GET(reqWith('GET', 'sid=ada'), ctx(['apps']))
    expect(r.status).toBe(200)
    expect(await r.text()).toContain('apps')

    const forwarded = f.mock.calls.find(([u]) => String(u).startsWith('https://platform.test'))
    expect(forwarded, 'forwarded to platform').toBeTruthy()
    expect(String(forwarded![0])).toBe('https://platform.test/v1/apps?cluster=hanzo')
    expect((forwarded![1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer secret-token' })
  })

  it('admin gets an honest 501 when the token is unset (no token leak to anyone)', async () => {
    // PAAS_SERVICE_TOKEN intentionally unset
    vi.stubGlobal('fetch', fetchFor(ADMIN))
    const r = await GET(reqWith('GET', 'sid=ada'), ctx(['apps']))
    expect(r.status).toBe(501)
  })
})
