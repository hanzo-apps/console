import { describe, it, expect, afterEach, vi } from 'vitest'

import { TenantsApi } from './tenants'

const ORIGIN = 'https://console.hanzo.ai'

let lastUrl = ''
let lastInit: RequestInit | undefined

/** Stub window + a single JSON fetch; capture url + init (matches canonical-paths.test). */
function stub(body: unknown, status = 200): void {
  lastUrl = ''
  lastInit = undefined
  ;(globalThis as { window?: unknown }).window = { location: { origin: ORIGIN, hostname: 'console.hanzo.ai' } }
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    lastUrl = String(url)
    lastInit = init
    return Promise.resolve(
      new Response(status === 204 ? null : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    )
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  delete (globalThis as { window?: unknown }).window
})

describe('TenantsApi — data-driven paths through the /paas proxy', () => {
  it('packages() reads /paas/packages (the DATA catalog, never a hardcoded const)', async () => {
    stub({ packages: [{ id: 'ats', name: 'ATS', services: ['ats'] }] })
    const pkgs = await TenantsApi.packages()
    expect(lastUrl).toBe('/paas/packages')
    expect(pkgs.map((p) => p.id)).toEqual(['ats'])
  })

  it('packages() returns honest empty for a bad/absent catalog (no fabrication)', async () => {
    stub({})
    expect(await TenantsApi.packages()).toEqual([])
  })

  it('clusters(org) reads /paas/org/<org>/cluster and normalizes', async () => {
    stub({ clusters: [{ name: 'acme-k8s', region: 'sfo3', phase: 'ready' }] })
    const cs = await TenantsApi.clusters('acme')
    expect(lastUrl).toBe('/paas/org/acme/cluster')
    expect(cs[0]).toMatchObject({ name: 'acme-k8s', region: 'sfo3', phase: 'ready' })
  })

  it('domains(org) reads /paas/org/<org>/domain (routed hosts derive from records)', async () => {
    stub({ domains: [{ host: 'admin.acme.com', serviceName: 'console', status: 'active' }] })
    const ds = await TenantsApi.domains('acme')
    expect(lastUrl).toBe('/paas/org/acme/domain')
    expect(ds[0]).toMatchObject({ host: 'admin.acme.com', serviceName: 'console', status: 'active' })
  })

  it('brandConfig(host) reads /paas/brand?host=<h> (the data-driven config resolver)', async () => {
    stub({ org: 'acme', brandName: 'Acme Cloud', logoUrl: 'https://x/l.png', iamUrl: 'https://acme.id' })
    const bc = await TenantsApi.brandConfig('admin.acme.com')
    expect(lastUrl).toBe('/paas/brand?host=admin.acme.com')
    expect(bc).toMatchObject({ org: 'acme', brandName: 'Acme Cloud', logoUrl: 'https://x/l.png', iamUrl: 'https://acme.id' })
  })

  it('brandConfig returns null when the record has no org (honest, never fabricated)', async () => {
    stub({ brandName: 'ghost' })
    expect(await TenantsApi.brandConfig('x.com')).toBeNull()
  })

  it('provisionCluster POSTs the cluster body to /paas/org/<org>/cluster', async () => {
    stub({ cluster: { name: 'new', phase: 'provisioning' } })
    await TenantsApi.provisionCluster('acme', { region: 'sfo3', nodeSize: 's-2vcpu-4gb', nodeCount: 3 })
    expect(lastUrl).toBe('/paas/org/acme/cluster')
    expect(lastInit?.method).toBe('POST')
    const sent = JSON.parse(String(lastInit?.body))
    expect(sent).toMatchObject({ organizationId: 'acme', region: 'sfo3', nodeSize: 's-2vcpu-4gb', nodeCount: 3 })
  })

  it('bindDomain POSTs to /paas/org/<org>/domain with letsencrypt+https', async () => {
    stub({})
    await TenantsApi.bindDomain('acme', { host: 'admin.acme.com', serviceName: 'console' })
    expect(lastUrl).toBe('/paas/org/acme/domain')
    const sent = JSON.parse(String(lastInit?.body))
    expect(sent).toMatchObject({ host: 'admin.acme.com', serviceName: 'console', https: true, certificateType: 'letsencrypt' })
  })

  it('provisionPackage POSTs to /paas/org/<org>/package/<id>', async () => {
    stub({})
    await TenantsApi.provisionPackage('acme', 'sovereign-l1')
    expect(lastUrl).toBe('/paas/org/acme/package/sovereign-l1')
    expect(lastInit?.method).toBe('POST')
  })
})
