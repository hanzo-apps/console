/**
 * The per-org / per-project AI-overview board — `GET /v1/evals/metrics` (hanzoai/cloud
 * `clients/eval` `metrics.go` → `metricsBoard`). The native "Langfuse home": which
 * models an org uses, request volume, cost, tokens (prompt/completion/total), error &
 * success rate, and latency percentiles (p50/p95/p99) over a window — aggregated from
 * the cloud_usage ledger (+ best-effort GenAI-span latency).
 *
 * Transport: the same-origin `/v1` user-bearer BFF (`cloudProxyV1Url('evals/metrics')`
 * -> `<origin>/v1/evals/metrics`); the `evals` head is allow-listed in `proxy-allow.ts`.
 * The org is pinned SERVER-SIDE from the validated bearer owner (never a client header);
 * a selected project rides `X-Project-Id` (stamped by `client.ts` when a project is in
 * scope), so a signed-in member only ever sees its OWN org, narrowed to its project.
 * The endpoint speaks PLAIN REST (raw JSON, real HTTP status), so `restGet` throws a
 * typed `ApiError` — a 503 (datastore) / 404 (not routed) / 401.403 (session/access) is
 * surfaced as `connected:false`, which the page renders as an honest notice, never a
 * fabricated dashboard.
 *
 * Honest by construction: every field is defensively normalized (missing -> 0 / [],
 * snake_case AND camelCase tolerated), and the latency percentiles are preserved as
 * `null` when the backend has no GenAI-span data (rendered "—", never a fake 0).
 */
import { ApiError, cloudProxyV1Url, restGet } from './client'

export type MetricsRange = '24h' | '7d' | '30d'
const RANGES: MetricsRange[] = ['24h', '7d', '30d']

// ── defensive coercion (snake_case OR camelCase; missing/garbage -> honest zero) ──
const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const num = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v)
    ? v
    : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))
      ? Number(v)
      : 0
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const bool = (v: unknown): boolean => v === true
/** Nullable number — a latency percentile is `null` (not 0) when there is no data. */
const numOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v)
    ? v
    : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))
      ? Number(v)
      : null
/** First present of the given keys (camel + snake variants). */
const g = (o: Record<string, unknown>, ...keys: string[]): unknown => {
  for (const k of keys) if (o[k] !== undefined) return o[k]
  return undefined
}

export type BoardScope = { org: string; project: string; allOrgs: boolean }
export type BoardRange = { range: string; start: string; end: string; interval: string }

export type BoardTotals = {
  generations: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  costCents: number
  errors: number
  successRate: number // 0..1
  models: number
  users: number
}

export type BoardPoint = { t: string; generations: number; costCents: number; totalTokens: number; errors: number }

export type ModelStat = {
  model: string
  provider: string
  requests: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  costCents: number
  errors: number
  errorRate: number // 0..1
  costPct: number // 0..100
  p50Ms: number | null
  p95Ms: number | null
  p99Ms: number | null
  modelCount: number // >0 only on the folded "other" row
}

export type LatencyStat = { available: boolean; p50Ms: number | null; p95Ms: number | null; p99Ms: number | null }

/** The full AI-overview board + a `connected` flag (false = the endpoint is unreachable). */
export type Board = {
  scope: BoardScope
  range: BoardRange
  totals: BoardTotals
  series: BoardPoint[]
  byModel: ModelStat[]
  other: ModelStat | null
  latency: LatencyStat
  connected: boolean
}

function normalizeTotals(v: unknown): BoardTotals {
  const t = rec(v)
  return {
    generations: num(g(t, 'generations')),
    promptTokens: num(g(t, 'promptTokens', 'prompt_tokens')),
    completionTokens: num(g(t, 'completionTokens', 'completion_tokens')),
    totalTokens: num(g(t, 'totalTokens', 'total_tokens')),
    costCents: num(g(t, 'costCents', 'cost_cents')),
    errors: num(g(t, 'errors')),
    successRate: num(g(t, 'successRate', 'success_rate')),
    models: num(g(t, 'models')),
    users: num(g(t, 'users')),
  }
}

const normSeries = (v: unknown): BoardPoint[] =>
  arr(v).map((r) => {
    const o = rec(r)
    return {
      t: str(g(o, 't')),
      generations: num(g(o, 'generations')),
      costCents: num(g(o, 'costCents', 'cost_cents')),
      totalTokens: num(g(o, 'totalTokens', 'total_tokens')),
      errors: num(g(o, 'errors')),
    }
  })

function normModel(v: unknown): ModelStat {
  const o = rec(v)
  return {
    model: str(g(o, 'model')),
    provider: str(g(o, 'provider')),
    requests: num(g(o, 'requests')),
    promptTokens: num(g(o, 'promptTokens', 'prompt_tokens')),
    completionTokens: num(g(o, 'completionTokens', 'completion_tokens')),
    totalTokens: num(g(o, 'totalTokens', 'total_tokens')),
    costCents: num(g(o, 'costCents', 'cost_cents')),
    errors: num(g(o, 'errors')),
    errorRate: num(g(o, 'errorRate', 'error_rate')),
    costPct: num(g(o, 'costPct', 'cost_pct')),
    p50Ms: numOrNull(g(o, 'p50Ms', 'p50_ms')),
    p95Ms: numOrNull(g(o, 'p95Ms', 'p95_ms')),
    p99Ms: numOrNull(g(o, 'p99Ms', 'p99_ms')),
    modelCount: num(g(o, 'modelCount', 'model_count')),
  }
}

function normLatency(v: unknown): LatencyStat {
  const o = rec(v)
  return {
    available: bool(g(o, 'available')),
    p50Ms: numOrNull(g(o, 'p50Ms', 'p50_ms')),
    p95Ms: numOrNull(g(o, 'p95Ms', 'p95_ms')),
    p99Ms: numOrNull(g(o, 'p99Ms', 'p99_ms')),
  }
}

/** Normalize the raw `/v1/evals/metrics` 200 body -> a connected Board. */
export function normalizeBoard(raw: unknown): Board {
  const d = rec(raw)
  const scope = rec(g(d, 'scope'))
  const range = rec(g(d, 'range'))
  const other = g(d, 'other')
  return {
    scope: {
      org: str(g(scope, 'org')),
      project: str(g(scope, 'project')),
      allOrgs: bool(g(scope, 'allOrgs', 'all_orgs')),
    },
    range: {
      range: str(g(range, 'range')),
      start: str(g(range, 'start')),
      end: str(g(range, 'end')),
      interval: str(g(range, 'interval')),
    },
    totals: normalizeTotals(g(d, 'totals')),
    series: normSeries(g(d, 'series')),
    byModel: arr(g(d, 'byModel', 'by_model')).map(normModel),
    other: other != null && typeof other === 'object' ? normModel(other) : null,
    latency: normLatency(g(d, 'latency')),
    connected: true,
  }
}

/** The honest not-connected board (the endpoint is unreachable), carrying the range. */
export function emptyBoard(range: MetricsRange): Board {
  return {
    scope: { org: '', project: '', allOrgs: false },
    range: { range, start: '', end: '', interval: '' },
    totals: {
      generations: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      costCents: 0,
      successRate: 0,
      errors: 0,
      models: 0,
      users: 0,
    },
    series: [],
    byModel: [],
    other: null,
    latency: { available: false, p50Ms: null, p95Ms: null, p99Ms: null },
    connected: false,
  }
}

const metricsUrl = (range: MetricsRange): string =>
  cloudProxyV1Url(`evals/metrics?range=${encodeURIComponent(range)}`)

export const EvalsMetricsApi = {
  /**
   * The AI-overview board for the caller's org (+ selected project) over `range`.
   * Returns a normalized, connected Board on 200; on any transport error returns an
   * honest `connected:false` board (never throws) so the page renders a notice, not a
   * crash. Any non-200 is "not connected"; a signed-in 403 (project not attributed /
   * not enabled) still yields the honest empty board the page shows beside a notice.
   */
  board: async (range: MetricsRange = '24h'): Promise<Board> => {
    const r: MetricsRange = RANGES.includes(range) ? range : '24h'
    try {
      return normalizeBoard(await restGet<unknown>(metricsUrl(r)))
    } catch (e) {
      void (e instanceof ApiError ? e.status : 0)
      return emptyBoard(r)
    }
  },
}
