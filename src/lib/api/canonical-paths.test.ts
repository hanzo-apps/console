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
import { StoreApi } from './stores'
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

// The bearer-scoped CLOUD heads — gpus / clusters (compute), functions, platform
// (paas) — are the compute analog of the s3/framework/provisioning exception: a bare
// `/v1/<head>` from the browser hits the console ingress, which routes `/v1/*` to the
// gateway (cloud-api) BYPASSING Next, so the next.config `/v1 → /cloud` rewrite never
// runs and cloud-api 403s "X-Org-Id required" (the gateway strips the client header and
// has no minted bearer to inject the org). VERIFIED LIVE (2026-07): `/v1/gpus`,
// `/v1/clusters`, `/v1/functions`, `/v1/platform/projects` all return 403 while their
// `/cloud/v1/*` twins return 200. So these clients MUST address the `/cloud` user-bearer
// proxy EXPLICITLY (`cloudProxyV1Url`) — same class + fix as s3/framework (v8.4.70) and
// machines. Do NOT "canonicalize" them back to a bare `/v1/` — that 403s a signed-in
// customer and shows a FALSE "Not enabled for your account".
describe('cloud bearer-scoped heads via /cloud (ingress does not serve their bare /v1 heads)', () => {
  it('ComputeApi.gpus (inventory) -> /cloud/v1/gpus (NOT bare /v1/gpus → gateway 403)', async () => {
    stub({ gpus: [] })
    await ComputeApi.gpus()
    expect(lastUrl).toBe(`${ORIGIN}/cloud/v1/gpus`)
  })
  it('PlatformApi.listClusters -> /cloud/v1/clusters (NOT bare /v1/clusters)', async () => {
    stub({ clusters: [] })
    await PlatformApi.listClusters()
    expect(lastUrl).toBe(`${ORIGIN}/cloud/v1/clusters`)
  })
  it('FunctionsApi.list -> /cloud/v1/functions (NOT bare /v1/functions)', async () => {
    stub({ functions: [] })
    await FunctionsApi.list()
    expect(lastUrl).toBe(`${ORIGIN}/cloud/v1/functions`)
  })
  it('PaasApi.listProjects -> /cloud/v1/platform/projects (NOT bare /v1/platform)', async () => {
    stub({ projects: [] })
    await PaasApi.listProjects()
    expect(lastUrl).toBe(`${ORIGIN}/cloud/v1/platform/projects`)
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

// The genuinely SESSION-scoped data-product clients build the CANONICAL, prefix-free
// `/v1/<resource>` through `originV1Url` (apm/commerce namespace their surface AFTER
// `/v1/`, never before it). plans/embeddings (AI gateway) and commerce are served on
// the session path (the gateway forwards the session and cloud resolves the org from
// the session owner), so a bare `/v1/*` works — VERIFIED LIVE. apm/o11y keeps its
// prefix-free shape here; its backend cloud→SigNoz reverse-proxy is a separate infra
// gap (surfaces show an honest RuntimeNotice until it resolves) — not a client-path bug.
// (functions + paas MOVED to the /cloud bearer block above — they are header-scoped and
// 403 on the bare path.)
describe('canonical /v1 — session-scoped data-product clients (no prefix before /v1/)', () => {
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
  it('apm ApmApi.dashboards -> /v1/o11y/v1/dashboards (cloud o11y)', async () => {
    stub([])
    await ApmApi.dashboards()
    expect(lastUrl).toBe(`${ORIGIN}/v1/o11y/v1/dashboards`)
  })
  // Functions + PaaS are NOT bare-/v1/ clients — they address the `/cloud` bearer proxy
  // (pinned in the "cloud bearer-scoped heads via /cloud" block above). Commerce is NOT a
  // bare-/v1/ client either — it addresses the `/commerce` proxy EXPLICITLY (pinned in the
  // proxy-exceptions block below). The live ingress does not rewrite their heads.

  it('none of the (bare-/v1/) three emits a /<svc>/v1/ prefix', async () => {
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
  })
})

// s3 + framework + provisioning (sql/vector/kv/datastore/docdb/search) + billing + COMMERCE
// + the casibase STORE-ADMIN heads (get-stores/…) are the DELIBERATE exceptions to the
// prefix-free rule above. The live console ingress does NOT rewrite a bare `/v1/<head>` to the
// console app — those heads reach the gateway-fronted cloud binary directly, which rejects a
// cookie-only browser request (s3/framework: "valid principal required"; provisioning:
// "X-Org-Id required"; billing: "sign in to view billing"; commerce: 403 → a FALSE "Not
// enabled for your account"; get-stores: 401 → a FALSE "session expired"). So the clients
// address the console's OWN proxy EXPLICITLY: s3/framework/provisioning/stores via the
// `/cloud` user-bearer proxy (`cloudProxyV1Url` / `cloudGet`), commerce via the `/commerce`
// user-bearer proxy (`commerceProxyV1Url`), billing via the per-tenant `/billing/v1/*`
// service-token proxy (`billingProxyV1Url`) — all routed to their Next handler regardless of
// the `/v1/*` ingress config. This block PINS that exception so a future "canonicalization"
// can't repoint them to a bare `/v1/` that fails live.
describe('proxy exceptions — s3/framework/provisioning/stores via /cloud/v1, commerce via /commerce/v1, billing via /billing/v1 (ingress does not rewrite their heads)', () => {
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

  it('ProvisioningApi.list(vector) -> /cloud/v1/vector (NOT bare /v1/vector → gateway 403)', async () => {
    stub([])
    await ProvisioningApi.list('vector')
    expect(lastUrl).toBe(`${ORIGIN}/cloud/v1/vector`)
  })

  it('ProvisioningApi.list(sql) -> /cloud/v1/sql (bearer-scoped, NOT bare /v1/sql)', async () => {
    stub([])
    await ProvisioningApi.list('sql')
    expect(lastUrl).toBe(`${ORIGIN}/cloud/v1/sql`)
  })

  it('BillingApi.balance -> /billing/v1/balance (NOT bare /v1/billing)', async () => {
    stub({ balance: 0, holds: 0, available: 0 })
    await BillingApi.balance()
    expect(lastUrl).toBe(`${ORIGIN}/billing/v1/balance?currency=usd`)
  })

  it('CommerceApi.currentStore -> /commerce/v1/store/current (NOT bare /v1/commerce → gateway 403 "Not enabled")', async () => {
    stub({ store: {} })
    await CommerceApi.currentStore()
    expect(lastUrl).toBe(`${ORIGIN}/commerce/v1/store/current`)
  })

  it('StoreApi.list (embeddings collections) -> /cloud/v1/get-stores (NOT bare /v1/get-stores → 401 false "session expired")', async () => {
    stub({ status: 'ok', msg: '', data: [] })
    await StoreApi.list('acme')
    expect(lastUrl).toBe(`${ORIGIN}/cloud/v1/get-stores?owner=acme`)
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
