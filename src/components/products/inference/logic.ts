/**
 * Inference — the PURE decisions behind the endpoints dashboard, so every honest
 * empty / "—" / real-number behavior is unit-tested in the node env and the `.tsx`
 * views stay thin. NOTHING here fabricates data:
 *
 *  - An endpoint's per-request metrics come from the REAL commerce usage ledger
 *    (`aimetrics`), matched to the endpoint by model id — a model with no ledger
 *    row rolls up to a real 0 (or `null` → "—" when the whole ledger is absent).
 *  - P95 latency + uptime are NOT exposed by any real per-endpoint source today, so
 *    they are `null` → the view renders an honest em-dash, never a made-up figure.
 *  - A deployed endpoint's status is read from its live KServe `InferenceService`
 *    conditions, never assumed "operational".
 *
 * Two REAL sources feed the one list: the managed model-serving catalog (`/v1/models`,
 * the models the org can serve/call on managed Hanzo Cloud — populated, ledger-matched
 * metrics) and the org's own deployed KServe InferenceServices (`/v1/ml/models`, real
 * lifecycle status; honest-empty when none). `mergeEndpoints` folds them into one list,
 * a deployed endpoint taking precedence over a same-named managed one.
 */
import {
  RANGE_DAYS,
  dailySeries,
  perModel,
  rangeStart,
  recent,
  totalsOf,
  withinRange,
  type ModelUsage,
  type RangeKey,
  type UsageRecord,
} from '~/lib/api/aimetrics'
import type { CatalogModel } from '~/lib/api/models-catalog'
import type { RawMlEndpoint } from '~/lib/api/inference'

// ── the unified endpoint view-model ──────────────────────────────────────────

/** Where an endpoint comes from — a managed catalog model, or the org's own deploy. */
export type EndpointKind = 'managed' | 'deployed'

/** An endpoint's honest lifecycle phase (drives the status dot + badge tone). */
export type EndpointPhase = 'available' | 'ready' | 'provisioning' | 'failed' | 'disabled' | 'unknown'

/** One model-serving endpoint, normalized from either real source. */
export type Endpoint = {
  /** Stable row key (`<kind>:<name>`). */
  id: string
  /** The model id / InferenceService name — also the ledger join key. */
  name: string
  kind: EndpointKind
  /** Provider (managed model `owned_by`); '' for a deployed endpoint. */
  provider: string
  /** Classified task type from the id (Text Generation / Embeddings / Vision / …). */
  type: string
  phase: EndpointPhase
  /** Human badge label for the phase (`Available` / `Ready` / `Provisioning` / …). */
  phaseLabel: string
  /** Paid-tier flag (managed catalog `premium`); false for a deployed endpoint. */
  premium: boolean
  /** Serving URL (deployed, when ready); '' for a managed model (served via the gateway). */
  url: string
  /** Creation instant (epoch ms), or null. */
  createdAt: number | null
}

// ── value formatting (self-contained so the module + its test stay decoupled) ─

const nf = (opts: Intl.NumberFormatOptions) => new Intl.NumberFormat(undefined, opts)

/** Compact count, e.g. 32400 → "32.4K". Non-finite → "—". */
export function fmtCount(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return nf({ notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

/** USD from cents, compact past $1k, else 2dp. Non-finite → "—". */
export function fmtUsd(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return '—'
  const d = cents / 100
  if (Math.abs(d) >= 1000) return '$' + nf({ notation: 'compact', maximumFractionDigits: 1 }).format(d)
  return '$' + d.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Signed percent for a delta, e.g. 12 → "+12%", -3 → "−3%". Null → "—". */
export function fmtDelta(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct)) return '—'
  const rounded = Math.round(pct)
  const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : ''
  return `${sign}${Math.abs(rounded)}%`
}

// ── endpoint type classification (honest — reads the real id) ─────────────────

/** Classify a model/endpoint's task type from its id. Never fabricated — a substring
 *  match on the REAL name, defaulting to the honest majority ("Text Generation"). */
export function endpointType(name: string): string {
  const s = (name || '').toLowerCase()
  if (/embed/.test(s)) return 'Embeddings'
  if (/rerank/.test(s)) return 'Reranking'
  if (/(^|[-_/])(tts|stt|asr|whisper|audio|speech|voice)([-_/]|$)/.test(s)) return 'Audio'
  if (/(vision|image|img|-vl\b|vlm|clip|sdxl|stable-?diffusion|flux|diffus)/.test(s)) return 'Vision'
  return 'Text Generation'
}

// ── KServe status → honest phase ──────────────────────────────────────────────

type KCondition = { type: string; status: string; reason: string }

/** Read the `status.conditions[]` off a KServe InferenceService status map. */
function readConditions(status: unknown): KCondition[] {
  if (!status || typeof status !== 'object') return []
  const raw = (status as Record<string, unknown>).conditions
  if (!Array.isArray(raw)) return []
  return raw.map((c) => {
    const o = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>
    return {
      type: typeof o.type === 'string' ? o.type : '',
      status: typeof o.status === 'string' ? o.status : '',
      reason: typeof o.reason === 'string' ? o.reason : '',
    }
  })
}

const isFailReason = (reason: string): boolean => /fail|error|invalid|missing|notfound|revisionmissing|crashloop/i.test(reason)

/**
 * The honest phase of a deployed endpoint, from its live KServe conditions:
 *  - Ready=True → ready; Ready=False with a failure reason → failed, else provisioning;
 *  - no Ready condition → failed if any condition failed, else provisioning;
 *  - no status/conditions yet (just created) → provisioning.
 * Never assumes "operational".
 */
export function deriveMlPhase(status: unknown): EndpointPhase {
  const conds = readConditions(status)
  if (conds.length === 0) return 'provisioning'
  const ready = conds.find((c) => c.type === 'Ready')
  if (ready) {
    if (ready.status === 'True') return 'ready'
    if (ready.status === 'False') return isFailReason(ready.reason) ? 'failed' : 'provisioning'
    return 'provisioning'
  }
  if (conds.some((c) => c.status === 'False' && isFailReason(c.reason))) return 'failed'
  return 'provisioning'
}

/** The serving URL from a KServe status (in-cluster address preferred), '' until ready. */
export function endpointUrl(status: unknown): string {
  if (!status || typeof status !== 'object') return ''
  const s = status as Record<string, unknown>
  const addr = s.address
  if (addr && typeof addr === 'object') {
    const u = (addr as Record<string, unknown>).url
    if (typeof u === 'string' && u) return u
  }
  return typeof s.url === 'string' ? s.url : ''
}

const PHASE_LABEL: Record<EndpointPhase, string> = {
  available: 'Available',
  ready: 'Ready',
  provisioning: 'Provisioning',
  failed: 'Failed',
  disabled: 'Disabled',
  unknown: 'Unknown',
}

const epochMs = (v: unknown): number | null => {
  if (typeof v !== 'string' || !v) return null
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : t
}

// ── normalize each real source → Endpoint ─────────────────────────────────────

/** A managed model-serving endpoint from the gateway catalog (`/v1/models`). It is
 *  live/callable, so its honest phase is `available`; type is classified from the id. */
export function fromCatalogModel(m: CatalogModel): Endpoint {
  const name = m.id || ''
  return {
    id: `managed:${name}`,
    name,
    kind: 'managed',
    provider: m.owned_by || '',
    type: endpointType(name),
    phase: 'available',
    phaseLabel: PHASE_LABEL.available,
    premium: m.premium === true,
    url: '',
    createdAt: typeof m.created === 'number' && m.created > 0 ? m.created * 1000 : null,
  }
}

/** The org's own deployed serving endpoint (KServe InferenceService, `/v1/ml/models`). */
export function fromMlEndpoint(r: RawMlEndpoint): Endpoint {
  const name = r.name || ''
  const phase = deriveMlPhase(r.status)
  return {
    id: `deployed:${name}`,
    name,
    kind: 'deployed',
    provider: '',
    type: endpointType(name),
    phase,
    phaseLabel: PHASE_LABEL[phase],
    premium: false,
    url: endpointUrl(r.status),
    createdAt: epochMs(r.createdAt),
  }
}

/**
 * Fold the two real sources into one endpoints list. A DEPLOYED endpoint (the org's
 * own InferenceService) takes precedence over a managed catalog model of the same
 * name — the org deployed its own, so its real lifecycle status wins. Deployed rows
 * sort first (the org's own), then both alphabetically.
 */
export function mergeEndpoints(managed: Endpoint[], deployed: Endpoint[]): Endpoint[] {
  const deployedNames = new Set(deployed.map((e) => e.name))
  const out = [...deployed, ...managed.filter((e) => !deployedNames.has(e.name))]
  return out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'deployed' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

// ── filter / sort / paginate (client-side over REAL rows) ─────────────────────

export type EndpointSort = 'recent' | 'name' | 'requests'
export type EndpointFilter = { q: string; type: string; phase: string }

/** Distinct types present in the REAL list (drives the Type filter — only real options). */
export function distinctTypes(list: Endpoint[]): string[] {
  return Array.from(new Set(list.map((e) => e.type))).sort()
}

/** Substring (literal, case-insensitive) name/type/provider match + type + phase filter. */
export function filterEndpoints(list: Endpoint[], f: EndpointFilter): Endpoint[] {
  const q = f.q.trim().toLowerCase()
  return list.filter((e) => {
    if (f.type && f.type !== 'all' && e.type !== f.type) return false
    if (f.phase && f.phase !== 'all' && e.phase !== f.phase) return false
    if (!q) return true
    return `${e.name} ${e.type} ${e.provider}`.toLowerCase().includes(q)
  })
}

/**
 * Sort the list. `requests` needs the per-model request map (real ledger counts); a
 * model with no ledger row sorts as 0 — honest, never a fabricated rank. `recent` is
 * newest-created first (undated last); `name` is alphabetical.
 */
export function sortEndpoints(list: Endpoint[], sort: EndpointSort, requestsByName?: Map<string, number>): Endpoint[] {
  const copy = [...list]
  if (sort === 'name') return copy.sort((a, b) => a.name.localeCompare(b.name))
  if (sort === 'requests') {
    const r = (e: Endpoint) => requestsByName?.get(e.name) ?? 0
    return copy.sort((a, b) => r(b) - r(a) || a.name.localeCompare(b.name))
  }
  return copy.sort((a, b) => (b.createdAt ?? -Infinity) - (a.createdAt ?? -Infinity) || a.name.localeCompare(b.name))
}

/** A page slice + the honest "Showing X–Y of N" label parts. */
export function paginate<T>(list: T[], page: number, pageSize: number): { slice: T[]; page: number; pages: number; from: number; to: number; total: number } {
  const total = list.length
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const clamped = Math.min(Math.max(1, page), pages)
  const start = (clamped - 1) * pageSize
  const slice = list.slice(start, start + pageSize)
  return { slice, page: clamped, pages, from: total === 0 ? 0 : start + 1, to: Math.min(total, start + pageSize), total }
}

// ── per-endpoint metrics from the REAL usage ledger ───────────────────────────

/** A per-endpoint metric bundle — real requests + sparkline, honest-null latency/uptime. */
export type EndpointMetrics = {
  /** Requests in the window (real ledger count), or null when the ledger is absent → "—". */
  requests: number | null
  /** Per-day request series for the endpoint (real), for the mini-sparkline. */
  series: number[]
  /** P95 latency ms — no real per-endpoint source today → null → "—". */
  p95Ms: number | null
  /** 7-day uptime pct — no real per-endpoint source today → null → "—". */
  uptimePct: number | null
}

/** Real per-model rollup for the window, keyed by model id (the endpoint join key). */
export function perModelMap(records: UsageRecord[], range: RangeKey, now: number): Map<string, ModelUsage> {
  const map = new Map<string, ModelUsage>()
  for (const m of perModel(withinRange(records, range, now))) map.set(m.model, m)
  return map
}

/** Real per-model request counts (for the `requests` sort), keyed by model id. */
export function requestsByModel(records: UsageRecord[], range: RangeKey, now: number): Map<string, number> {
  const map = new Map<string, number>()
  for (const [model, u] of perModelMap(records, range, now)) map.set(model, u.requests)
  return map
}

/** The dense per-day request series for ONE endpoint (real ledger rows for its model). */
export function endpointDailyRequests(records: UsageRecord[], name: string, range: RangeKey, now: number): number[] {
  const mine = withinRange(records, range, now).filter((r) => r.model === name)
  return dailySeries(mine, range, now).map((d) => d.requests)
}

/**
 * The metric bundle for one endpoint. When the ledger is entirely absent
 * (`hasLedger=false`, e.g. billing not routed) every real metric is null → the row
 * renders "—" everywhere; otherwise requests is the REAL count (0 when the model has
 * no rows) and the series is real. P95/uptime are always null (no real source).
 */
export function endpointMetrics(
  endpoint: Endpoint,
  perModel: Map<string, ModelUsage>,
  records: UsageRecord[],
  range: RangeKey,
  now: number,
  hasLedger: boolean,
): EndpointMetrics {
  if (!hasLedger) return { requests: null, series: [], p95Ms: null, uptimePct: null }
  const u = perModel.get(endpoint.name)
  return {
    requests: u ? u.requests : 0,
    series: endpointDailyRequests(records, endpoint.name, range, now),
    p95Ms: null,
    uptimePct: null,
  }
}

// ── right-rail usage overview (real totals + prior-period deltas + sparkline) ──

/** The right-rail "Usage Overview" numbers for a window, all REAL, with honest deltas. */
export type UsageWindow = {
  requests: number
  tokens: number
  cents: number
  series: { requests: number[]; tokens: number[]; cents: number[] }
  /** % change vs the immediately-prior window of equal length; null when no prior basis. */
  delta: { requests: number | null; tokens: number | null; cents: number | null }
}

/** Percent change of `cur` over `prior`; null when there's no honest basis (prior 0/absent). */
export function deltaPct(cur: number, prior: number): number | null {
  if (!Number.isFinite(prior) || prior === 0) return null
  return ((cur - prior) / prior) * 100
}

/**
 * Roll the REAL ledger into the right-rail window: current-window totals + a dense
 * per-day series (for the sparkline) + a delta vs the equal-length PRIOR window. An
 * org with no usage rolls up to real zeros + null deltas (honest "—"), never invented.
 */
export function usageWindow(records: UsageRecord[], range: RangeKey, now: number): UsageWindow {
  const cur = withinRange(records, range, now)
  const totals = totalsOf(cur)
  const series = dailySeries(cur, range, now)

  const days = RANGE_DAYS[range]
  const priorNow = rangeStart(range, now) // start of the current window = end of the prior
  const priorFrom = priorNow - days * 24 * 60 * 60 * 1000
  const prior = records.filter((r) => r.at !== null && r.at >= priorFrom && r.at < priorNow)
  const priorTotals = totalsOf(prior)

  return {
    requests: totals.requests,
    tokens: totals.totalTokens,
    cents: totals.cents,
    series: {
      requests: series.map((d) => d.requests),
      tokens: series.map((d) => d.tokens),
      cents: series.map((d) => d.cents),
    },
    delta: {
      requests: deltaPct(totals.requests, priorTotals.requests),
      tokens: deltaPct(totals.totalTokens, priorTotals.totalTokens),
      cents: deltaPct(totals.cents, priorTotals.cents),
    },
  }
}

// ── inference logs (REAL recorded activity from the ledger) ───────────────────

/** One inference log line — a REAL recorded inference request from the usage ledger. */
export type LogLine = {
  id: string
  at: number | null
  /** The endpoint (model) the request hit. */
  endpoint: string
  /** The recorded status (`success` / `error` / …) — the honest "level"; '' → unknown. */
  level: string
  /** The recorded note, or a composed real summary. */
  message: string
  /**
   * The FULL underlying ledger record for this call, so the row-detail drawer can show
   * everything the ledger actually recorded (tokens, cost, provider, request id, …)
   * without a second lookup. It IS the real per-call log — never fabricated.
   */
  record: UsageRecord
}

/** Distinct recorded status values present (drives the Level filter — real options only). */
export function distinctLevels(records: UsageRecord[]): string[] {
  return Array.from(new Set(records.map((r) => r.status).filter(Boolean))).sort()
}

/** Distinct models present (drives the Endpoint filter — real options only). */
export function distinctModels(records: UsageRecord[]): string[] {
  return Array.from(new Set(records.map((r) => r.model).filter(Boolean))).sort()
}

/**
 * Project the REAL usage ledger into inference log lines (newest first), filtered by
 * endpoint (model) + level (recorded status). These are genuine recorded inference
 * requests — one row per real API call — never fabricated log text. An empty ledger →
 * `[]` (honest "no activity yet").
 */
export function logsFromRecords(records: UsageRecord[], filter: { endpoint: string; level: string }, limit: number): LogLine[] {
  const wanted = recent(records, records.length).filter((r) => {
    if (filter.endpoint && filter.endpoint !== 'all' && r.model !== filter.endpoint) return false
    if (filter.level && filter.level !== 'all' && r.status !== filter.level) return false
    return true
  })
  return wanted.slice(0, limit).map((r) => ({
    id: r.id,
    at: r.at,
    endpoint: r.model || '—',
    level: r.status || '',
    message: r.notes || composeMessage(r),
    record: r,
  }))
}

/** A single label/value fact for the log-row detail drawer (value already formatted). */
export type LogFact = { label: string; value: string }

/**
 * Project ONE ledger record into the ordered fact list the log-row detail drawer
 * renders — every field the ledger actually recorded for that inference call. PURE:
 * money/token/date formatting is injected (the view owns the shared formatters), so a
 * missing datum passes through as the em dash the caller supplies — never fabricated.
 */
export function logDetailFacts(
  r: UsageRecord,
  fmt: { usd: (cents: number) => string; count: (n: number) => string; time: (ms: number | null) => string },
): LogFact[] {
  const dash = '—'
  const facts: LogFact[] = [
    { label: 'Endpoint', value: r.model || dash },
    { label: 'Provider', value: r.provider || dash },
    { label: 'Status', value: r.status || 'unknown' },
    { label: 'Cost', value: fmt.usd(r.cents) },
    { label: 'Total tokens', value: r.totalTokens ? fmt.count(r.totalTokens) : dash },
    { label: 'Prompt tokens', value: r.promptTokens ? fmt.count(r.promptTokens) : dash },
    { label: 'Completion tokens', value: r.completionTokens ? fmt.count(r.completionTokens) : dash },
    { label: 'Streamed', value: r.stream ? 'Yes' : 'No' },
    { label: 'Tier', value: r.premium ? 'Premium' : 'Standard' },
  ]
  // Only surface product / agent attribution when the ledger actually tagged it.
  if (r.product) facts.push({ label: 'Product', value: r.product })
  if (r.agent) facts.push({ label: 'Agent', value: r.agent })
  if (r.requestId) facts.push({ label: 'Request ID', value: r.requestId })
  facts.push({ label: 'Transaction ID', value: r.id })
  facts.push({ label: 'Time', value: fmt.time(r.at) })
  return facts
}

/** An honest one-line summary from a ledger row when it carries no note. */
function composeMessage(r: UsageRecord): string {
  const parts: string[] = ['Inference request']
  if (r.model) parts[0] = `Inference · ${r.model}`
  if (r.totalTokens) parts.push(`${r.totalTokens.toLocaleString()} tokens`)
  if (r.cents) parts.push(fmtUsd(r.cents))
  return parts.join(' · ')
}

// ── status-board summary ──────────────────────────────────────────────────────

/** The overall health summary for the Status board — all REAL counts. */
export type StatusSummary = { total: number; ready: number; provisioning: number; failed: number; managed: number; deployed: number }

/** Roll the endpoints into an honest status tally (no fabricated health). */
export function statusSummary(list: Endpoint[]): StatusSummary {
  return list.reduce<StatusSummary>(
    (acc, e) => ({
      total: acc.total + 1,
      ready: acc.ready + (e.phase === 'ready' || e.phase === 'available' ? 1 : 0),
      provisioning: acc.provisioning + (e.phase === 'provisioning' ? 1 : 0),
      failed: acc.failed + (e.phase === 'failed' ? 1 : 0),
      managed: acc.managed + (e.kind === 'managed' ? 1 : 0),
      deployed: acc.deployed + (e.kind === 'deployed' ? 1 : 0),
    }),
    { total: 0, ready: 0, provisioning: 0, failed: 0, managed: 0, deployed: 0 },
  )
}

/** Dot color for a phase (the ONE mapping shared by the list + status board). */
export const PHASE_DOT: Record<EndpointPhase, string> = {
  available: '#23c562',
  ready: '#23c562',
  provisioning: '#f0a868',
  failed: '#ef4444',
  disabled: '#64748b',
  unknown: '#64748b',
}
