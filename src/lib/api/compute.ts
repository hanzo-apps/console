/**
 * Compute (GPU) API — the accelerator surface for the console.
 *
 * Hanzo Cloud compute is a RESALE/markup layer over DigitalOcean (primary — DO GPU
 * Droplets + Paperspace for H100/A100) and AWS (secondary GPU instances), metered
 * hourly to commerce. There is NOT yet a `compute-provider` (DO/AWS) connector, so
 * this client wires to what is REAL today and degrades HONESTLY everywhere else — it
 * never fabricates GPUs, telemetry, or spend. Every surface is a real backend call
 * or an honest not-configured / unavailable / empty state.
 *
 * THREE real sources, in honest priority:
 *  1. GPU inventory — `GET /v1/gpus` (the unified cloud binary, via the same-origin
 *     user-bearer `/v1` proxy → cloud-api /v1/gpus, org resolved from the Bearer
 *     owner). Per-GPU rows + live telemetry (`/v1/gpus/alerts`, `/v1/gpus/pools`).
 *     A not-yet-served route (404) → the caller renders the honest not-configured /
 *     unavailable card, never an empty grid.
 *  2. Cluster inventory — `PlatformApi.listClusters()` (the org's DOKS). GPU-bearing
 *     clusters are detected from the node-size slug; per-model GPU COUNTS are derived
 *     from real `nodeCount × GPUs-per-node`. Counts/clusters only — NEVER synthetic
 *     per-GPU rows (we have no UUIDs/temps for a node we only know the size of).
 *  3. Usage ledger — `GET /v1/ops/usages/cloud` (the read API over the ZAP-written
 *     `hanzo.cloud_usage` ledger: timestamp/org/model/provider/tokens/cost_cents).
 *     Powers cost. Not yet registered on the backend → 404 → the caller degrades to
 *     the commerce usage total (`BillingApi.usage`) and finally to `—`.
 *
 * Per-GPU telemetry time-series (utilization-over-time, temps), pools, and alerts
 * stay honestly empty until a provider/agent connects them upstream. ALL calls are
 * org-scoped server-side: `/v1/gpus*` by the minted Bearer's owner claim, and the
 * `/v1` usage ledger by the `X-Org-Id` (`currentOrg()`) `client.ts` stamps.
 *
 * Reuses (does NOT duplicate) `PlatformApi.listClusters` / `clustersFromApps` from
 * `./platform` — this file adds the GPU read surface + the pure derivation/format
 * helpers, kept here (not braided into `platform.ts`) so the concurrent Machines work
 * on `platform.ts` and this stay orthogonal.
 */
import { cloudGet, restGet, cloudProxyV1Url } from './client'
import type { Cluster } from './platform'

// ── Wire types ───────────────────────────────────────────────────────────────

/**
 * One GPU as the platform inventory reports it. Fields the platform omits are
 * optional; the UI renders what is present and never invents the rest. Telemetry
 * (utilization/memory/temperature/power) is numeric percent / °C / watts.
 */
export type Gpu = {
  id: string
  uuid?: string
  name?: string
  /** Accelerator model, e.g. `H100`, `A100`, `RTX 4090`, `L40S`, `GB10`. */
  model?: string
  cluster?: string
  region?: string
  /**
   * Where this GPU lives, as the unioned inventory reports it: `visor`/`doks`
   * (Hanzo Cloud) or `byo` (a bring-your-own worker / on-prem node, e.g. a
   * DGX Spark GB10). Absent on older responses; drives the cloud-vs-BYO badge.
   */
  provider?: string
  /** Lifecycle/health string, e.g. `online`, `offline`, `degraded`. */
  status?: string
  health?: string
  /** Live utilization %, 0–100. Absent = no telemetry (renders `—`, never 0). */
  utilization?: number
  /** Live memory utilization %, 0–100. */
  memoryUtil?: number
  /** Total accelerator memory, GB. */
  memoryTotalGb?: number
  /** Core temperature, °C. */
  temperature?: number
  /** Board power draw, watts. */
  power?: number
  /** Uptime in seconds. */
  uptimeSeconds?: number
  /** Human location, e.g. `sfo3` / datacenter. */
  location?: string
}

/** A GPU alert as the platform reports it (high-temp / offline / driver-update / backup). */
export type GpuAlert = {
  id: string
  severity?: string
  kind?: string
  message?: string
  gpu?: string
  cluster?: string
  at?: string
}

/** A scheduling pool grouping GPU capacity. */
export type GpuPool = {
  id: string
  name?: string
  model?: string
  size?: number
  available?: number
  status?: string
}

/** One day of metered spend (from the usage ledger). */
export type LedgerDay = { day: string; cents: number }
/** One grouped line of metered spend (by model or provider). */
export type LedgerLine = { label: string; cents: number; tokens?: number; units?: number }
/** Aggregated usage over a window — total + a daily series + breakdowns. */
export type UsageLedger = {
  totalCents: number
  start?: string
  end?: string
  daily: LedgerDay[]
  byModel: LedgerLine[]
  byProvider: LedgerLine[]
}

// ── Defensive normalizers (a field rename upstream degrades a cell, never throws) ──

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v)
    ? v
    : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))
      ? Number(v)
      : undefined
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})

/**
 * GB from a numeric value OR a unit-suffixed string. On-prem/BYO agents report
 * a GPU's memory as a plain string (`"128GB"`, `"80 GiB"`, `"131072MB"`) rather
 * than the numeric `memoryTotalGb` DOKS inventory carries — this tolerates both
 * so a bring-your-own GPU shows its VRAM instead of `—`. Returns `undefined` for
 * anything unparseable (never a fabricated 0). PURE.
 */
export const gbOf = (v: unknown): number | undefined => {
  const n = num(v)
  if (n !== undefined) return n
  const s = str(v)
  if (!s) return undefined
  const m = /([\d.]+)\s*(tib|tb|t|gib|gb|g|mib|mb|m)?/i.exec(s.trim())
  if (!m) return undefined
  const val = Number(m[1])
  if (!Number.isFinite(val)) return undefined
  const unit = (m[2] ?? 'g').toLowerCase()
  if (unit.startsWith('t')) return Math.round(val * 1024)
  if (unit.startsWith('m')) return Math.round(val / 1024)
  return val
}

/** Pull the first array found under any of the common envelope keys (else `[]`). */
const arrayUnder = (payload: unknown, keys: string[]): Record<string, unknown>[] => {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[]
  const o = rec(payload)
  for (const k of keys) {
    if (Array.isArray(o[k])) return o[k] as Record<string, unknown>[]
  }
  return []
}

/** Cents from a record that may report `cost_cents`/`costCents`, or a dollar `cost`. */
const centsOf = (r: Record<string, unknown>): number => {
  const c = num(r.cost_cents) ?? num(r.costCents) ?? num(r.cents) ?? num(r.amountCents)
  if (c !== undefined) return Math.round(c)
  const dollars = num(r.cost) ?? num(r.amount) ?? num(r.total)
  return dollars !== undefined ? Math.round(dollars * 100) : 0
}

export function normalizeGpu(raw: unknown): Gpu {
  const r = rec(raw)
  const id = str(r.id) ?? str(r.uuid) ?? str(r.name) ?? str(r.serial) ?? 'gpu'
  return {
    id,
    uuid: str(r.uuid) ?? str(r.gpuUuid) ?? str(r.serial),
    name: str(r.name) ?? str(r.hostname) ?? str(r.node),
    model: str(r.model) ?? str(r.gpuModel) ?? str(r.product) ?? str(r.type),
    cluster: str(r.cluster) ?? str(r.clusterName) ?? str(r.node) ?? str(r.nodeName),
    region: str(r.region) ?? str(r.zone),
    provider: str(r.provider) ?? str(r.origin) ?? str(r.source),
    status: str(r.status) ?? str(r.state),
    health: str(r.health),
    utilization: num(r.utilization) ?? num(r.util) ?? num(r.gpuUtil) ?? num(r.gpuUtilization),
    memoryUtil: num(r.memoryUtil) ?? num(r.memUtil) ?? num(r.memoryUtilization),
    memoryTotalGb: num(r.memoryTotalGb) ?? num(r.memoryGb) ?? num(r.vramGb) ?? gbOf(r.memory) ?? gbOf(r.vram),
    temperature: num(r.temperature) ?? num(r.temp) ?? num(r.tempC),
    power: num(r.power) ?? num(r.powerW) ?? num(r.powerDraw),
    uptimeSeconds: num(r.uptimeSeconds) ?? num(r.uptime),
    location: str(r.location) ?? str(r.datacenter) ?? str(r.region) ?? str(r.zone),
  }
}

export function normalizeAlert(raw: unknown, i = 0): GpuAlert {
  const r = rec(raw)
  return {
    id: str(r.id) ?? str(r.alertId) ?? `alert-${i}`,
    severity: str(r.severity) ?? str(r.level),
    kind: str(r.kind) ?? str(r.type) ?? str(r.category),
    message: str(r.message) ?? str(r.msg) ?? str(r.description),
    gpu: str(r.gpu) ?? str(r.gpuId) ?? str(r.device),
    cluster: str(r.cluster) ?? str(r.clusterName),
    at: str(r.at) ?? str(r.timestamp) ?? str(r.createdAt) ?? str(r.time),
  }
}

export function normalizePool(raw: unknown, i = 0): GpuPool {
  const r = rec(raw)
  return {
    id: str(r.id) ?? str(r.name) ?? `pool-${i}`,
    name: str(r.name) ?? str(r.id),
    model: str(r.model) ?? str(r.gpuModel),
    size: num(r.size) ?? num(r.capacity) ?? num(r.total),
    available: num(r.available) ?? num(r.free),
    status: str(r.status) ?? str(r.state),
  }
}

/** ISO/epoch timestamp → `YYYY-MM-DD` day bucket (UTC), or '' if unparseable. */
function dayKey(ts: unknown): string {
  const s = str(ts)
  if (!s) return ''
  const d = new Date(/^\d+$/.test(s) ? Number(s) * (s.length <= 10 ? 1000 : 1) : s)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
}

/**
 * Normalize the usage ledger into total + daily series + breakdowns. Codes to the
 * documented `hanzo.cloud_usage` shape (rows of timestamp/model/provider/cost_cents/
 * total_tokens) but accepts a pre-aggregated `{ totalCents, daily, byModel }` too, so
 * whichever the read API ships, the UI does not change.
 */
export function normalizeLedger(payload: unknown): UsageLedger {
  const root = rec(payload)
  const rows = arrayUnder(payload, ['usages', 'rows', 'items', 'data', 'records'])

  // Pre-aggregated daily series, if the backend already grouped by day.
  const preDaily: LedgerDay[] = arrayUnder(root.daily, [])
    .map((d) => ({ day: str(d.day) ?? str(d.date) ?? '', cents: centsOf(d) }))
    .filter((d) => d.day)

  const dayMap = new Map<string, number>()
  const modelMap = new Map<string, { cents: number; tokens: number }>()
  const provMap = new Map<string, number>()
  let rowTotal = 0

  for (const r of rows) {
    const cents = centsOf(r)
    rowTotal += cents
    const day = dayKey(r.timestamp ?? r.day ?? r.date ?? r.time)
    if (day) dayMap.set(day, (dayMap.get(day) ?? 0) + cents)
    const model = str(r.model) ?? str(r.modelName) ?? 'Usage'
    const m = modelMap.get(model) ?? { cents: 0, tokens: 0 }
    m.cents += cents
    m.tokens += num(r.total_tokens) ?? num(r.totalTokens) ?? num(r.tokens) ?? 0
    modelMap.set(model, m)
    const prov = str(r.provider) ?? str(r.providerName)
    if (prov) provMap.set(prov, (provMap.get(prov) ?? 0) + cents)
  }

  const daily = (preDaily.length
    ? preDaily
    : [...dayMap.entries()].map(([day, cents]) => ({ day, cents }))
  ).sort((a, b) => a.day.localeCompare(b.day))

  const byModel: LedgerLine[] = [...modelMap.entries()]
    .map(([label, v]) => ({ label, cents: v.cents, tokens: v.tokens || undefined }))
    .sort((a, b) => b.cents - a.cents)
  const byProvider: LedgerLine[] = [...provMap.entries()]
    .map(([label, cents]) => ({ label, cents }))
    .sort((a, b) => b.cents - a.cents)

  const totalCents =
    num(root.totalCents) ??
    (num(root.total) !== undefined ? Math.round((num(root.total) as number) * 100) : undefined) ??
    (daily.length ? daily.reduce((a, d) => a + d.cents, 0) : rowTotal)

  return {
    totalCents,
    start: str(root.start) ?? str(root.periodStart),
    end: str(root.end) ?? str(root.periodEnd),
    daily,
    byModel,
    byProvider,
  }
}

// ── GPU node-size derivation (real counts from a real cluster's node slug) ────

const DO_MODELS: Record<string, string> = {
  h100: 'H100', h200: 'H200', l40s: 'L40S', l40: 'L40', a100: 'A100', a6000: 'A6000',
  a5000: 'A5000', a4000: 'A4000', rtx6000: 'RTX 6000', rtx4000: 'RTX 4000', mi300: 'MI300X',
  mi300x: 'MI300X',
}

/** AWS GPU instance families → accelerator model + GPUs per instance. Common subset. */
const AWS_INSTANCES: Record<string, { model: string; perNode: number }> = {
  'p5.48xlarge': { model: 'H100', perNode: 8 },
  'p5e.48xlarge': { model: 'H200', perNode: 8 },
  'p4d.24xlarge': { model: 'A100', perNode: 8 },
  'p4de.24xlarge': { model: 'A100', perNode: 8 },
  'p3.2xlarge': { model: 'V100', perNode: 1 },
  'p3.8xlarge': { model: 'V100', perNode: 4 },
  'p3.16xlarge': { model: 'V100', perNode: 8 },
  'g5.xlarge': { model: 'A10G', perNode: 1 },
  'g5.12xlarge': { model: 'A10G', perNode: 4 },
  'g5.48xlarge': { model: 'A10G', perNode: 8 },
  'g6.xlarge': { model: 'L4', perNode: 1 },
  'g6e.xlarge': { model: 'L40S', perNode: 1 },
}

const titleModel = (token: string): string =>
  DO_MODELS[token] ?? token.replace(/^rtx/, 'RTX ').toUpperCase()

/**
 * Parse a node-size slug into its GPU model + GPUs-per-node, or `null` for a non-GPU
 * slug. Handles DigitalOcean GPU Droplet slugs (`gpu-h100x8-640gb`, `gpu-l40sx1-48gb`)
 * and common AWS GPU instance families (`p5.48xlarge`, `p4d.24xlarge`, `g5.12xlarge`).
 * PURE — no I/O.
 */
export function gpuSpecOf(slug?: string | null): { model: string; perNode: number } | null {
  const s = (slug ?? '').trim().toLowerCase()
  if (!s) return null
  // DigitalOcean: gpu-<model>x<count>-<mem...>
  const doMatch = /^gpu-(.+?)x(\d+)(?:-|$)/.exec(s)
  if (doMatch) {
    const perNode = Number(doMatch[2])
    if (perNode > 0) return { model: titleModel(doMatch[1]), perNode }
  }
  // AWS: exact family match.
  if (AWS_INSTANCES[s]) return AWS_INSTANCES[s]
  return null
}

/** A cluster known to carry GPUs, with the real per-model count derived from its size. */
export type GpuCluster = {
  cluster: Cluster
  model: string
  perNode: number
  /** Real total GPUs in the cluster = perNode × nodeCount (defaults nodeCount=1). */
  gpuCount: number
}

/** The GPU-bearing clusters out of a cluster list (real derivation, PURE). */
export function gpuClustersOf(clusters: Cluster[]): GpuCluster[] {
  const out: GpuCluster[] = []
  for (const c of clusters) {
    const spec = gpuSpecOf(c.nodeSize)
    if (!spec) continue
    const nodes = c.nodeCount && c.nodeCount > 0 ? c.nodeCount : 1
    out.push({ cluster: c, model: spec.model, perNode: spec.perNode, gpuCount: spec.perNode * nodes })
  }
  return out
}

/** Total GPUs across the GPU clusters (real sum, PURE). */
export const totalDerivedGpus = (gcs: GpuCluster[]): number => gcs.reduce((a, g) => a + g.gpuCount, 0)

// ── Aggregate summary (overview metric cards) ────────────────────────────────

export type GpuSummary = {
  /** Total GPUs, or `null` when neither inventory nor GPU clusters are known. */
  total: number | null
  /** Online GPUs (telemetry only — `null` when derived from cluster counts). */
  online: number | null
  /** Mean utilization % over GPUs that report it, or `null` (no telemetry). */
  utilAvg: number | null
  /** Mean memory utilization %, or `null`. */
  memUtilAvg: number | null
  /** GPU count by model (real — from inventory if present, else cluster derivation). */
  byModel: { model: string; count: number }[]
  /** Where the numbers came from — drives the honest "source" caption. */
  source: 'inventory' | 'clusters' | 'none'
}

const ONLINE = new Set(['online', 'ready', 'active', 'running', 'available', 'ok', 'up'])

const mean = (xs: number[]): number | null =>
  xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null

/**
 * Fold inventory + GPU clusters into the overview summary. Inventory wins (it carries
 * telemetry + per-GPU rows); otherwise real cluster counts fill total + byModel and
 * telemetry stays `null` (honest `—`). PURE.
 */
export function summarize(invReady: boolean, gpus: Gpu[], gcs: GpuCluster[]): GpuSummary {
  if (invReady && gpus.length) {
    const byModelMap = new Map<string, number>()
    for (const g of gpus) byModelMap.set(g.model ?? 'Unknown', (byModelMap.get(g.model ?? 'Unknown') ?? 0) + 1)
    return {
      total: gpus.length,
      online: gpus.filter((g) => ONLINE.has((g.status ?? '').toLowerCase())).length,
      utilAvg: mean(gpus.map((g) => g.utilization).filter((n): n is number => typeof n === 'number')),
      memUtilAvg: mean(gpus.map((g) => g.memoryUtil).filter((n): n is number => typeof n === 'number')),
      byModel: [...byModelMap.entries()].map(([model, count]) => ({ model, count })).sort((a, b) => b.count - a.count),
      source: 'inventory',
    }
  }
  if (gcs.length) {
    const byModelMap = new Map<string, number>()
    for (const g of gcs) byModelMap.set(g.model, (byModelMap.get(g.model) ?? 0) + g.gpuCount)
    return {
      total: totalDerivedGpus(gcs),
      online: null,
      utilAvg: null,
      memUtilAvg: null,
      byModel: [...byModelMap.entries()].map(([model, count]) => ({ model, count })).sort((a, b) => b.count - a.count),
      source: 'clusters',
    }
  }
  return { total: null, online: null, utilAvg: null, memUtilAvg: null, byModel: [], source: 'none' }
}

// ── Filtering / pagination (GPU table) ───────────────────────────────────────

export type GpuFilter = { q: string; cluster: string; model: string; status: string; location: string }
export const emptyFilter: GpuFilter = { q: '', cluster: '', model: '', status: '', location: '' }

/** Distinct, sorted non-empty values of a GPU field (for the filter dropdowns). PURE. */
export function uniqueValues(gpus: Gpu[], key: 'cluster' | 'model' | 'status' | 'location'): string[] {
  return [...new Set(gpus.map((g) => g[key]).filter((v): v is string => !!v))].sort()
}

/** Apply the search + facet filters to the GPU rows. PURE. */
export function filterGpus(gpus: Gpu[], f: GpuFilter): Gpu[] {
  const q = f.q.trim().toLowerCase()
  return gpus.filter((g) => {
    if (f.cluster && g.cluster !== f.cluster) return false
    if (f.model && g.model !== f.model) return false
    if (f.status && g.status !== f.status) return false
    if (f.location && g.location !== f.location) return false
    if (q) {
      const hay = `${g.name ?? ''} ${g.id} ${g.uuid ?? ''} ${g.model ?? ''} ${g.cluster ?? ''} ${g.location ?? ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Clamp `page` into range and slice `pageSize` rows. PURE. */
export function paginate<T>(rows: T[], page: number, pageSize: number): { rows: T[]; page: number; pages: number; total: number } {
  const total = rows.length
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const p = Math.min(Math.max(1, page), pages)
  return { rows: rows.slice((p - 1) * pageSize, p * pageSize), page: p, pages, total }
}

// ── Formatters (cells) ───────────────────────────────────────────────────────

export const fmtPct = (n?: number | null): string => (n == null ? '—' : `${Math.round(n)}%`)
export const fmtTemp = (n?: number | null): string => (n == null ? '—' : `${Math.round(n)}°C`)
export const fmtPower = (n?: number | null): string => (n == null ? '—' : `${Math.round(n)} W`)
export const fmtInt = (n?: number | null): string => (n == null ? '—' : Math.round(n).toLocaleString())
export const usd = (cents?: number | null): string => (cents == null ? '—' : `$${(cents / 100).toFixed(2)}`)

/** Seconds → compact uptime (`3d 4h`, `5h 12m`, `8m`), or `—`. PURE. */
export function fmtUptime(seconds?: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '—'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d) return `${d}d ${h}h`
  if (h) return `${h}h ${m}m`
  return `${m}m`
}

/** Short device handle for a long UUID (`GPU-abc12…f9`), or the id. PURE. */
export function shortUuid(uuid?: string, fallback = ''): string {
  if (!uuid) return fallback
  const u = uuid.replace(/^gpu-/i, '')
  return u.length > 12 ? `${u.slice(0, 8)}…${u.slice(-2)}` : uuid
}

// ── API ──────────────────────────────────────────────────────────────────────

/** GPU node sizes offered for provisioning a GPU cluster (real DO GPU Droplet slugs). */
export const GPU_NODE_SIZES = [
  'gpu-h100x1-80gb',
  'gpu-h100x8-640gb',
  'gpu-l40sx1-48gb',
  'gpu-a100x1-80gb',
  'gpu-a100x8-640gb',
] as const

export const ComputeApi = {
  /** Per-GPU inventory + telemetry from the native cloud (`GET /v1/gpus`). */
  gpus: async (): Promise<Gpu[]> => {
    const r = await restGet<unknown>(cloudProxyV1Url('gpus'))
    const arr = Array.isArray(r) ? r : rec(r).gpus
    return (Array.isArray(arr) ? arr : []).map((g) => normalizeGpu(g))
  },

  /** GPU alerts from the native cloud (`GET /v1/gpus/alerts`). */
  alerts: async (): Promise<GpuAlert[]> => {
    const r = await restGet<unknown>(cloudProxyV1Url('gpus/alerts'))
    const arr = Array.isArray(r) ? r : rec(r).alerts
    return (Array.isArray(arr) ? arr : []).map((a, i) => normalizeAlert(a, i))
  },

  /** GPU scheduling pools from the native cloud (`GET /v1/gpus/pools`). */
  pools: async (): Promise<GpuPool[]> => {
    const r = await restGet<unknown>(cloudProxyV1Url('gpus/pools'))
    const arr = Array.isArray(r) ? r : rec(r).pools
    return (Array.isArray(arr) ? arr : []).map((p, i) => normalizePool(p, i))
  },

  /**
   * Metered usage over the last `days` from the cloud usage ledger
   * (`GET /v1/ops/usages/cloud` — the reader over `hanzo.cloud_usage`). Routed through
   * the `/v1` user-bearer proxy (org resolved from the Bearer owner) — a bare
   * `/v1/ops/usages/cloud` is cookie-only and 401s on the live ingress. Throws (→ honest
   * state) when the reader is not yet registered (404).
   */
  usageLedger: async (days = 7): Promise<UsageLedger> => {
    const data = await cloudGet<unknown>('ops/usages/cloud', { days })
    return normalizeLedger(data)
  },
}
