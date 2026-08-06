/**
 * Per-SERVICE metrics from the cloud-native o11y surface — `GET /v1/o11y/product/metrics`
 * (`hanzoai/cloud` clients/o11y `scope.go` → `handleMetrics`). This is the ONE
 * org-scoped, tenant-isolated per-product telemetry read: the caller names WHICH
 * service's metrics it wants via `?product=<slug>`, and the backend pins the ORG
 * server-side from the validated principal, so a signed-in member only ever sees its
 * OWN org's rows for that product.
 *
 * Transport: the same-origin `/v1` user-bearer BFF (`cloudProxyV1Url('o11y/product/metrics…')`
 * → `<origin>/v1/o11y/product/metrics`); the `o11y` head is allow-listed in `proxy-allow.ts`.
 * The endpoint speaks PLAIN REST (raw JSON, real HTTP status), so `restGet` throws a
 * typed `ApiError` carrying the status — a 503 (datastore not connected) / 404 (o11y
 * not routed) / 401·403 (session/access) is surfaced as `connected:false` to the
 * caller, which renders an honest notice instead of a fabricated chart.
 *
 * WHAT IT RETURNS (RED, trace-derived): per-service request / error / latency
 * time-series (`series.*`, each `[{t,v}]`) + a window `summary` + an LLM usage rollup.
 * It does NOT expose per-service CPU / memory — those are infra metrics the RED read
 * doesn't carry, so the Metrics tab labels them honestly as not-exposed rather than
 * inventing a chart.
 *
 * HONEST SCOPING: `product` is validated to a DNS-1123 slug and resolved through the
 * backend alias + allowlist of live in-cluster workloads (`productmap.go`). A
 * well-formed-but-unbacked product (a custom app that emits no telemetry) is an honest
 * 200 with EMPTY series (`hasData:false`) — never an error, never another service's
 * data. A malformed slug is a 400 (treated as honest-empty for that one app).
 *
 * Field names mirror `clients/o11y/metricsread.go` `metricsResponse` exactly.
 */
import { ApiError, cloudProxyV1Url, restGet } from './client'

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))

/** One `{t,v}` point of a RED series (t = RFC3339 bucket start, v = the value). */
export type MetricPoint = { t: string; v: number }

const points = (v: unknown): MetricPoint[] =>
  Array.isArray(v)
    ? v.map((p) => {
        const o = (p ?? {}) as Record<string, unknown>
        return { t: str(o.t), v: num(o.v) }
      })
    : []

/** The window's per-service metrics, defensively normalized. */
export type ServiceMetrics = {
  product: string
  /** RED time-series over the window (values, oldest → newest). */
  requests: MetricPoint[]
  errors: MetricPoint[]
  latencyP50Ms: MetricPoint[]
  latencyP95Ms: MetricPoint[]
  /** Window rollup the backend computed. */
  summary: { requests: number; errors: number; errorRate: number; p95Ms: number }
  /** LLM usage rollup (calls/tokens/cost) — secondary signal. */
  usage: { calls: number; tokens: number; costCents: number }
  /**
   * True when the service reported ANY signal in the window (a request bucket or a
   * non-zero summary). False = honest-empty (o11y answered, this service emits none
   * yet) — the card shows no sparkline, exactly the prior honest state.
   */
  hasData: boolean
  /** True = o11y answered (200). False = o11y unreachable/unconfigured (503/404/401/403). */
  connected: boolean
}

/** The honest not-connected result (o11y itself is unreachable), carrying the status. */
function notConnected(product: string, status: number): ServiceMetrics {
  return {
    product,
    requests: [],
    errors: [],
    latencyP50Ms: [],
    latencyP95Ms: [],
    summary: { requests: 0, errors: 0, errorRate: 0, p95Ms: 0 },
    usage: { calls: 0, tokens: 0, costCents: 0 },
    hasData: false,
    connected: status === 400, // 400 = bad slug for THIS product; o11y is still up → honest-empty
  }
}

/** Normalize a raw `metricsResponse` (200 body) → ServiceMetrics. */
export function normalizeServiceMetrics(raw: unknown): ServiceMetrics {
  const r = (raw ?? {}) as Record<string, unknown>
  const s = (r.series ?? {}) as Record<string, unknown>
  const sum = (r.summary ?? {}) as Record<string, unknown>
  const usage = (r.usage ?? {}) as Record<string, unknown>
  const requests = points(s.requests)
  const errors = points(s.errors)
  const summary = {
    requests: num(sum.requests),
    errors: num(sum.errors),
    errorRate: num(sum.errorRate),
    p95Ms: num(sum.p95Ms),
  }
  const hasData = summary.requests > 0 || requests.some((p) => p.v > 0) || errors.some((p) => p.v > 0)
  return {
    product: str(r.product),
    requests,
    errors,
    latencyP50Ms: points(s.latencyP50Ms),
    latencyP95Ms: points(s.latencyP95Ms),
    summary,
    usage: { calls: num(usage.calls), tokens: num(usage.tokens), costCents: num(usage.costCents) },
    hasData,
    connected: true,
  }
}

/**
 * The error-rate verdict. ONE definition of the thresholds, shared by the Metrics board and
 * the per-product Status band so the two can never disagree about what "healthy" means.
 * Thresholds are unchanged from the ones the console already shipped (`apm.serviceHealthOf`):
 * under 1% is green, 1–5% is elevated, 5% and over is degraded.
 */
export const errorRateTone = (pct: number): 'green' | 'yellow' | 'red' =>
  pct >= 5 ? 'red' : pct >= 1 ? 'yellow' : 'green'

/** Lookback windows the metrics tab offers (backend `range` is in SECONDS, ≤ 604800). */
export const METRICS_RANGES = [
  { id: 3600, label: '1h' },
  { id: 21600, label: '6h' },
  { id: 86400, label: '24h' },
] as const

const metricsUrl = (product: string, rangeSec: number): string => {
  const sp = new URLSearchParams({ product, range: String(Math.max(60, Math.floor(rangeSec))) })
  return cloudProxyV1Url(`o11y/product/metrics?${sp.toString()}`)
}

export const O11yMetricsApi = {
  /**
   * Per-service metrics for `product` (an app's slug) over `rangeSec` seconds. Returns
   * a normalized `ServiceMetrics` on 200 (honest-empty when the service has no data);
   * on an o11y transport error returns `connected:false` (never throws) so a single
   * app's miss can't break the canvas and the drawer can render an honest notice.
   */
  service: async (product: string, opts: { rangeSec?: number } = {}): Promise<ServiceMetrics> => {
    try {
      return normalizeServiceMetrics(await restGet<unknown>(metricsUrl(product, opts.rangeSec ?? 3600)))
    } catch (e) {
      return notConnected(product, e instanceof ApiError ? e.status : 0)
    }
  },
}
