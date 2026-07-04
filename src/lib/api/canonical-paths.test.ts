import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { get } from './client'
import { setScope } from '~/lib/scope'
import { setCurrentActor } from '~/lib/actor-scope'
import { setCurrentOrg } from '~/lib/org-scope'
import { VisorApi } from './visor'
import { ComputeApi } from './compute'
import { ProvisioningApi } from './provisioning'
import { StorageApi } from './storage'
import { FrameworkApi } from '~/lib/framework/client'
import { BillingApi } from './billing'
import { PlatformApi } from './platform'
import { fetchPlans } from './aicatalog'
import { ApmApi } from './apm'
import { CommerceApi } from './commerce'
import { EmbeddingsApi } from './embeddings'
import { FunctionsApi } from './functions'
import { PaasApi } from './paas'

const ORIGIN = 'https://console.hanzo.ai'

let lastUrl = ''
let lastInit: RequestInit | undefined

/** Stub window (Map-backed localStorage) + a single JSON fetch; capture url + init. */
function stub(body: unknown, status = 200): void {
  lastUrl = ''
  lastInit = undefined
  const store = new Map<string, string>()
  ;(globalThis as { window?: unknown }).window = {
    location: { origin: ORIGIN, hostname: 'console.hanzo.ai' },
    localStorage: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, val: string) => void store.set(k, val),
      removeItem: (k: string) => void store.delete(k),
    },
  }
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

// Every refactored client must hit a CANONICAL `/v1/<resource>` (nothing before
// /v1/) — never `/<svc>/v1/...`. The next.config rewrites route each head to its
// hardened same-origin BFF proxy, so the browser URL stays prefix-free. (s3 +
// framework are the two DOCUMENTED exceptions — see the dedicated block below —
// because the live ingress does not rewrite their heads to the console app.)
describe('canonical /v1 client paths (no service prefix before /v1/)', () => {
  it('VisorApi.machines -> /v1/machines', async () => {
    stub({ machines: [] })
    await VisorApi.machines()
    expect(lastUrl).toBe(`${ORIGIN}/v1/machines`)
  })
  it('VisorApi.regions -> /v1/regions', async () => {
    stub({ regions: [] })
    await VisorApi.regions()
    expect(lastUrl).toBe(`${ORIGIN}/v1/regions`)
  })
  it('VisorApi.gpus (catalog) -> /v1/gpu-sizes (distinct from the inventory head)', async () => {
    stub({ gpus: [] })
    await VisorApi.gpus()
    expect(lastUrl).toBe(`${ORIGIN}/v1/gpu-sizes`)
  })
  it('ComputeApi.gpus (inventory) -> /v1/gpus', async () => {
    stub({ gpus: [] })
    await ComputeApi.gpus()
    expect(lastUrl).toBe(`${ORIGIN}/v1/gpus`)
  })
  it('ProvisioningApi.list(sql) -> /v1/sql', async () => {
    stub([])
    await ProvisioningApi.list('sql')
    expect(lastUrl).toBe(`${ORIGIN}/v1/sql`)
  })
  it('BillingApi.balance -> /v1/billing/balance', async () => {
    stub({ balanceCents: 0 })
    await BillingApi.balance()
    expect(lastUrl).toBe(`${ORIGIN}/v1/billing/balance?currency=usd`)
  })
  it('PlatformApi.listClusters -> /v1/clusters', async () => {
    stub({ clusters: [] })
    await PlatformApi.listClusters()
    expect(lastUrl).toBe(`${ORIGIN}/v1/clusters`)
  })

  it('never emits a /<svc>/v1/ path', async () => {
    stub({ machines: [] })
    await VisorApi.machines()
    expect(lastUrl).not.toMatch(/\/(cloud|vm|ai|billing|org)\/v1\//)
  })
})

// baseHeaders stamps the FULL tenant path on every call: org (always), project
// (when selected), and the signed-in actor (when a session is resolved).
describe('baseHeaders — org + project + actor on every call', () => {
  beforeEach(() => {
    stub({ status: 'ok', msg: '', data: {} })
  })

  it('stamps X-Org-Id + X-Project-Id + X-Actor-Id', async () => {
    setCurrentOrg('maxpower')
    setScope({ project: 'proj-1', environment: 'mainnet' })
    setCurrentActor('hanzo/z')
    await get('anything')
    const h = (lastInit?.headers ?? {}) as Record<string, string>
    expect(h['X-Org-Id']).toBe('maxpower')
    expect(h['X-Project-Id']).toBe('proj-1')
    expect(h['X-Actor-Id']).toBe('hanzo/z')
  })

  it('omits X-Project-Id + X-Actor-Id when neither project nor actor is set', async () => {
    setScope({ project: undefined, environment: 'mainnet' })
    setCurrentActor('')
    await get('anything')
    const h = (lastInit?.headers ?? {}) as Record<string, string>
    expect(h['X-Project-Id']).toBeUndefined()
    expect(h['X-Actor-Id']).toBeUndefined()
    expect(h['X-Org-Id']).toBeTruthy()
  })
})

// The three centralized proxy helpers were DELETED (aiV1Url / cloudProxyV1Url /
// commerceProxyV1Url): every remaining data-product client now builds the CANONICAL,
// prefix-free `/v1/<resource>` through the ONE `originV1Url` (apm/commerce namespace their
// surface AFTER `/v1/`, the billing twin — never before it). next.config rewrites each head
// to its hardened same-origin BFF proxy, so the browser URL stays prefix-free. This locks
// the six clients PR #79 left on `/<svc>/v1/` (aicatalog/apm/commerce/embeddings/functions/paas).
describe('canonical /v1 — the last six data-product clients (no prefix before /v1/)', () => {
  it('aicatalog fetchPlans -> /v1/plans (AI catalog head -> /ai)', async () => {
    stub({ plans: [] })
    await fetchPlans()
    expect(lastUrl).toBe(`${ORIGIN}/v1/plans`)
  })
  it('embeddings EmbeddingsApi.generate -> /v1/embeddings (AI head -> /ai)', async () => {
    stub({})
    await EmbeddingsApi.generate('text-embedding-3-small', 'hi')
    expect(lastUrl).toBe(`${ORIGIN}/v1/embeddings`)
  })
  it('apm ApmApi.dashboards -> /v1/o11y/v1/dashboards (cloud o11y -> /cloud)', async () => {
    stub([])
    await ApmApi.dashboards()
    expect(lastUrl).toBe(`${ORIGIN}/v1/o11y/v1/dashboards`)
  })
  it('functions FunctionsApi.list -> /v1/functions (cloud product head -> /cloud)', async () => {
    stub({ functions: [] })
    await FunctionsApi.list()
    expect(lastUrl).toBe(`${ORIGIN}/v1/functions`)
  })
  it('paas PaasApi.listProjects -> /v1/platform/projects (cloud platform head -> /cloud)', async () => {
    stub({ projects: [] })
    await PaasApi.listProjects()
    expect(lastUrl).toBe(`${ORIGIN}/v1/platform/projects`)
  })
  it('commerce CommerceApi.currentStore -> /v1/commerce/store/current (namespaced -> /commerce)', async () => {
    stub({ store: {} })
    await CommerceApi.currentStore()
    expect(lastUrl).toBe(`${ORIGIN}/v1/commerce/store/current`)
  })

  it('none of the six emits a /<svc>/v1/ prefix', async () => {
    const bad = /\/(cloud|vm|ai|billing|org|commerce)\/v1\//
    stub({ plans: [] })
    await fetchPlans()
    expect(lastUrl).not.toMatch(bad)
    stub({})
    await EmbeddingsApi.generate('m', 'x')
    expect(lastUrl).not.toMatch(bad)
    stub([])
    await ApmApi.dashboards()
    expect(lastUrl).not.toMatch(bad)
    stub({ functions: [] })
    await FunctionsApi.list()
    expect(lastUrl).not.toMatch(bad)
    stub({ projects: [] })
    await PaasApi.listProjects()
    expect(lastUrl).not.toMatch(bad)
    stub({ store: {} })
    await CommerceApi.currentStore()
    expect(lastUrl).not.toMatch(bad)
  })
})

// s3 + framework are the DELIBERATE exceptions to the prefix-free rule above. The
// live Traefik ingress does NOT rewrite a bare `/v1/s3` / `/v1/framework` to the
// console app — those heads reach hanzoai/gateway directly with no principal and
// 403 ("valid principal required"). So both clients address the `/cloud` user-bearer
// proxy EXPLICITLY (`cloudProxyV1Url` → `<origin>/cloud/v1/<head>`), which IS routed
// to `app/cloud/[...path]` regardless of the `/v1/*` ingress config (see the
// `cloudProxyV1Url` docstring in client.ts). This block PINS that exception so a
// future "canonicalization" can't repoint them to a bare `/v1/` that 403s live.
describe('cloud-proxy exceptions — s3 + framework address /cloud/v1 explicitly (ingress does not rewrite their heads)', () => {
  it('StorageApi.buckets -> /cloud/v1/s3/buckets (NOT bare /v1/s3)', async () => {
    stub({ buckets: [] })
    await StorageApi.buckets()
    expect(lastUrl).toBe(`${ORIGIN}/cloud/v1/s3/buckets`)
  })

  it('FrameworkApi.doctypes.list -> /cloud/v1/framework/doctypes (NOT bare /v1/framework)', async () => {
    stub({ data: [] })
    await FrameworkApi.doctypes.list()
    expect(lastUrl).toBe(`${ORIGIN}/cloud/v1/framework/doctypes`)
  })
})
