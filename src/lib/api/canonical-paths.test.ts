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
import { PlansApi } from './plans'
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

// CTO contract: EVERY cloud API path is `/v1/`-rooted with ZERO prefix (no `/cloud/`,
// no `/api/`). The bearer-scoped cloud heads — gpus/clusters (compute), functions,
// platform (paas), s3, framework, provisioning (sql/vector/kv/datastore/docdb/search),
// the casibase STORE-ADMIN heads (get-stores/…), and machines — all authorize on the
// Bearer owner claim and reject a cookie-only browser call ("X-Org-Id required" /
// "valid principal required" / a FALSE "session expired"). So the browser calls the
// canonical, prefix-free `<origin>/v1/<head>`, which terminates at the console's OWN
// `app/v1/[...path]` bearer BFF: it mints a short-lived user token from the session and
// forwards to cloud-api `/v1/*` with the org resolved from the token owner. This block
// PINS the prefix-free contract so a regression can't re-introduce a `/cloud/` prefix.
describe('cloud heads → the same-origin /v1 bearer BFF (prefix-free, ZERO /cloud)', () => {
  it('ComputeApi.gpus (inventory) -> /v1/gpus', async () => {
    stub({ gpus: [] })
    await ComputeApi.gpus()
    expect(lastUrl).toBe(`${ORIGIN}/v1/gpus`)
  })
  it('PlatformApi.listClusters -> /v1/clusters', async () => {
    stub({ clusters: [] })
    await PlatformApi.listClusters()
    expect(lastUrl).toBe(`${ORIGIN}/v1/clusters`)
  })
  it('FunctionsApi.list -> /v1/functions', async () => {
    stub({ functions: [] })
    await FunctionsApi.list()
    expect(lastUrl).toBe(`${ORIGIN}/v1/functions`)
  })
  it('PaasApi.listProjects -> /v1/platform/projects', async () => {
    stub({ projects: [] })
    await PaasApi.listProjects()
    expect(lastUrl).toBe(`${ORIGIN}/v1/platform/projects`)
  })
  it('StorageApi.buckets -> /v1/s3/buckets', async () => {
    stub({ buckets: [] })
    await StorageApi.buckets()
    expect(lastUrl).toBe(`${ORIGIN}/v1/s3/buckets`)
  })
  it('FrameworkApi.doctypes.list -> /v1/framework/doctypes', async () => {
    stub({ data: [] })
    await FrameworkApi.doctypes.list()
    expect(lastUrl).toBe(`${ORIGIN}/v1/framework/doctypes`)
  })
  it('ProvisioningApi.list(vector) -> /v1/vector', async () => {
    stub([])
    await ProvisioningApi.list('vector')
    expect(lastUrl).toBe(`${ORIGIN}/v1/vector`)
  })
  it('ProvisioningApi.list(sql) -> /v1/sql', async () => {
    stub([])
    await ProvisioningApi.list('sql')
    expect(lastUrl).toBe(`${ORIGIN}/v1/sql`)
  })
  it('StoreApi.list (embeddings collections) -> /v1/get-stores', async () => {
    stub({ status: 'ok', msg: '', data: [] })
    await StoreApi.list('acme')
    expect(lastUrl).toBe(`${ORIGIN}/v1/get-stores?owner=acme`)
  })
  it('VisorApi.machines -> /v1/machines (bearer-scoped)', async () => {
    stub({ machines: [] })
    await VisorApi.machines()
    expect(lastUrl).toBe(`${ORIGIN}/v1/machines`)
  })
  it('none of the cloud heads emits a /<svc>/v1/ prefix', async () => {
    const bad = /\/(cloud|vm|ai|billing|org|commerce)\/v1\//
    stub({ gpus: [] })
    await ComputeApi.gpus()
    expect(lastUrl).not.toMatch(bad)
    stub({ buckets: [] })
    await StorageApi.buckets()
    expect(lastUrl).not.toMatch(bad)
    stub({ machines: [] })
    await VisorApi.machines()
    expect(lastUrl).not.toMatch(bad)
  })
  // o11y is IAM-gated (403 "no validated principal" for a bearer-less call) and the
  // canonical surface is VERSION-LESS (`/v1/o11y/<resource>`, NO nested v1/v3, NO /api),
  // so the ApmApi client rides the same-origin `/v1` bearer BFF like the rest — a
  // logged-in session's minted bearer passes, and the path carries no nested version.
  it('ApmApi.dashboards -> /v1/o11y/dashboards (version-less, /v1 bearer BFF — NOT /cloud, NOT nested /v1/o11y/v1/...)', async () => {
    stub([])
    await ApmApi.dashboards()
    expect(lastUrl).toBe(`${ORIGIN}/v1/o11y/dashboards`)
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
// `/v1/<resource>` through `originV1Url`. plans/embeddings (AI gateway) are served on
// the session path (the gateway forwards the session and cloud resolves the org from
// the session owner), so a bare `/v1/*` works — VERIFIED LIVE.
// (functions + paas + apm/o11y are pinned in the /v1 bearer BFF block above — they are
// header/IAM-scoped and 403 on the bare path. o11y is additionally VERSION-LESS.)
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
  // Functions + PaaS + apm/o11y are NOT bare session clients — they ride the /v1 bearer
  // BFF (pinned in the "cloud heads → the same-origin /v1 bearer BFF" block above) and
  // 403 on a cookie-only call. Commerce is NOT a bare-/v1/ client either — it addresses
  // the `/commerce` proxy EXPLICITLY (pinned in the proxy-exceptions block below). The
  // live ingress does not rewrite their heads.

  it('the (bare-/v1/) session-path clients emit no /<svc>/v1/ prefix', async () => {
    const bad = /\/(cloud|vm|ai|billing|org|commerce)\/v1\//
    stub({ plans: [] })
    await fetchPlans()
    expect(lastUrl).not.toMatch(bad)
    stub({})
    await EmbeddingsApi.generate('m', 'x')
    expect(lastUrl).not.toMatch(bad)
  })
})

// The REMAINING prefix exceptions address a DIFFERENT backend than cloud-api, so they
// are NOT `/v1/`-rooted: billing + PlansApi (money-truth) ride the per-tenant
// `/billing/v1/*` SERVICE-token proxy (`billingProxyV1Url`); the store/merchant admin
// rides the `/commerce/v1/*` user-bearer proxy (`commerceProxyV1Url`); the visor compute
// CATALOG (regions/sizes/accelerators) rides `/vm/v1/*` (visor serves no cloud-api route,
// and its `gpus` catalog is DISTINCT from the cloud GPU inventory). Each is served by its
// OWN Next route handler; this block PINS the exception so a "canonicalization" can't
// repoint them at a cloud-api `/v1/<head>` that would 404 (wrong backend).
describe('prefix exceptions — billing via /billing/v1, commerce via /commerce/v1, visor catalog via /vm/v1', () => {
  it('BillingApi.balance -> /billing/v1/balance', async () => {
    stub({ balance: 0, holds: 0, available: 0 })
    await BillingApi.balance()
    expect(lastUrl).toBe(`${ORIGIN}/billing/v1/balance?currency=usd`)
  })

  it('PlansApi.plans -> /billing/v1/plans (money-truth catalog)', async () => {
    stub([])
    await PlansApi.plans()
    expect(lastUrl).toBe(`${ORIGIN}/billing/v1/plans`)
  })

  it('CommerceApi.currentStore -> /commerce/v1/store/current', async () => {
    stub({ store: {} })
    await CommerceApi.currentStore()
    expect(lastUrl).toBe(`${ORIGIN}/commerce/v1/store/current`)
  })

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
})
