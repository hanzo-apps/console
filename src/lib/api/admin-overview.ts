/**
 * Admin overview API — the platform-wide "living overview" feed.
 *
 * SOURCE: the unified `/v1/admin/*` surface (the admin backend that aggregates
 * IAM + commerce + o11y into one place): `GET /v1/admin/overview` returns the
 * whole board (KPIs, usage/cost timeseries, revenue-by-product, live activity,
 * alerts, service health) in ONE call, and the narrower `GET /v1/admin/{usage,
 * orgs,audit,products}` feed the drill-downs. Requests go through the cloud `/v1`
 * client (cookie creds, envelope unwrap, `X-Org-Id`), so tenancy + the admin gate
 * are enforced server-side — the browser holds no admin credential.
 *
 * Coded to the documented shape and OPTIONAL-SAFE end to end: `normalizeOverview`
 * maps whatever the endpoint returns onto `AdminOverview`, and every missing field
 * degrades to a real empty/`null` — an org with no data, or a deployment where the
 * admin backend is not yet routed (`ApiError 404`), renders honest skeletons and
 * em-dashes, NEVER fabricated numbers. Money is USD cents end to end.
 */
import { get } from './client'

/** A KPI headline — a single number with an optional prior-period basis + live series. */
export type AdminKpi = {
  /** Stable key (`tokens`, `spendCents`, `requests`, `orgs`, `users`, …). */
  key: string
  /** Current value (raw number; the tile formats it). */
  value: number
  /** Prior-period value for the delta, when the backend has a basis. */
  prior?: number
  /** A recent dense series for the tile's live sparkline (oldest→newest). */
  series?: number[]
  /** `cents` renders as USD; `count` is a plain compacted number. Default `count`. */
  unit?: 'count' | 'cents'
}

/** One point on a temporal admin series (usage / cost over time). */
export type AdminSeriesPoint = { t: string; value: number }

/** A named admin timeseries (e.g. tokens, spendCents), with its bucket interval. */
export type AdminSeries = {
  key: string
  interval: 'hour' | 'day' | (string & {})
  points: AdminSeriesPoint[]
}

/** A slice of a distribution (revenue by product, spend by model). USD cents when money. */
export type AdminSlice = { label: string; value: number; hint?: string }

/** A live activity/audit event as the admin feed reports it. */
export type AdminActivity = {
  /** Stable id (dedupe across polls); '' when absent. */
  id: string
  /** RFC3339 (UTC). */
  time: string
  /** Short kind — `inference`, `deploy`, `signin`, `payment`, … */
  kind: string
  /** Human summary line. */
  title: string
  /** Secondary line (org / model / actor); optional. */
  subtitle?: string
  /** `success` | `error` | `warn` | '' — drives the status dot. */
  status: string
  /** Owning org slug, when the event is org-scoped. */
  org?: string
}

/** An open alert / incident. */
export type AdminAlert = {
  id: string
  /** `critical` | `warning` | `info`. */
  severity: string
  title: string
  detail?: string
  time?: string
}

/** A service-health row (from the operator inventory / o11y). */
export type AdminHealthRow = {
  service: string
  /** `green` | `yellow` | `red` | '' (unknown). */
  health: string
  cluster?: string
  detail?: string
}

/** The whole platform overview in one payload. */
export type AdminOverview = {
  /** Window echoed back (`24h`/`7d`/`30d`), for the header. */
  range: string
  kpis: AdminKpi[]
  series: AdminSeries[]
  /** Revenue/spend distribution (donut). */
  distribution: AdminSlice[]
  /**
   * Named distributions for the business board (revenue by product, plan mix, top
   * agents/bots by cost, …), keyed by a stable slug the tile reads. OPTIONAL and
   * only present when the backend emits it — an empty payload omits it entirely, so
   * a deployment without the business aggregate degrades to honest empty tiles.
   */
  distributions?: Record<string, AdminSlice[]>
  activity: AdminActivity[]
  alerts: AdminAlert[]
  health: AdminHealthRow[]
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const numArr = (v: unknown): number[] => arr(v).map(num)

function normalizeKpi(raw: unknown): AdminKpi {
  const r = (raw ?? {}) as Record<string, unknown>
  const kpi: AdminKpi = { key: str(r.key), value: num(r.value) }
  if (typeof r.prior === 'number' && Number.isFinite(r.prior)) kpi.prior = r.prior
  if (Array.isArray(r.series)) kpi.series = numArr(r.series)
  if (r.unit === 'cents' || r.unit === 'count') kpi.unit = r.unit
  return kpi
}

function normalizeSeries(raw: unknown): AdminSeries {
  const r = (raw ?? {}) as Record<string, unknown>
  return {
    key: str(r.key),
    interval: r.interval === 'hour' || r.interval === 'day' ? r.interval : str(r.interval) || 'day',
    points: arr(r.points).map((p) => {
      const pr = (p ?? {}) as Record<string, unknown>
      return { t: str(pr.t), value: num(pr.value) }
    }),
  }
}

function normalizeActivity(raw: unknown): AdminActivity {
  const r = (raw ?? {}) as Record<string, unknown>
  const a: AdminActivity = {
    id: str(r.id),
    time: str(r.time),
    kind: str(r.kind) || 'event',
    title: str(r.title),
    status: str(r.status),
  }
  if (r.subtitle) a.subtitle = str(r.subtitle)
  if (r.org) a.org = str(r.org)
  return a
}

/** Normalize a list of distribution slices (label + value + optional hint). */
function normalizeSlices(v: unknown): AdminSlice[] {
  return arr(v).map((s) => {
    const sr = (s ?? {}) as Record<string, unknown>
    const slice: AdminSlice = { label: str(sr.label), value: num(sr.value) }
    if (sr.hint) slice.hint = str(sr.hint)
    return slice
  })
}

/**
 * Parse a named-distributions map (`{ revenue: [...], plans: [...], topAgents:
 * [...] }`) — only when the backend actually sent one. Returns undefined for an
 * absent/empty map so the empty payload maps to the SAME object as before (no
 * spurious key) and honest-empty tiles render.
 */
function normalizeDistributions(v: unknown): Record<string, AdminSlice[]> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const out: Record<string, AdminSlice[]> = {}
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const slices = normalizeSlices(val)
    if (slices.length) out[k] = slices
  }
  return Object.keys(out).length ? out : undefined
}

/** Map an arbitrary `/v1/admin/overview` payload onto `AdminOverview` (optional-safe). */
export function normalizeOverview(raw: unknown): AdminOverview {
  const r = (raw ?? {}) as Record<string, unknown>
  const distributions = normalizeDistributions(r.distributions)
  return {
    range: str(r.range) || '24h',
    kpis: arr(r.kpis).map(normalizeKpi),
    series: arr(r.series).map(normalizeSeries),
    distribution: normalizeSlices(r.distribution),
    ...(distributions ? { distributions } : {}),
    activity: arr(r.activity).map(normalizeActivity),
    alerts: arr(r.alerts).map((a) => {
      const ar = (a ?? {}) as Record<string, unknown>
      const alert: AdminAlert = { id: str(ar.id), severity: str(ar.severity) || 'info', title: str(ar.title) }
      if (ar.detail) alert.detail = str(ar.detail)
      if (ar.time) alert.time = str(ar.time)
      return alert
    }),
    health: arr(r.health).map((h) => {
      const hr = (h ?? {}) as Record<string, unknown>
      const row: AdminHealthRow = { service: str(hr.service), health: str(hr.health) }
      if (hr.cluster) row.cluster = str(hr.cluster)
      if (hr.detail) row.detail = str(hr.detail)
      return row
    }),
  }
}

export type AdminOverviewParams = {
  /** Lookback window; forwarded as `?range=`. Default `24h`. */
  range?: '24h' | '7d' | '30d'
  /** Only the live activity feed (cheap poll), with a bounded page. */
  activityLimit?: number
  /** All-orgs god view (global admin); forwarded as `?org=all`. */
  allOrgs?: boolean
}

export const AdminApi = {
  /**
   * The whole platform overview. Throws a typed `ApiError` (404 when the admin
   * backend isn't routed on this host) the caller renders as an honest state.
   */
  overview: async (p: AdminOverviewParams = {}): Promise<AdminOverview> => {
    const data = await get<unknown>('admin/overview', {
      range: p.range ?? '24h',
      activityLimit: p.activityLimit ?? 20,
      org: p.allOrgs ? 'all' : undefined,
    })
    return normalizeOverview(data)
  },

  /**
   * Just the live activity feed — the cheap endpoint a fast poll hits between full
   * refreshes. Same honest degradation; returns `[]` when empty.
   */
  activity: async (p: { limit?: number; allOrgs?: boolean } = {}): Promise<AdminActivity[]> => {
    const data = await get<unknown>('admin/audit', {
      limit: p.limit ?? 20,
      org: p.allOrgs ? 'all' : undefined,
    })
    const list = Array.isArray(data)
      ? data
      : Array.isArray((data as { events?: unknown[] })?.events)
        ? (data as { events: unknown[] }).events
        : Array.isArray((data as { activity?: unknown[] })?.activity)
          ? (data as { activity: unknown[] }).activity
          : []
    return list.map(normalizeActivity)
  },
}
