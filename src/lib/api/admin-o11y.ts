/**
 * Admin (GLOBAL) observability — the cross-org fleet o11y read behind the
 * admin.hanzo.ai Fleet Observability board. It is the un-org-scoped twin of the
 * per-org console o11y: the SAME signals, aggregated across EVERY tenant, from the
 * ONE hanzoai/datastore — LLM usage (hanzo.cloud_usage), traces
 * (signoz_traces), logs (signoz_logs), and Langfuse generations.
 *
 * Transport: `originGet('admin/o11y', …)` pins the request to the console's OWN
 * origin (never a split-origin `NEXT_PUBLIC_CLOUD_URL`), so it terminates at
 * `app/admin/aggregate/[...path]`, which runs `getAdminGate` (fail-closed 403 for a
 * non-global-admin) BEFORE forwarding a minted admin bearer to cloud. So the
 * cross-tenant aggregate is server-gated end to end; a customer can never read it.
 *
 * Honest by construction: every field is defensively normalized (missing → 0 / [],
 * snake_case AND camelCase tolerated), so a partial or empty warehouse renders real
 * zeros / empty leaderboards — never fabricated fleet numbers.
 */
import { originGet } from './client'

export type O11yRange = '24h' | '7d' | '30d'

/** Fleet KPI band — LLM usage + trace RED metrics + log volume, all orgs. */
export type FleetTotals = {
  requests: number
  tokens: number
  promptTokens: number
  completionTokens: number
  costCents: number
  errors: number
  orgs: number
  models: number
  traceCount: number
  latencyP50Ms: number
  latencyP95Ms: number
  latencyP99Ms: number
  traceErrorRate: number
  services: number
  logVolume: number
}

export type FleetSeriesPoint = { ts: string; requests: number; tokens: number; costCents: number; errors: number }
export type FleetLogPoint = { ts: string; count: number }
export type FleetOrgStat = { org: string; requests: number; tokens: number; costCents: number }
export type FleetModelStat = { model: string; requests: number; tokens: number; costCents: number }
export type FleetSvcStat = { service: string; requests: number; errorRate: number; latencyP95Ms: number }
export type FleetLLM = { generations: number; costUsd: number }

export type FleetO11y = {
  range: O11yRange
  start: string
  end: string
  totals: FleetTotals
  series: FleetSeriesPoint[]
  logSeries: FleetLogPoint[]
  topOrgs: FleetOrgStat[]
  topModels: FleetModelStat[]
  topServices: FleetSvcStat[]
  llm: FleetLLM
}

// ── defensive coercion (snake_case OR camelCase; missing/garbage → honest zero) ──
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : 0)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
/** First present of the given keys (camel + snake variants). */
const g = (o: Record<string, unknown>, ...keys: string[]): unknown => {
  for (const k of keys) if (o[k] !== undefined) return o[k]
  return undefined
}

function normalizeTotals(v: unknown): FleetTotals {
  const t = rec(v)
  return {
    requests: num(g(t, 'requests')),
    tokens: num(g(t, 'tokens')),
    promptTokens: num(g(t, 'promptTokens', 'prompt_tokens')),
    completionTokens: num(g(t, 'completionTokens', 'completion_tokens')),
    costCents: num(g(t, 'costCents', 'cost_cents')),
    errors: num(g(t, 'errors')),
    orgs: num(g(t, 'orgs')),
    models: num(g(t, 'models')),
    traceCount: num(g(t, 'traceCount', 'trace_count')),
    latencyP50Ms: num(g(t, 'latencyP50Ms', 'p50')),
    latencyP95Ms: num(g(t, 'latencyP95Ms', 'p95')),
    latencyP99Ms: num(g(t, 'latencyP99Ms', 'p99')),
    traceErrorRate: num(g(t, 'traceErrorRate', 'trace_error_rate')),
    services: num(g(t, 'services')),
    logVolume: num(g(t, 'logVolume', 'log_volume')),
  }
}

const normSeries = (v: unknown): FleetSeriesPoint[] =>
  arr(v).map((r) => {
    const o = rec(r)
    return { ts: str(g(o, 'ts')), requests: num(g(o, 'requests')), tokens: num(g(o, 'tokens')), costCents: num(g(o, 'costCents', 'cost_cents')), errors: num(g(o, 'errors')) }
  })

const normLogSeries = (v: unknown): FleetLogPoint[] =>
  arr(v).map((r) => {
    const o = rec(r)
    return { ts: str(g(o, 'ts')), count: num(g(o, 'count', 'c')) }
  })

const normOrgs = (v: unknown): FleetOrgStat[] =>
  arr(v).map((r) => {
    const o = rec(r)
    return { org: str(g(o, 'org', 'organization')), requests: num(g(o, 'requests')), tokens: num(g(o, 'tokens')), costCents: num(g(o, 'costCents', 'cost_cents')) }
  })

const normModels = (v: unknown): FleetModelStat[] =>
  arr(v).map((r) => {
    const o = rec(r)
    return { model: str(g(o, 'model')), requests: num(g(o, 'requests')), tokens: num(g(o, 'tokens')), costCents: num(g(o, 'costCents', 'cost_cents')) }
  })

const normServices = (v: unknown): FleetSvcStat[] =>
  arr(v).map((r) => {
    const o = rec(r)
    return { service: str(g(o, 'service', 'serviceName')), requests: num(g(o, 'requests')), errorRate: num(g(o, 'errorRate', 'error_rate')), latencyP95Ms: num(g(o, 'latencyP95Ms', 'p95')) }
  })

const RANGES: O11yRange[] = ['24h', '7d', '30d']

/** Normalize the raw `/v1/admin/o11y` payload into the typed fleet board model. */
export function normalizeFleetO11y(raw: unknown): FleetO11y {
  const d = rec(raw)
  const rawRange = str(g(d, 'range'))
  const llm = rec(g(d, 'llm'))
  return {
    range: (RANGES.includes(rawRange as O11yRange) ? rawRange : '30d') as O11yRange,
    start: str(g(d, 'start')),
    end: str(g(d, 'end')),
    totals: normalizeTotals(g(d, 'totals')),
    series: normSeries(g(d, 'series')),
    logSeries: normLogSeries(g(d, 'logSeries', 'log_series')),
    topOrgs: normOrgs(g(d, 'topOrgs', 'top_orgs')),
    topModels: normModels(g(d, 'topModels', 'top_models')),
    topServices: normServices(g(d, 'topServices', 'top_services')),
    llm: { generations: num(g(llm, 'generations')), costUsd: num(g(llm, 'costUsd', 'cost_usd', 'cost')) },
  }
}

export const AdminO11yApi = {
  /**
   * The whole fleet o11y board for a window. Throws a typed `ApiError` (403 for a
   * non-global-admin, 404 when the aggregate isn't routed on this host) that the
   * board renders as an honest state — never a fabricated fleet.
   */
  global: async (range: O11yRange = '30d'): Promise<FleetO11y> => normalizeFleetO11y(await originGet<unknown>('admin/o11y', { range })),
}
