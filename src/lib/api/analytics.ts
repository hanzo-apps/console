/**
 * Typed client for the unified analytics data plane (cloud `clients/analytics`),
 * called SAME-ORIGIN with NO prefix (`originV1Url('analytics/...')`). The rewrite in
 * next.config.mjs terminates the request at the console's `/v1` user-bearer proxy,
 * which mints a short-lived user Bearer and forwards to cloud-api; the org is resolved
 * server-authoritatively from the Bearer owner claim, so every metric is scoped to the
 * caller's own org — the browser never holds a datastore credential.
 *
 * ONE warehouse (Hanzo Datastore), TWO lenses, and exactly the FOUR routes the
 * backend actually mounts (`clients/analytics/analytics.go` routes at 95-98) — no more:
 *   - GET /v1/analytics/overview    — headline KPIs (llm + web + commerce blocks)
 *   - GET /v1/analytics/timeseries  — the LLM usage series (requests/tokens/spend)
 *   - GET /v1/analytics/top         — top models (llm) + top products (commerce)
 *   - GET /v1/analytics/health      — datastore connectivity probe
 *
 * The LLM lens (`hanzo.cloud_usage`) is REAL live per-org data in prod. The web +
 * commerce lenses (`hanzo.events`) are HONEST-empty (`available:false`) until a
 * collector emits — never fabricated zeros. Responses are BARE JSON (the analytics
 * handler writes the struct directly — NOT the casibase `{status,msg,data}` envelope),
 * so this uses the plain `restGet` transport and normalizes DEFENSIVELY (a field
 * rename/absence degrades to 0 / "—", never throws).
 *
 * Field names mirror the Go response structs in `clients/analytics/query.go` exactly.
 */
import { restGet, originV1Url } from './client'

const BASE = 'analytics'

/** The window grammar the backend understands (`window()` → ResolveCloudUsageWindow). */
export type Range = '24h' | '7d' | '30d'
export const RANGES: readonly Range[] = ['24h', '7d', '30d']

const q = (path: string, params?: Record<string, string | number | undefined>): string => {
  const sp = new URLSearchParams()
  if (params) for (const [k, v] of Object.entries(params)) if (v != null) sp.set(k, String(v))
  const s = sp.toString()
  return originV1Url(`${BASE}/${path}${s ? `?${s}` : ''}`)
}

// ── Defensive coercion (a shape drift degrades, never throws) ────────────────
const num = (v: unknown): number => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return 0
}
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
const arrayOf = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as Record<string, unknown>[]) : []

// ── Response types (mirror clients/analytics/query.go) ───────────────────────

/** The flagship LLM lens — REAL per-org KPIs from hanzo.cloud_usage. */
export type LlmOverview = {
  available: boolean
  requests: number
  tokens: number
  promptTokens: number
  completionTokens: number
  /** Spend in the smallest currency unit (cents). */
  spendCents: number
  models: number
  providers: number
  errors: number
  /** errors/requests, 0..1. */
  errorRate: number
}

/** The web lens over hanzo.events — honest-empty until the collector emits. */
export type WebOverview = {
  available: boolean
  reason: string
  pageviews: number
  visitors: number
  sessions: number
}

/** The commerce lens over hanzo.events — honest-empty until commerce emits orders. */
export type CommerceOverview = {
  available: boolean
  reason: string
  orders: number
  /** Revenue in whole currency units (dollars), already summed server-side. */
  revenue: number
  aov: number
}

export type Overview = {
  range: string
  interval: string
  org: string
  llm: LlmOverview
  web: WebOverview
  commerce: CommerceOverview
}

/** One bucket of the LLM usage series (requests/tokens/spend over time). */
export type SeriesPoint = { t: string; requests: number; tokens: number; spendCents: number }

/** Per-model LLM usage (the Models table + donut). */
export type ModelRow = {
  model: string
  provider: string
  requests: number
  tokens: number
  spendCents: number
  /** Share of total spend, 0..100. */
  pct: number
}
export type TopModels = { available: boolean; items: ModelRow[] }

/** Per-product commerce rows — honest-empty until commerce emits order events. */
export type ProductRow = { productId: string; orders: number; revenue: number; units: number }
export type TopProducts = { available: boolean; reason: string; items: ProductRow[] }

export type Top = { models: TopModels; products: TopProducts }

/** Datastore connectivity probe (whether the warehouse is wired). */
export type Health = { service: string; status: string; datastore: boolean; warehouse: string }

// ── Normalizers (pure, exported for unit tests) ──────────────────────────────

export function normalizeOverview(raw: unknown): Overview {
  const r = asRecord(raw)
  const llm = asRecord(r.llm)
  const web = asRecord(r.web)
  const commerce = asRecord(r.commerce)
  return {
    range: str(r.range),
    interval: str(r.interval),
    org: str(asRecord(r.scope).org),
    llm: {
      available: llm.available === true,
      requests: num(llm.requests),
      tokens: num(llm.tokens),
      promptTokens: num(llm.promptTokens),
      completionTokens: num(llm.completionTokens),
      spendCents: num(llm.spendCents),
      models: num(llm.models),
      providers: num(llm.providers),
      errors: num(llm.errors),
      errorRate: num(llm.errorRate),
    },
    web: {
      available: web.available === true,
      reason: str(web.reason),
      pageviews: num(web.pageviews),
      visitors: num(web.visitors),
      sessions: num(web.sessions),
    },
    commerce: {
      available: commerce.available === true,
      reason: str(commerce.reason),
      orders: num(commerce.orders),
      revenue: num(commerce.revenue),
      aov: num(commerce.aov),
    },
  }
}

export function normalizeSeries(raw: unknown): SeriesPoint[] {
  return arrayOf(asRecord(raw).series).map((p) => ({
    t: str(p.t),
    requests: num(p.requests),
    tokens: num(p.tokens),
    spendCents: num(p.spendCents),
  }))
}

export function normalizeTop(raw: unknown): Top {
  const r = asRecord(raw)
  const models = asRecord(r.models)
  const products = asRecord(r.products)
  return {
    models: {
      available: models.available === true,
      items: arrayOf(models.items).map((m) => ({
        model: str(m.model),
        provider: str(m.provider),
        requests: num(m.requests),
        tokens: num(m.tokens),
        spendCents: num(m.spendCents),
        pct: num(m.pct),
      })),
    },
    products: {
      available: products.available === true,
      reason: str(products.reason),
      items: arrayOf(products.items).map((p) => ({
        productId: str(p.productId),
        orders: num(p.orders),
        revenue: num(p.revenue),
        units: num(p.units),
      })),
    },
  }
}

/**
 * AnalyticsApi — one typed method per REAL `/v1/analytics/*` endpoint. Each is a plain
 * GET through the same-origin `/v1` bearer proxy; the org is server-side. A 403
 * (cookie-only) or 503 (warehouse unwired) surfaces to the caller's BackendStateCard.
 */
export const AnalyticsApi = {
  overview: (range: Range): Promise<Overview> =>
    restGet<unknown>(q('overview', { range })).then(normalizeOverview),
  timeseries: (range: Range): Promise<SeriesPoint[]> =>
    restGet<unknown>(q('timeseries', { range })).then(normalizeSeries),
  top: (range: Range, limit = 20): Promise<Top> => restGet<unknown>(q('top', { range, limit })).then(normalizeTop),
  health: (): Promise<Health> =>
    restGet<unknown>(q('health')).then((raw) => {
      const r = asRecord(raw)
      return { service: str(r.service), status: str(r.status), datastore: r.datastore === true, warehouse: str(r.warehouse) }
    }),
}
