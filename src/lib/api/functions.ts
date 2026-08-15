/**
 * Functions API — Hanzo Functions (serverless / FaaS), Fission-backed.
 *
 * `hanzoai/functions` is a Fission fork (Kubernetes-native: Function / Environment
 * / Package + HTTP / Queue / Time triggers, metered into Hanzo commerce). The
 * DOCUMENTED same-origin contract is `GET /v1/functions` — the gateway terminates
 * it at the Fission control plane (`universe/infra/k8s/functions`:
 * `api.hanzo.ai/v1/functions → router.fission`). That inventory facade is the
 * planned route; until it is bound this 404/501s and callers render honest states
 * (`classifyBackend` → `BackendStateCard` / `EmptyState`) — NEVER fabricated
 * functions, invocations, or costs.
 *
 * Plain REST (raw JSON, real HTTP status) like the o11y + provisioning facades, so
 * we use the `restGet/restPost/restDelete` transport (not the casibase
 * `{status,msg,data}` envelope). Payloads are normalized DEFENSIVELY (the
 * `billing.ts` pattern): the inventory may arrive as an enriched gateway shape
 * (`{ functions: [{ name, namespace, image, … }] }`) or the raw Fission CRD list
 * (`{ items: [{ metadata, spec }] }`), and a field rename upstream degrades a cell
 * to "—" rather than throwing. Org scope is stamped by `client.ts`
 * (`X-Org-Id = currentOrg()`); the browser sends cookie credentials only.
 *
 * Every aggregate the Overview shows is DERIVED from real returned rows
 * (`deriveOverview`) — there is no fabricated rollup. When the inventory is empty
 * or unreachable, the metrics degrade to `null` (rendered "—"), never invented.
 */
import { restGet, restPost, restDelete, cloudProxyV1Url } from './client'

/** Inventory facade base path (same-origin `/v1/functions`). */
const BASE = 'functions'
const enc = encodeURIComponent

// ── Coercion helpers (defensive, billing.ts style) ──────────────────────────
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined)

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

/** Pull the first array found under any of the common envelope keys (or the root). */
const arrayUnder = (payload: unknown, keys: string[]): Record<string, unknown>[] => {
  if (Array.isArray(payload)) return payload.filter((x) => x && typeof x === 'object') as Record<string, unknown>[]
  if (payload && typeof payload === 'object') {
    for (const k of keys) {
      const v = (payload as Record<string, unknown>)[k]
      if (Array.isArray(v)) return v.filter((x) => x && typeof x === 'object') as Record<string, unknown>[]
    }
  }
  return []
}

// ── Domain types ────────────────────────────────────────────────────────────

/** Lifecycle status as the inventory reports it (free-form; tone-mapped in UI). */
export type FunctionStatus = 'ready' | 'deploying' | 'error' | 'paused' | (string & {})

/**
 * One serverless function in the inventory. Most fields are optional: the gateway
 * enriches with runtime metrics (invocations / success / duration) the raw Fission
 * CRD does not carry, so the UI renders what is present and shows "—" for the rest.
 */
export type ServerlessFunction = {
  name: string
  namespace: string
  image?: string
  /** Fission environment (runtime), e.g. `node`, `python`, `go`. */
  environment?: string
  status: FunctionStatus
  /** Invocation count over the trailing 7 days (runtime metric). */
  invocations7d?: number
  /** Success ratio 0..1 over the window (runtime metric). */
  successRate?: number
  /** Mean execution duration in milliseconds (runtime metric). */
  avgDurationMs?: number
  /** Error count over the trailing 7 days (runtime metric). */
  errors7d?: number
  replicas?: number
  minReplicas?: number
  maxReplicas?: number
  /** Per-invocation timeout in seconds. */
  timeoutSec?: number
  /** Memory limit, as the backend formats it (e.g. `256Mi`). */
  memoryLimit?: string
  /** Public invoke endpoint, if exposed. */
  endpoint?: string
  /** Count of environment variables (NAMES/COUNT only — values are never read). */
  envCount?: number
  createdAt?: string
  lastDeployedAt?: string
}

/** A trigger bound to a function — HTTP route, queue topic, or cron schedule. */
export type FunctionTrigger = {
  id: string
  name: string
  /** HTTP | Queue | Time | KubernetesWatch | … */
  type: string
  enabled: boolean
  /** Route / topic / cron — whatever the trigger targets. */
  target?: string
  functionName?: string
}

/** One recent invocation of a function (status code, method, time, duration). */
export type FunctionInvocation = {
  id: string
  statusCode?: number
  method?: string
  time?: string
  durationMs?: number
}

/** Full function detail — the inventory row plus its triggers and recent calls. */
export type FunctionDetail = ServerlessFunction & {
  triggers: FunctionTrigger[]
  recentInvocations: FunctionInvocation[]
}

/** A single line of the invocations-over-time chart (one per function). */
export type SeriesLine = { key: string; points: { t: string; v: number }[] }

/** The invocation-status donut breakdown. */
export type StatusBreakdown = { success: number; timeout: number; error: number }

/** Overview metrics that need a time-series source (charts + cost). */
export type FunctionsMetrics = {
  /** Per-function invocation series for the multi-line chart. */
  series: SeriesLine[]
  /** Success / timeout / error totals for the donut. */
  status: StatusBreakdown
  /** Spend over the window in USD cents (null when no cost source). */
  costCents: number | null
}

/** Time window for the invocations chart + metric rollups. */
export type MetricsRange = '1H' | '6H' | '24H' | '7D' | '30D'
export const METRICS_RANGES: MetricsRange[] = ['1H', '6H', '24H', '7D', '30D']

/** How the invocations chart groups its lines. */
export type MetricsGroupBy = 'function' | 'namespace' | 'status'

// ── Normalizers (pure — unit-tested) ────────────────────────────────────────

/**
 * Normalize one inventory record to a `ServerlessFunction`. Handles both the
 * enriched gateway shape (flat fields) and the raw Fission CRD shape
 * (`{ metadata, spec }`), reading whichever is present.
 */
export function normalizeFunction(raw: unknown): ServerlessFunction | null {
  const r = asRecord(raw)
  const meta = asRecord(r.metadata)
  const spec = asRecord(r.spec)
  const env = asRecord(spec.environment)
  const name = str(r.name) ?? str(meta.name)
  if (!name) return null
  const envCountFrom = (v: unknown): number | undefined => {
    if (Array.isArray(v)) return v.length
    if (v && typeof v === 'object') return Object.keys(v as object).length
    return undefined
  }
  return {
    name,
    namespace: str(r.namespace) ?? str(meta.namespace) ?? 'default',
    image: str(r.image) ?? str(spec.image),
    environment: str(r.environment) ?? str(env.name),
    status: str(r.status) ?? str(asRecord(r.status).phase) ?? 'unknown',
    invocations7d: num(r.invocations7d) ?? num(r.invocationCount) ?? num(r.invocations),
    successRate: num(r.successRate) ?? num(r.success_rate),
    avgDurationMs: num(r.avgDurationMs) ?? num(r.avgDuration) ?? num(r.p50DurationMs),
    errors7d: num(r.errors7d) ?? num(r.errorCount) ?? num(r.errors),
    replicas: num(r.replicas) ?? num(r.availableReplicas),
    minReplicas: num(r.minReplicas) ?? num(spec.minScale),
    maxReplicas: num(r.maxReplicas) ?? num(spec.maxScale),
    timeoutSec: num(r.timeoutSec) ?? num(spec.functionTimeout) ?? num(r.timeout),
    memoryLimit: str(r.memoryLimit) ?? str(r.memory),
    endpoint: str(r.endpoint) ?? str(r.url),
    envCount: envCountFrom(r.env) ?? num(r.envCount),
    createdAt: str(r.createdAt) ?? str(meta.creationTimestamp),
    lastDeployedAt: str(r.lastDeployedAt) ?? str(r.updatedAt) ?? str(r.lastDeployed),
  }
}

/** Normalize an inventory payload to the list of functions (drops un-named rows). */
export function normalizeFunctions(payload: unknown): ServerlessFunction[] {
  return arrayUnder(payload, ['functions', 'items', 'data', 'rows'])
    .map(normalizeFunction)
    .filter((f): f is ServerlessFunction => f !== null)
}

/** Normalize a triggers payload (defensive over enriched + CRD shapes). */
export function normalizeTriggers(payload: unknown): FunctionTrigger[] {
  return arrayUnder(payload, ['triggers', 'items', 'data', 'rows']).map((raw, i) => {
    const r = asRecord(raw)
    const meta = asRecord(r.metadata)
    const spec = asRecord(r.spec)
    const fnRef = asRecord(spec.functionref ?? r.functionRef)
    return {
      id: str(r.id) ?? str(meta.uid) ?? str(r.name) ?? str(meta.name) ?? `trigger-${i}`,
      name: str(r.name) ?? str(meta.name) ?? `trigger-${i}`,
      type: str(r.type) ?? str(r.kind) ?? str(meta.kind) ?? 'HTTP',
      enabled: bool(r.enabled) ?? !bool(spec.disabled),
      target: str(r.target) ?? str(spec.relativeurl) ?? str(spec.topic) ?? str(spec.cron) ?? str(r.route),
      functionName: str(r.functionName) ?? str(fnRef.name) ?? str(fnRef.functionName),
    }
  })
}

/** Normalize a recent-invocations payload. */
export function normalizeInvocations(payload: unknown): FunctionInvocation[] {
  return arrayUnder(payload, ['invocations', 'items', 'data', 'rows', 'events']).map((raw, i) => {
    const r = asRecord(raw)
    return {
      id: str(r.id) ?? str(r.requestId) ?? `invocation-${i}`,
      statusCode: num(r.statusCode) ?? num(r.status) ?? num(r.code),
      method: str(r.method) ?? str(r.verb),
      time: str(r.time) ?? str(r.timestamp) ?? str(r.createdAt),
      durationMs: num(r.durationMs) ?? num(r.duration) ?? num(r.latencyMs),
    }
  })
}

/** Normalize a function-detail payload to a `FunctionDetail` (row + triggers + calls). */
export function normalizeFunctionDetail(payload: unknown): FunctionDetail | null {
  const base = normalizeFunction(payload) ?? normalizeFunction(asRecord(payload).function)
  if (!base) return null
  return {
    ...base,
    triggers: normalizeTriggers(payload),
    recentInvocations: normalizeInvocations(payload),
  }
}

/** Normalize a metrics payload (series + status donut + cost) — all degrade to empty. */
export function normalizeMetrics(payload: unknown): FunctionsMetrics {
  const root = asRecord(payload)
  const series: SeriesLine[] = arrayUnder(payload, ['series', 'lines', 'functions']).map((raw, i) => {
    const r = asRecord(raw)
    const points = arrayUnder(r, ['points', 'data', 'values']).map((p) => {
      const pr = asRecord(p)
      return { t: str(pr.t) ?? str(pr.time) ?? str(pr.timestamp) ?? '', v: num(pr.v) ?? num(pr.value) ?? num(pr.count) ?? 0 }
    })
    return { key: str(r.key) ?? str(r.name) ?? str(r.function) ?? `series-${i}`, points }
  })
  const st = asRecord(root.status ?? root.breakdown)
  const status: StatusBreakdown = {
    success: num(st.success) ?? num(st.ok) ?? 0,
    timeout: num(st.timeout) ?? num(st.timeouts) ?? 0,
    error: num(st.error) ?? num(st.errors) ?? num(st.failed) ?? 0,
  }
  const costCents = num(root.costCents) ?? (num(root.cost) !== undefined ? Math.round((num(root.cost) as number) * 100) : null)
  return { series, status, costCents }
}

// ── Derived rollups + filters (pure — unit-tested) ──────────────────────────

/** Overview aggregates derived from real rows only; missing data → `null`. */
export type OverviewStats = {
  count: number
  invocations7d: number | null
  successRate: number | null
  avgDurationMs: number | null
  errors7d: number | null
}

/**
 * Derive the Overview metrics from the inventory rows — REAL aggregates, never
 * fabricated. Rates/durations are invocation-weighted when invocation counts are
 * present, else a simple mean of the present values, else `null`.
 */
export function deriveOverview(fns: ServerlessFunction[]): OverviewStats {
  const count = fns.length
  const invVals = fns.map((f) => f.invocations7d).filter((v): v is number => v !== undefined)
  const hasInv = invVals.length > 0
  const invocations7d = hasInv ? invVals.reduce((a, b) => a + b, 0) : null

  const weighted = (pick: (f: ServerlessFunction) => number | undefined): number | null => {
    let wSum = 0
    let vSum = 0
    let plain: number[] = []
    for (const f of fns) {
      const v = pick(f)
      if (v === undefined) continue
      plain.push(v)
      const w = f.invocations7d
      if (w !== undefined && w > 0) {
        wSum += w
        vSum += w * v
      }
    }
    if (wSum > 0) return vSum / wSum
    if (plain.length > 0) return plain.reduce((a, b) => a + b, 0) / plain.length
    return null
  }

  const successRate = weighted((f) => f.successRate)
  const avgDurationMs = weighted((f) => f.avgDurationMs)

  const errVals = fns.map((f) => f.errors7d).filter((v): v is number => v !== undefined)
  let errors7d: number | null = errVals.length > 0 ? errVals.reduce((a, b) => a + b, 0) : null
  if (errors7d === null && invocations7d !== null && successRate !== null) {
    errors7d = Math.round(invocations7d * (1 - successRate))
  }

  return { count, invocations7d, successRate, avgDurationMs, errors7d }
}

/** Unique namespaces present in the inventory, sorted. */
export function namespacesOf(fns: ServerlessFunction[]): string[] {
  return Array.from(new Set(fns.map((f) => f.namespace).filter(Boolean))).sort()
}

/** Inventory filters — free-text search + namespace + status (`'all'` = no filter). */
export type FunctionFilter = { search?: string; namespace?: string; status?: string }

/** Apply search + namespace + status filters to the inventory (pure). */
export function filterFunctions(fns: ServerlessFunction[], f: FunctionFilter): ServerlessFunction[] {
  const q = (f.search ?? '').trim().toLowerCase()
  const ns = f.namespace && f.namespace !== 'all' ? f.namespace : undefined
  const st = f.status && f.status !== 'all' ? f.status.toLowerCase() : undefined
  return fns.filter((fn) => {
    if (ns && fn.namespace !== ns) return false
    if (st && (fn.status ?? '').toLowerCase() !== st) return false
    if (q) {
      const hay = `${fn.name} ${fn.namespace} ${fn.image ?? ''} ${fn.environment ?? ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Clamp + slice a page of rows; returns the page rows and the clamped page/total. */
export function paginate<T>(rows: T[], page: number, size: number): { rows: T[]; page: number; totalPages: number } {
  const totalPages = Math.max(1, Math.ceil(rows.length / size))
  const clamped = Math.min(Math.max(1, page), totalPages)
  const start = (clamped - 1) * size
  return { rows: rows.slice(start, start + size), page: clamped, totalPages }
}

/** Sum a multi-line series into per-bucket totals (aligned by point index). */
export function summedSeries(series: SeriesLine[]): number[] {
  const n = Math.max(0, ...series.map((s) => s.points.length))
  const out = new Array<number>(n).fill(0)
  for (const s of series) s.points.forEach((p, i) => (out[i] += p.v))
  return out
}

/**
 * Trend of a series as the percent change of its second half vs its first half —
 * a REAL delta derived from real buckets. `null` when there is too little data to
 * compute one (so the UI shows no delta rather than a fabricated one).
 */
export function trendPct(values: number[]): number | null {
  if (values.length < 4) return null
  const mid = Math.floor(values.length / 2)
  const a = values.slice(0, mid).reduce((x, y) => x + y, 0)
  const b = values.slice(mid).reduce((x, y) => x + y, 0)
  if (a === 0) return null
  return ((b - a) / a) * 100
}

// ── Display formatters (pure — unit-tested) ─────────────────────────────────

const EM = '—'

/** Integer with thousands separators; em dash for missing. */
export const fmtInt = (n?: number | null): string =>
  n === undefined || n === null ? EM : Math.round(n).toLocaleString()

/** Compact count (1.23M / 12.4K); em dash for missing. Matches the dashboard hero. */
export const fmtCompact = (n?: number | null): string => {
  if (n === undefined || n === null) return EM
  if (Math.abs(n) < 1000) return String(Math.round(n))
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 }).format(n)
}

/** Ratio 0..1 as a percentage (99.2%); em dash for missing. */
export const fmtPct = (x?: number | null): string =>
  x === undefined || x === null ? EM : `${(x * 100).toFixed(x >= 0.9995 ? 0 : 1)}%`

/** Duration in ms as `142ms` / `1.24s`; em dash for missing. */
export const fmtDuration = (ms?: number | null): string => {
  if (ms === undefined || ms === null) return EM
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

/** USD from cents (`$1.23`); em dash for missing. */
export { usd as fmtUsd } from '~/lib/money'

/** Absolute locale date-time; em dash for missing/invalid. */
export const fmtAbs = (iso?: string | null): string => {
  if (!iso) return EM
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

/** Relative "time ago" (`just now` / `5m ago` / `2h ago` / `3d ago`); `now` injectable for tests. */
export const fmtRelative = (iso?: string | null, now: number = Date.now()): string => {
  if (!iso) return EM
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return iso
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d}d ago`
  const mo = Math.round(d / 30)
  if (mo < 12) return `${mo}mo ago`
  return `${Math.round(mo / 12)}y ago`
}

// ── Network methods (thin — forward-compatible against the documented contract) ─

export const FunctionsApi = {
  /** The function inventory (`GET /v1/functions`). Honest-empty/error until bound. */
  list: (): Promise<ServerlessFunction[]> => restGet<unknown>(cloudProxyV1Url(BASE)).then(normalizeFunctions),

  /** One function's detail (`GET /v1/functions/{name}`) — about facts + triggers + calls. */
  get: (name: string): Promise<FunctionDetail | null> =>
    restGet<unknown>(cloudProxyV1Url(`${BASE}/${enc(name)}`)).then(normalizeFunctionDetail),

  /** Recent invocations for one function (`GET /v1/functions/{name}/invocations`). */
  invocations: (name: string): Promise<FunctionInvocation[]> =>
    restGet<unknown>(cloudProxyV1Url(`${BASE}/${enc(name)}/invocations`)).then(normalizeInvocations),

  /** Raw recent logs for one function (`GET /v1/functions/{name}/logs`). */
  logs: (name: string): Promise<string> =>
    restGet<unknown>(cloudProxyV1Url(`${BASE}/${enc(name)}/logs`)).then((p) => {
      if (typeof p === 'string') return p
      const r = asRecord(p)
      return str(r.logs) ?? str(r.text) ?? ''
    }),

  /** Invocations-over-time series + status donut + cost (`GET /v1/functions/metrics`). */
  metrics: (range: MetricsRange): Promise<FunctionsMetrics> =>
    restGet<unknown>(cloudProxyV1Url(`${BASE}/metrics?range=${range}`)).then(normalizeMetrics),

  /** All triggers across functions (`GET /v1/functions/triggers`). */
  triggers: (): Promise<FunctionTrigger[]> =>
    restGet<unknown>(cloudProxyV1Url(`${BASE}/triggers`)).then(normalizeTriggers),

  /** Deployment history (`GET /v1/functions/deployments`) — forward-compatible. */
  deployments: (): Promise<ServerlessFunction[]> =>
    restGet<unknown>(cloudProxyV1Url(`${BASE}/deployments`)).then(normalizeFunctions),

  /**
   * Secret NAMES bound to functions (`GET /v1/functions/secrets`). Names/refs only —
   * values are NEVER fetched or rendered (Secret Manager principle), mirroring the
   * names-only KMS inventory.
   */
  secrets: (): Promise<{ name: string; namespace?: string; mountedBy?: string }[]> =>
    restGet<unknown>(cloudProxyV1Url(`${BASE}/secrets`)).then((p) =>
      arrayUnder(p, ['secrets', 'items', 'data', 'rows']).map((raw) => {
        const r = asRecord(raw)
        const meta = asRecord(r.metadata)
        return {
          name: str(r.name) ?? str(meta.name) ?? '',
          namespace: str(r.namespace) ?? str(meta.namespace),
          mountedBy: str(r.mountedBy) ?? str(r.functionName),
        }
      }).filter((s) => s.name),
    ),

  /** Deploy a function (`POST /v1/functions`) — only called when the backend is live. */
  deploy: (body: { name: string; environment: string; image?: string; namespace?: string }): Promise<unknown> =>
    restPost<unknown>(cloudProxyV1Url(BASE), body),

  /** Delete a function (`DELETE /v1/functions/{name}`) — only called when the backend is live. */
  remove: (name: string): Promise<void> => restDelete(cloudProxyV1Url(`${BASE}/${enc(name)}`)),
}
