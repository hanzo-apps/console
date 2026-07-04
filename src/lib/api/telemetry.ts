/**
 * Telemetry API — live platform health + infra metrics from VictoriaMetrics
 * (Prometheus-compatible), via the same-origin READ-only `/telemetry` proxy
 * (`app/telemetry/[...path]/route.ts` → `vmsingle-victoria-metrics-single-server`).
 *
 * This is the REAL source the Status and Metrics surfaces read: VictoriaMetrics
 * scrapes a health target per Hanzo service (`up{job="iam-health"}`, `up{job=
 * "cloud-api-health"}`, …) plus process/runtime series. The old Status/`/paas/apps`
 * board is empty (the platform apps inventory reports zero apps) and `/paas/logs`
 * 401s — so those surfaces showed nothing; VictoriaMetrics is where the live signal
 * actually is.
 *
 * Every value is a fold over what VictoriaMetrics returns — an empty result rolls up
 * to honest zeros / empty series, never a fabricated health dot. The parse helpers
 * are pure (JSON in, view-model out) so they unit-test without a live TSDB.
 */
import { ApiError, restGet } from './client'

// ── Wire shape (Prometheus/VictoriaMetrics query API) ────────────────────────

/** Raw Prometheus result — instant `value:[ts,val]` OR range `values:[[ts,val]…]`. */
type PromResult = {
  metric?: Record<string, string>
  value?: [number, string]
  values?: [number, string][]
}
type PromResponse = {
  status?: string
  data?: { resultType?: string; result?: PromResult[] }
  error?: string
  errorType?: string
}

/** One instant sample: its labels + a finite numeric value at a timestamp (s). */
export type Sample = { metric: Record<string, string>; value: number; ts: number }
/** One time-series: its labels + ordered (t seconds, v) points. */
export type Series = { metric: Record<string, string>; points: { t: number; v: number }[] }

const numOf = (v: string | undefined): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : NaN
}

/** Parse an instant-vector response into finite samples (NaN values dropped). */
export function parseInstant(body: unknown): Sample[] {
  const r = body as PromResponse
  const rows = r?.data?.result ?? []
  const out: Sample[] = []
  for (const row of rows) {
    if (!row.value) continue
    const value = numOf(row.value[1])
    if (!Number.isFinite(value)) continue
    out.push({ metric: row.metric ?? {}, value, ts: row.value[0] })
  }
  return out
}

/** Parse a range (matrix) response into series with finite points. */
export function parseRange(body: unknown): Series[] {
  const r = body as PromResponse
  const rows = r?.data?.result ?? []
  return rows.map((row) => ({
    metric: row.metric ?? {},
    points: (row.values ?? [])
      .map(([t, v]) => ({ t, v: numOf(v) }))
      .filter((p) => Number.isFinite(p.v)),
  }))
}

// ── Service health (the Status board) ────────────────────────────────────────

/** One scraped service target and whether it is up. */
export type ServiceHealth = {
  /** Scrape job — the service identity (e.g. `iam-health`, `cloud-api-health`). */
  job: string
  /** Human service name (the `-health` suffix stripped, `_` → ` `). */
  service: string
  /**
   * Customer-safe endpoint — a public FQDN (port stripped) or `''` when the scrape
   * instance is internal (in-cluster `.svc`, loopback, or a private IP). REDACTED at
   * the source by `redactInstance`, so the raw internal `host:port` never reaches the
   * browser (defense in depth). Render `instance || '—'`.
   */
  instance: string
  /** `up == 1`. */
  up: boolean
  /** Optional brand label, when the series carries one. */
  brand?: string
}

/** `iam-health` → `iam`, `cloud-api-health` → `cloud-api`; else the job verbatim. */
export function serviceNameOf(job: string): string {
  return job.replace(/-health$/, '')
}

/**
 * Redact an internal scrape instance (`host:port`) for a CUSTOMER-facing status board.
 * A Prometheus `instance` label is the in-cluster address the collector scrapes —
 * `visor.hanzo.svc:19000`, `localhost:8428`, `127.0.0.1:8429`, `10.x.x.x:9000` — which
 * must NEVER render to a customer (it exposes internal topology). We keep only what is
 * safe and useful: a non-private, non-internal PUBLIC host (e.g. `iam.hanzo.ai`) is
 * shown port-stripped; anything in-cluster / loopback / private-IP / bare-port is
 * dropped to `''` (the UI renders `—`). The status verdict still comes from `up`, so a
 * redacted row loses no health signal — only the internal address. Applied at the
 * source so the internal address never even reaches the browser (defense in depth).
 */
export function redactInstance(instance: string): string {
  const raw = (instance ?? '').trim()
  if (!raw) return ''
  const host = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split('/')[0].split(':')[0].trim().toLowerCase()
  if (!host) return ''
  // Loopback + unqualified in-cluster names (no public TLD).
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.svc') || host.includes('.svc.') || !host.includes('.')) return ''
  // RFC1918 / link-local / loopback IPv4 and any IPv6 literal — internal by definition.
  if (/^(10|127)\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^169\.254\./.test(host) || host.includes(':')) return ''
  // A public FQDN: show the host, port stripped (a customer never needs the scrape port).
  return host
}

/** Map `up` samples → the service-health board, sorted down-first then by name. */
export function toServiceHealth(samples: Sample[]): ServiceHealth[] {
  const rows = samples.map((s) => {
    const job = s.metric.job ?? s.metric.instance ?? 'unknown'
    return {
      job,
      service: serviceNameOf(job),
      instance: redactInstance(s.metric.instance ?? ''),
      up: s.value === 1,
      brand: s.metric.brand,
    }
  })
  // Down services first (they need attention), then alphabetical by service.
  return rows.sort((a, b) => Number(a.up) - Number(b.up) || a.service.localeCompare(b.service))
}

/** Rollup counts for the health board / KPIs. */
export type HealthSummary = { total: number; healthy: number; down: number }
export function summarizeHealth(rows: ServiceHealth[]): HealthSummary {
  const healthy = rows.filter((r) => r.up).length
  return { total: rows.length, healthy, down: rows.length - healthy }
}

// ── Transport ────────────────────────────────────────────────────────────────

/** `<origin>/telemetry` — the same-origin read-only VictoriaMetrics proxy. */
const base = (): string => (typeof window !== 'undefined' ? `${window.location.origin}/telemetry` : '/telemetry')

const url = (path: string, params: Record<string, string | number>): string => {
  const u = new URL(`${base()}/${path}`, typeof window !== 'undefined' ? window.location.origin : 'http://_')
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v))
  const abs = u.toString()
  return typeof window !== 'undefined' ? abs : `${u.pathname}${u.search}`
}

/** A range window (seconds). `step` is the resolution; `points ≈ (end-start)/step`. */
export type RangeWindow = { start: number; end: number; step: number }

/** Build a range window ending now, spanning `seconds`, targeting ~`points` samples. */
export function windowOf(seconds: number, points = 60): RangeWindow {
  const end = Math.floor(Date.now() / 1000)
  const step = Math.max(15, Math.round(seconds / points))
  return { start: end - seconds, end, step }
}

export const TelemetryApi = {
  /** Instant query — the current value of `promql` (e.g. `up`, `sum(up)`). */
  instant: async (promql: string): Promise<Sample[]> =>
    parseInstant(await restGet<unknown>(url('api/v1/query', { query: promql }))),

  /** Range query — `promql` sampled across a window (for a chart). */
  range: async (promql: string, w: RangeWindow): Promise<Series[]> =>
    parseRange(await restGet<unknown>(url('api/v1/query_range', { query: promql, start: w.start, end: w.end, step: w.step }))),

  /** The live service-health board (`up` per scrape target). */
  serviceHealth: async (): Promise<ServiceHealth[]> => toServiceHealth(await TelemetryApi.instant('up')),
}

/** Re-export the typed error so callers classify 401/501/502 honestly. */
export { ApiError }
