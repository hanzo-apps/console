/**
 * Visor — the CUSTOMER compute surface (a tenant's own machines).
 *
 * TWO transports, one file, cleanly split — each addresses the RIGHT backend:
 *  - Machines INVENTORY + lifecycle (list / launch / quote / terminate) authorize on the
 *    Bearer owner and 403 a cookie-only call, so they go through the canonical, prefix-free
 *    same-origin `/v1/visor/machines*` — the `app/v1/[...path]/route.ts` bearer BFF mints a
 *    short-lived user token and forwards to cloud-api (org resolved from the Bearer
 *    owner). This is the visor-backed native cloud surface. Launch is a POST on the
 *    collection itself: cloud answers it at `/v1/visor/machines`, and `/machines/launch`
 *    is visor's OWN upstream spelling, one segment away and not ours to call.
 *  - The public compute CATALOG (regions / CPU sizes / GPU accelerators, un-scoped)
 *    reads visor DIRECTLY through the `/v1/vm` proxy (`app/v1/vm/[...path]/route.ts` → visor)
 *    at `/v1/vm/{regions,sizes,gpus}`. Visor's `/v1/gpus` is the accelerator CATALOG
 *    (models + VRAM + price); cloud-api's `/v1/visor/gpus` is the GPU INVENTORY surface (a
 *    different, per-org shape) — so the catalog MUST read visor, never cloud-api.
 *
 * This is deliberately NOT the `/paas` platform control plane (a god-mode SERVICE
 * token, admin-only). Compute is a TENANT action: any signed-in org user may list +
 * launch their OWN machines with just their session cookie — never the infra token,
 * never the infra "not configured" message.
 *
 * Honest by construction: every field is normalized defensively (an upstream field
 * rename degrades a cell to `—`, never throws), an empty list is a real "no
 * machines yet" state, and a not-routed/unavailable upstream degrades to a
 * customer-appropriate "managed compute" state — NOT an infra error.
 */
import { restGet, restPost, restDelete, ApiError, cloudProxyV1Url, vmProxyV1Url } from './client'

const enc = encodeURIComponent

/** One customer machine as visor reports it. Missing fields render `—`. */
export type VisorMachine = {
  id: string
  name?: string
  region?: string
  /** Machine size / type slug (e.g. `s-2vcpu-4gb`, `gpu-h100x1-80gb`). */
  type?: string
  /**
   * Where this machine lives, as the unioned inventory reports it:
   * `visor`/`doks` (Hanzo Cloud) or `byo` (a bring-your-own fleet worker /
   * on-prem node). Absent on older responses; drives the cloud-vs-BYO badge.
   */
  provider?: string
  /** Lifecycle string (e.g. `active`, `running`, `provisioning`, `off`). */
  status?: string
  vcpu?: number
  memGb?: number
  /** Accelerator model if this is a GPU machine (e.g. `H100`). */
  gpu?: string
  /** Public IPv4, if any. */
  ip?: string
  createdAt?: string
  /** Hourly price in USD, if visor reports it. */
  costHourlyUsd?: number
  /** Operating system, when reported (a BYO box reports it from the connecting host). */
  os?: string
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v)
    ? v
    : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))
      ? Number(v)
      : undefined

/** Pull the first array found under any common envelope key (else `[]`). */
function arrayUnder(payload: unknown, keys: string[]): unknown[] {
  if (Array.isArray(payload)) return payload
  const o = rec(payload)
  for (const k of keys) if (Array.isArray(o[k])) return o[k] as unknown[]
  return []
}

export function normalizeMachine(raw: unknown, i = 0): VisorMachine {
  const r = rec(raw)
  const id = str(r.id) ?? str(r.uuid) ?? str(r.machineId) ?? str(r.name) ?? `machine-${i}`
  const gpu = r.gpu ?? r.gpus ?? r.accelerator
  return {
    id,
    name: str(r.name) ?? str(r.hostname) ?? str(r.label) ?? id,
    region: str(r.region) ?? str(r.zone) ?? str(r.datacenter) ?? str(r.location),
    type: str(r.type) ?? str(r.size) ?? str(r.machineType) ?? str(r.slug) ?? str(r.plan),
    provider: str(r.provider) ?? str(r.origin) ?? str(r.source),
    status: str(r.status) ?? str(r.state) ?? str(r.phase),
    vcpu: num(r.vcpu) ?? num(r.vcpus) ?? num(r.cpu) ?? num(r.cores),
    memGb: num(r.memGb) ?? num(r.memoryGb) ?? num(r.ramGb) ?? num(r.memory),
    gpu: str(gpu) ?? str(rec(gpu).model) ?? (num(rec(gpu).count) ? str(rec(gpu).type) : undefined),
    ip: str(r.ip) ?? str(r.publicIp) ?? str(r.ipv4) ?? str(r.address),
    createdAt: str(r.createdAt) ?? str(r.created) ?? str(r.createdTime) ?? str(r.created_at),
    costHourlyUsd: num(r.costHourlyUsd) ?? num(r.costHourly) ?? num(r.priceHourly) ?? num(r.hourly),
    os: str(r.os) ?? str(r.operatingSystem) ?? str(r.image),
  }
}

/** What a customer compute view should show, derived from an upstream failure. */
export type VisorErrorKind = 'unauthorized' | 'forbidden' | 'error'
export type VisorError = { kind: VisorErrorKind; message: string }

/**
 * Map an upstream failure to a CUSTOMER-appropriate LOAD state — never the empty
 * "launch your first machine" state, which is reserved for a real 200-with-zero-
 * items (an error masquerading as "you have none" is a lie, however friendly). A
 * 401 is a sign-in prompt; a 403 is an honest permission state; any other non-200
 * (404 not-routed, 5xx, network) is an honest transient error the caller retries.
 * None leak infra-token jargon (that is only ever an admin concern).
 */
export function interpretVisorError(e: unknown): VisorError {
  const status = e instanceof ApiError ? e.status : undefined
  if (status === 401) return { kind: 'unauthorized', message: 'Sign in to view your machines.' }
  if (status === 403)
    return {
      kind: 'forbidden',
      message: 'Your account does not have access to Machines. Ask an organization admin to enable dedicated compute.',
    }
  return {
    kind: 'error',
    message: 'Could not load your machines — a temporary error, not an empty list. Try again in a moment.',
  }
}

// ── Compute catalog (regions / sizes / GPUs) — the REAL DO offer, per visor ────
//
// These are the PUBLIC catalog endpoints (`GET /v1/regions|sizes|gpus`, 200 for any
// signed-in user; visor's authz allows them un-scoped). They power the customer
// "launch" surface: real regions, real machine sizes with pricing, and the real GPU
// accelerator catalog with hourly/monthly price — so Machines/GPUs render the actual
// offer even before the org owns a single machine (never a blank state, never a fake).

/** One region visor offers, with a count of the sizes available there. */
export type VisorRegion = { slug: string; name?: string; available: boolean; sizeCount: number }
/** One standard (CPU) machine size with its real price. */
export type VisorSize = {
  slug: string
  vcpus?: number
  memGb?: number
  diskGb?: number
  available: boolean
  priceHourly?: number
  priceMonthly?: number
  /** Region slugs this size can launch in (from the catalog); `[]` when the upstream omits it. */
  regions: string[]
}
/** One GPU machine size — the accelerator model/count + VRAM + real price. */
export type VisorGpuSize = VisorSize & { model?: string; gpuCount?: number; vramGb?: number }

const bool = (v: unknown): boolean => v === true || v === 'true' || v === 1

/** `nvidia_rtx4000_ada` / `nvidia_l40s` / `nvidia_h100` → `RTX 4000 Ada` / `L40S` / `H100`. */
export function prettyGpuModel(model?: string): string | undefined {
  const m = str(model)
  if (!m) return undefined
  const base = m.replace(/^nvidia[_-]?/i, '')
  return base
    .split(/[_\s]+/)
    .map((tok) => {
      const rtx = /^rtx(\d*)$/i.exec(tok) // `rtx4000` → `RTX 4000`, `rtx` → `RTX`
      if (rtx) return rtx[1] ? `RTX ${rtx[1]}` : 'RTX'
      if (/^ada$/i.test(tok)) return 'Ada'
      // A model token that carries a number (l40s, h100, a100) is an all-caps SKU;
      // a plain word (e.g. a family name) is title-cased.
      return /\d/.test(tok) ? tok.toUpperCase() : tok.charAt(0).toUpperCase() + tok.slice(1)
    })
    .join(' ')
}

const mbToGb = (mb?: number): number | undefined => (mb == null ? undefined : Math.round((mb / 1024) * 10) / 10)

export function normalizeRegion(raw: unknown): VisorRegion {
  const r = rec(raw)
  const sizes = r.sizes
  return {
    slug: str(r.slug) ?? str(r.id) ?? str(r.name) ?? '—',
    name: str(r.name) ?? str(r.label),
    available: bool(r.available),
    sizeCount: Array.isArray(sizes) ? sizes.length : 0,
  }
}

export function normalizeSize(raw: unknown): VisorSize {
  const r = rec(raw)
  const regions = Array.isArray(r.regions) ? (r.regions as unknown[]).filter((x): x is string => typeof x === 'string') : []
  return {
    slug: str(r.slug) ?? str(r.id) ?? '—',
    vcpus: num(r.vcpus) ?? num(r.vcpu) ?? num(r.cpu),
    memGb: mbToGb(num(r.memoryMb)) ?? num(r.memoryGb) ?? num(r.memGb),
    diskGb: num(r.diskGb) ?? num(r.disk),
    available: bool(r.available),
    priceHourly: num(r.priceHourly) ?? num(r.hourly),
    priceMonthly: num(r.priceMonthly) ?? num(r.monthly),
    regions,
  }
}

export function normalizeGpuSize(raw: unknown): VisorGpuSize {
  const base = normalizeSize(raw)
  const gpu = rec(rec(raw).gpu)
  const vram = num(gpu.vram)
  const unit = (str(gpu.vramUnit) ?? 'gib').toLowerCase()
  return {
    ...base,
    model: prettyGpuModel(str(gpu.model)) ?? str(gpu.model),
    gpuCount: num(gpu.count),
    vramGb: vram != null ? (unit.startsWith('m') ? Math.round(vram / 1024) : vram) : undefined,
  }
}

/**
 * Filter a size catalog by a free-text query (matched against the slug) AND an
 * optional region slug. A size is kept when it lists that region — OR when its
 * region list is empty/unknown (never hide a launchable size just because the
 * catalog didn't report its regions). Pure; the launch surfaces + tests share it.
 */
export function filterSizes<T extends VisorSize>(sizes: T[], query: string, region?: string): T[] {
  const q = query.trim().toLowerCase()
  return sizes.filter((s) => {
    if (q && !s.slug.toLowerCase().includes(q)) return false
    if (region && s.regions.length > 0 && !s.regions.includes(region)) return false
    return true
  })
}

/** What the user launches — a size/GPU slug in a region, with a name. */
export type LaunchInput = { size: string; region: string; name: string }

/** The resale price quote for a launch (OUR market price — same as the catalog). */
export type LaunchQuote = {
  size: string
  region: string
  currency?: string
  priceHourly?: number
  priceMonthly?: number
  gpu?: { count?: number; model?: string; vramGb?: number }
}

/** Unwrap the casibase `{status,msg,data}` envelope; throw the honest msg on `status:error`. */
function unwrapEnvelope(r: unknown): Record<string, unknown> {
  const o = rec(r)
  if (o.status === 'error') throw new ApiError(str(o.msg) || 'Request failed')
  return rec(o.data ?? o)
}

export const VisorApi = {
  /** The signed-in org's own machines (`/v1/visor/machines`, org-scoped by the Bearer owner). */
  machines: async (): Promise<VisorMachine[]> => {
    const r = await restGet<unknown>(cloudProxyV1Url('visor/machines'))
    return arrayUnder(r, ['machines', 'instances', 'data', 'items', 'rows', 'droplets']).map((m, i) => normalizeMachine(m, i))
  },

  /** The real region catalog (`/v1/vm/regions` → visor). */
  regions: async (): Promise<VisorRegion[]> => {
    const r = await restGet<unknown>(vmProxyV1Url('regions'))
    return arrayUnder(r, ['regions', 'data', 'items', 'rows']).map(normalizeRegion)
  },

  /** The real standard (CPU) size catalog with pricing (`/v1/vm/sizes` → visor). */
  sizes: async (): Promise<VisorSize[]> => {
    const r = await restGet<unknown>(vmProxyV1Url('sizes'))
    return arrayUnder(r, ['sizes', 'data', 'items', 'rows']).map(normalizeSize)
  },

  /** The real GPU accelerator catalog with pricing (`/v1/vm/gpus` → visor). */
  gpus: async (): Promise<VisorGpuSize[]> => {
    const r = await restGet<unknown>(vmProxyV1Url('gpus'))
    return arrayUnder(r, ['gpus', 'data', 'items', 'rows']).map(normalizeGpuSize)
  },

  /**
   * The authoritative launch QUOTE for a size in a region (`POST /v1/visor/machines`
   * with `dryRun:true` — NO spend). Returns OUR market price (visor `HanzoPrice`), the
   * SAME figure the real launch charges and the catalog shows (one pricing source).
   */
  quote: async (input: LaunchInput): Promise<LaunchQuote> => {
    const r = await restPost<unknown>(cloudProxyV1Url('visor/machines'), {
      size: input.size, instanceType: input.size, region: input.region, name: input.name || 'quote', dryRun: true,
    })
    const d = unwrapEnvelope(r)
    const g = rec(d.gpu)
    return {
      size: str(d.size) ?? input.size,
      region: str(d.region) ?? input.region,
      currency: str(d.currency),
      priceHourly: num(d.priceHourly),
      priceMonthly: num(d.priceMonthly),
      gpu: Object.keys(g).length ? { count: num(g.count), model: prettyGpuModel(str(g.model)) ?? str(g.model), vramGb: num(g.vram) } : undefined,
    }
  },

  /** Launch a metered, per-org machine (`POST /v1/visor/machines`, dryRun:false).
   *  A CPU machine is metered to the org's Hanzo balance; a GPU launch is prepay-only,
   *  card-funded, with a 24-hour minimum charged upfront (see `LaunchDrawer` — the GPU
   *  gate is card-on-file + sufficient prepaid balance). A 402 (or "insufficient
   *  balance"/"payment method required") surfaces honestly — never a fabricated success. */
  launch: async (input: LaunchInput): Promise<VisorMachine> => {
    const r = await restPost<unknown>(cloudProxyV1Url('visor/machines'), {
      size: input.size, instanceType: input.size, region: input.region, name: input.name, dryRun: false,
    })
    return normalizeMachine(unwrapEnvelope(r))
  },

  /** Terminate (destroy) a machine (`DELETE /v1/visor/machines/:id`). Stops metering; the
   *  backend authorizes the delete against the Bearer owner's org. Resolves on 2xx/204. */
  terminate: (id: string): Promise<void> => restDelete(cloudProxyV1Url(`visor/machines/${enc(id)}`)),
}

// ── Formatters (cells) ───────────────────────────────────────────────────────

export const DASH = '—'
export const fmtSpec = (m: VisorMachine): string =>
  m.vcpu != null && m.memGb != null ? `${m.vcpu} vCPU · ${m.memGb} GB` : m.vcpu != null ? `${m.vcpu} vCPU` : DASH
export const fmtHourly = (n?: number): string => (n == null ? DASH : `$${n.toFixed(2)}/hr`)
export const fmtMonthly = (n?: number): string => (n == null ? DASH : `$${Math.round(n * 730).toLocaleString()}/mo`)

/** Coarse status → a health verdict for a pill (green/yellow/red/neutral). PURE. */
export function statusVerdict(status?: string): 'ok' | 'warn' | 'down' | 'idle' {
  const s = (status ?? '').toLowerCase()
  if (['active', 'running', 'online', 'ready', 'up'].includes(s)) return 'ok'
  if (['provisioning', 'pending', 'starting', 'rebooting', 'busy'].includes(s)) return 'warn'
  if (['off', 'stopped', 'terminated', 'error', 'failed', 'offline', 'down'].includes(s)) return 'down'
  return 'idle'
}
