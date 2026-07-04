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

// Most refactored clients hit a CANONICAL `/v1/<resource>` (nothing before /v1/): the
// console host's ingress routes `/v1/*` to the gateway (cloud-api), which SERVES those
// heads on the session/header path (provisioning reads the stamped X-Org-Id; billing +
// the AI heads validate the session), so the browser URL stays prefix-free.
//
// The EXCEPTIONS are heads the bare `/v1/*` → gateway path can NOT satisfy: the VISOR
// catalog (regions/sizes/gpus — cloud-api serves no visor catalog route) and the
// bearer-scoped compute + s3 + framework surfaces (cloud-api needs an org from a minted
// BEARER, which the gateway strips from the cookie-only path → 403). Those clients
// address their `/vm` or `/cloud` user-bearer proxy EXPLICITLY — see the dedicated block
// below. This is the SAME ingress reality that the framework/s3 fix (v8.4.70) documented.
describe('canonical /v1 client paths (no service prefix before /v1/)', () => {
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
  it('PlatformApi.listClusters -> /v1/clusters', async () => {
    stub({ clusters: [] })
    await PlatformApi.listClusters()
    expect(lastUrl).toBe(`${ORIGIN}/v1/clusters`)
  })

  it('a prefix-free client never emits a /<svc>/v1/ path', async () => {
    stub([])
    await ProvisioningApi.list('sql')
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

// s3 + framework + billing are the DELIBERATE exceptions to the prefix-free rule
// above. The live console ingress does NOT rewrite a bare `/v1/s3` / `/v1/framework`
// / `/v1/billing` to the console app — those heads reach the gateway-fronted cloud
// binary directly, which 403s a cookie-only browser request with no bearer (s3/
// framework: "valid principal required"; billing: "sign in to view billing"). So the
// clients address the console's OWN proxy EXPLICITLY: s3/framework via the `/cloud`
// user-bearer proxy (`cloudProxyV1Url`), billing via the per-tenant `/billing/v1/*`
// service-token proxy (`billingProxyV1Url`) — both routed to their Next handler
// regardless of the `/v1/*` ingress config. This block PINS that exception so a
// future "canonicalization" can't repoint them to a bare `/v1/` that 403s live.
describe('proxy exceptions — s3/framework via /cloud/v1, billing via /billing/v1 (ingress does not rewrite their heads)', () => {
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

  it('BillingApi.balance -> /billing/v1/balance (NOT bare /v1/billing)', async () => {
    stub({ balance: 0, holds: 0, available: 0 })
    await BillingApi.balance()
    expect(lastUrl).toBe(`${ORIGIN}/billing/v1/balance?currency=usd`)
  })
})

// The VISOR CATALOG + MACHINES are the compute analog of the s3/framework exception —
// PINNED here because a bare `/v1/*` from the browser hits the gateway (→ cloud-api),
// which serves NO visor catalog route (`/v1/gpu-sizes` 404s) and needs a minted bearer
// for machines (`/v1/machines` 403 "X-Org-Id required"). That was the ROOT CAUSE of the
// live "Accelerators 0 available to launch" bug — the catalog was hitting cloud-api, not
// visor. The catalog reads visor DIRECTLY via `/vm`; machines/launch/terminate go through
// the `/cloud` user-bearer proxy (org from the Bearer owner). Do NOT "canonicalize" these
// back to a bare `/v1/` — that reintroduces the empty-catalog bug.
describe('compute-proxy exceptions — visor catalog via /vm, machines via /cloud (ingress does not serve their bare heads)', () => {
  it('VisorApi.gpus (accelerator CATALOG) -> /vm/v1/gpus (visor, NOT cloud-api /v1/gpu-sizes)', async () => {
    stub({ data: [] })
    await VisorApi.gpus()
    expect(lastUrl).toBe(`${ORIGIN}/vm/v1/gpus`)
  })
  it('VisorApi.regions -> /vm/v1/regions', async () => {
    stub({ data: [] })
    await VisorApi.regions()
    expect(lastUrl).toBe(`${ORIGIN}/vm/v1/regions`)
  })
  it('VisorApi.sizes -> /vm/v1/sizes', async () => {
    stub({ data: [] })
    await VisorApi.sizes()
    expect(lastUrl).toBe(`${ORIGIN}/vm/v1/sizes`)
  })
  it('VisorApi.machines -> /cloud/v1/machines (bearer-scoped, NOT bare /v1/machines)', async () => {
    stub({ machines: [] })
    await VisorApi.machines()
    expect(lastUrl).toBe(`${ORIGIN}/cloud/v1/machines`)
  })
})
