import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { get } from './client'
import { setScope } from '~/lib/scope'
import { setCurrentActor } from '~/lib/actor-scope'
import { setCurrentOrg } from '~/lib/org-scope'
import { VisorApi } from './visor'
import { ComputeApi } from './compute'
import { ProvisioningApi } from './provisioning'
import { StorageApi } from './storage'
import { BillingApi } from './billing'
import { PlatformApi } from './platform'
import { FunctionsApi } from './functions'
import { CommerceApi } from './commerce'
import { O11yApi } from './o11y'
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
// hardened same-origin BFF proxy, so the browser URL stays prefix-free.
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
  it('StorageApi.buckets -> /v1/s3/buckets', async () => {
    stub({ buckets: [] })
    await StorageApi.buckets()
    expect(lastUrl).toBe(`${ORIGIN}/v1/s3/buckets`)
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

// The BFF-catch-all sweep (task #41): the LAST data-product clients that still built a
// service-prefixed `/cloud|/ai|/commerce/v1/…` path now build the canonical `/v1/<head>`
// too, so the static embed reaches them directly (no rewrite, no route handler) and the
// server build rewrites the head to its hardened BFF proxy — one URL form, both topologies.
describe('canonical /v1 client paths — the #41 residual sweep (functions/commerce/o11y/paas)', () => {
  it('FunctionsApi.list -> /v1/functions (was /cloud/v1/functions)', async () => {
    stub([])
    await FunctionsApi.list()
    expect(lastUrl).toBe(`${ORIGIN}/v1/functions`)
  })
  it('CommerceApi.currentStore -> /v1/store/current (was /commerce/v1/store/current)', async () => {
    stub({ store: {} })
    await CommerceApi.currentStore()
    expect(lastUrl).toBe(`${ORIGIN}/v1/store/current`)
  })
  it('O11yApi.annotationQueues -> /v1/o11y/annotation-queues (was /cloud/v1/o11y/…)', async () => {
    stub({ data: [], meta: {} })
    await O11yApi.annotationQueues()
    expect(lastUrl).toBe(`${ORIGIN}/v1/o11y/annotation-queues`)
  })
  it('PaasApi.listProjects -> /v1/platform/projects (was /cloud/v1/platform/…)', async () => {
    stub({ projects: [] })
    await PaasApi.listProjects()
    expect(lastUrl).toBe(`${ORIGIN}/v1/platform/projects`)
  })
  it('none of the swept clients emit a /<svc>/v1/ path', async () => {
    for (const call of [
      () => FunctionsApi.list(),
      () => CommerceApi.currentStore(),
      () => O11yApi.annotationQueues(),
      () => PaasApi.listProjects(),
    ]) {
      stub({ store: {}, projects: [], data: [], meta: {} })
      await call()
      expect(lastUrl).toMatch(new RegExp(`^${ORIGIN}/v1/`))
      expect(lastUrl).not.toMatch(/\/(cloud|vm|ai|commerce|billing|org)\/v1\//)
    }
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
