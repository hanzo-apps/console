import { describe, it, expect, vi, beforeEach } from 'vitest'

// Lock the /v1/projects contract by capturing every transport call (URL + args),
// without touching the network. cloudProxyV1Url is stubbed to a predictable `/v1/<path>`.
const calls = { get: [] as string[], post: [] as unknown[][], patch: [] as unknown[][], raw: [] as unknown[][] }

vi.mock('./client', () => {
  class ApiError extends Error {
    status?: number
    constructor(m: string, s?: number) {
      super(m)
      this.status = s
    }
  }
  return {
    ApiError,
    cloudProxyV1Url: (p: string) => `/v1/${p.replace(/^\/+/, '')}`,
    restGet: vi.fn((url: string) => {
      calls.get.push(url)
      return Promise.resolve([])
    }),
    restPost: vi.fn((url: string, body?: unknown) => {
      calls.post.push([url, body])
      return Promise.resolve({ id: 'proj_x', slug: 'my-app' })
    }),
    restPatch: vi.fn((url: string, body?: unknown) => {
      calls.patch.push([url, body])
      return Promise.resolve({ id: 'proj_x', slug: 'my-app' })
    }),
    restPostRaw: vi.fn((url: string, body: unknown, ct: string) => {
      calls.raw.push([url, body, ct])
      return Promise.resolve({ id: 'dep_1', status: 'live' })
    }),
  }
})

import { PlatformSitesApi } from './platform-sites'

beforeEach(() => {
  calls.get = []
  calls.post = []
  calls.patch = []
  calls.raw = []
})

describe('PlatformSitesApi — the /v1/projects contract', () => {
  it('list → GET /v1/projects', async () => {
    await PlatformSitesApi.list()
    expect(calls.get).toContain('/v1/projects')
  })

  it('create → POST /v1/projects', async () => {
    await PlatformSitesApi.create({ name: 'my-app', slug: 'my-app', framework: 'static' })
    expect(calls.post[0][0]).toBe('/v1/projects')
  })

  it('deploy → POST-raw /v1/projects/:slug/deploy with the BYTES + Content-Type verbatim', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    await PlatformSitesApi.deploy('my-app', bytes, 'application/zip')
    expect(calls.raw[0][0]).toBe('/v1/projects/my-app/deploy')
    expect(calls.raw[0][1]).toBe(bytes) // the exact artifact, not JSON
    expect(calls.raw[0][2]).toBe('application/zip')
  })

  it('deployments + domains hit the right sub-paths', async () => {
    await PlatformSitesApi.listDeployments('my-app')
    await PlatformSitesApi.listDomains('my-app')
    expect(calls.get).toContain('/v1/projects/my-app/deployments')
    expect(calls.get).toContain('/v1/projects/my-app/domains')
  })

  it('bindDomains → POST /v1/projects/:slug/domains { domains }', async () => {
    await PlatformSitesApi.bindDomains('my-app', ['x.example.com'])
    expect(calls.post[0][0]).toBe('/v1/projects/my-app/domains')
    expect(calls.post[0][1]).toEqual({ domains: ['x.example.com'] })
  })

  it('never targets an /api/ prefix or a "svc" suffix', async () => {
    await PlatformSitesApi.list()
    await PlatformSitesApi.deploy('my-app', new Uint8Array(), 'application/gzip')
    const all = [...calls.get, ...calls.raw.map((c) => c[0] as string), ...calls.post.map((c) => c[0] as string)]
    for (const u of all) {
      expect(u).not.toContain('/api/')
      expect(u).not.toContain('svc')
      expect(u.startsWith('/v1/projects')).toBe(true)
    }
  })
})
