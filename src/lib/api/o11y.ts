/**
 * Observability API — LLM/agent traces, sessions, and scores (HIP-0106).
 *
 * The contract mirrors the canonical tracing REST surface: list endpoints return
 * `{ data, meta }` (page/limit/totalItems/totalPages) and detail endpoints return
 * one object. Everything is mounted under `/v1/o11y` on the cloud backend and
 * speaks plain REST (raw JSON, real HTTP status codes), so we use the `restGet`
 * transport — NOT the casibase `{status,msg,data}` envelope.
 *
 * When the observability runtime is not initialized the backend answers 503 (and
 * 404 where the surface is unrouted); `restGet` throws a typed `ApiError` carrying
 * that status, so callers render honest states instead of fabricating data.
 *
 * Tenancy: every call rides the shared `restGet` transport, whose `baseHeaders`
 * (lib/api/client.ts) stamp `X-Org-Id` (`currentOrg()`) on EVERY request and add
 * `X-Project-Id` ONLY when a project is selected. So these Observe-derived views
 * are ORGANISATION-WIDE by default — no project is required on login — and narrow
 * to a project the moment one is picked in the scope switcher. The backend scopes
 * on the org either way: where a gateway re-injects `X-Org-Id` from the validated
 * session it simply overwrites the stamped value, so sending it is correct in both
 * topologies (direct cloud-api and gatewayed).
 */
import { restGet, cloudProxyV1Url } from './client'
import { EvalsApi, type EvalScoreConfig } from './evals'

/** Pagination metadata returned by every list endpoint. */
export type O11yPageMeta = {
  page: number
  limit: number
  totalItems: number
  totalPages: number
}

/** A list envelope — `data` rows plus pagination `meta`. */
export type O11yList<T> = { data: T[]; meta: O11yPageMeta }

/** Pagination query accepted by every list endpoint. */
export type O11yListQuery = { page?: number; limit?: number }

/** An LLM/agent trace — one end-to-end request or run. */
export type Trace = {
  id: string
  timestamp: string
  name: string | null
  userId: string | null
  sessionId: string | null
  environment: string
  release: string | null
  version: string | null
  tags: string[]
  public: boolean
  bookmarked: boolean
  input?: unknown
  output?: unknown
  metadata?: unknown
  /** End-to-end latency in seconds. */
  latency?: number | null
  /** Total cost in USD. */
  totalCost?: number | null
  /** Total tokens across the trace's observations (the "Usage" column). */
  totalTokens?: number | null
  /** Observation ids on the trace (the detail endpoint returns full objects). */
  observations?: string[] | null
  /** Score ids on the trace (the detail endpoint returns full objects). */
  scores?: string[] | null
  createdAt?: string
  updatedAt?: string
  htmlPath?: string
}

/** A single observation (span / generation / event / tool …) within a trace. */
export type Observation = {
  id: string
  traceId: string | null
  parentObservationId: string | null
  name: string | null
  /** GENERATION | SPAN | EVENT | AGENT | TOOL | CHAIN | RETRIEVER | … */
  type: string
  startTime: string
  endTime: string | null
  level: string
  statusMessage: string | null
  model: string | null
  input?: unknown
  output?: unknown
  metadata?: unknown
  usage?: { unit: string | null; input: number; output: number; total: number }
}

/** A score attached to a trace, observation, or session. */
export type Score = {
  id: string
  name: string
  value: number
  stringValue?: string | null
  /** NUMERIC | CATEGORICAL | BOOLEAN | TEXT */
  dataType: string
  /** API | EVAL | ANNOTATION */
  source: string
  comment: string | null
  timestamp: string
  traceId: string | null
  observationId?: string | null
  sessionId?: string | null
  configId: string | null
  environment?: string
}

/** A session — a group of traces sharing one session id. */
export type Session = {
  id: string
  createdAt: string
  projectId: string
  environment: string
}

/** A category option on a categorical/boolean score config. */
export type ScoreConfigCategory = { label: string; value: number }

/**
 * A score config — the definition of a score: its data type and valid range or
 * categories. Numeric configs carry min/max; categorical/boolean carry the
 * allowed categories. Mirrors `/v1/evals/rubrics`.
 */
export type ScoreConfig = {
  id: string
  projectId: string
  name: string
  description?: string | null
  /** NUMERIC | CATEGORICAL | BOOLEAN | TEXT */
  dataType: string
  /** Numeric/boolean configs only. */
  minValue?: number | null
  maxValue?: number | null
  /** Categorical/boolean configs only. */
  categories?: ScoreConfigCategory[] | null
  isArchived: boolean
  createdAt: string
  updatedAt: string
}

/**
 * An annotation queue — a named work queue of traces/observations to review and
 * score against a set of rubrics. Mirrors `/v1/o11y/reviews`.
 */
export type AnnotationQueue = {
  id: string
  name: string
  description?: string | null
  /** Score config ids the queue scores against. */
  scoreConfigIds: string[]
  createdAt: string
  updatedAt: string
}

/** One item assigned to an annotation queue. */
export type AnnotationQueueItem = {
  id: string
  queueId?: string
  traceId?: string | null
  observationId?: string | null
  status?: string | null
  assignee?: string | null
  createdAt?: string
  updatedAt?: string
}

/**
 * Full trace detail — the trace plus its observations and scores. `observations`
 * and `scores` are OMITTED from the base `Trace` (where they are id-arrays) before
 * intersecting, so the detail carries the full objects without a bad `string[] &
 * Observation[]` intersection.
 */
export type TraceDetail = Omit<Trace, 'observations' | 'scores'> & {
  observations: Observation[]
  scores: Score[]
}

/** Full session detail — the session plus its traces. */
export type SessionDetail = Session & { traces: Trace[] }

/** Full annotation queue detail. */
export type AnnotationQueueDetail = AnnotationQueue & { items?: AnnotationQueueItem[] }

/**
 * A user — the per-user analytics rollup the backend aggregates from traces
 * carrying a `userId`. Mirrors `/v1/o11y/llm/users`.
 */
export type O11yUser = {
  userId: string
  traceCount?: number
  totalCost?: number
  totalTokens?: number
  lastSeen?: string | null
  firstSeen?: string | null
}

// ── transport: the Observe read plane IS the o11y gen_ai span plane ───────────
// Every read addresses the same-origin `/v1` user-bearer BFF (cloudProxyV1Url — an
// alias of originV1Url since v8.4.120): a cookie-only call is refused, so
// `app/v1/[...path]` mints the caller's IAM bearer and o11y scopes by the token
// owner (the `o11y` head is allow-listed in proxy-allow.ts). cloud maps
// `/v1/o11y/llm/<resource>` → the embedded o11y runtime, which org-scopes the span
// views on the validated X-Org-Id and wraps every success as `{ status, data }`
// over a `{ items, offset, limit }` list — so we unwrap both. Until spans flow /
// the reverse-proxy resolves the reads surface honest states (a typed ApiError →
// RuntimeNotice/empty), never fabricated rows.

/** Max spans pulled to assemble one trace/session detail (o11y exposes no detail endpoint). */
const DETAIL_LIMIT = 200

/** Build a `/v1/o11y/<path>` URL (via the bearer BFF) with an optional query. */
const o11yUrl = (path: string, query?: Record<string, string | number | undefined>): string => {
  const base = cloudProxyV1Url(`o11y/${path}`)
  if (!query) return base
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== '' && v !== null) params.set(k, String(v))
  }
  const qs = params.toString()
  return qs ? `${base}?${qs}` : base
}

/** Offset from a page/limit pair (o11y pages by offset, not page number). */
const offsetOf = (q: O11yListQuery): number | undefined =>
  q.page && q.page > 1 && q.limit ? (q.page - 1) * q.limit : undefined

/** Unwrap the o11y `{ status, data }` success envelope (a bare payload passes through). */
export const unwrapO11y = <T>(res: unknown): T => {
  if (res && typeof res === 'object' && 'status' in res && 'data' in res) {
    return (res as { data: T }).data
  }
  return res as T
}

/** The o11y `{ items, offset, limit }` list envelope. */
type O11yItems<T> = { items?: T[] | null; offset?: number; limit?: number }

/** Fetch a native o11y list endpoint → its `items` (honest [] when items is null/absent). */
const o11yList = async <W>(path: string, query?: Record<string, string | number | undefined>): Promise<W[]> => {
  const env = unwrapO11y<O11yItems<W>>(await restGet<unknown>(o11yUrl(path, query)))
  return Array.isArray(env?.items) ? env.items : []
}

// ── native o11y wire shapes (exactly what pkg/types/llmobstypes/view.go marshals) ──

type O11yTraceWire = {
  id: string
  sessionId?: string
  userId?: string
  serviceName?: string
  observations?: number
  totalTokens?: number
  totalCost?: number
  latencyMs?: number
}
type O11yObservationWire = {
  id: string
  traceId?: string
  parentObservationId?: string
  type?: string
  name?: string
  startTime?: string
  latencyMs?: number
  model?: string
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  sessionId?: string
  userId?: string
  statusCode?: string
}
type O11ySessionWire = { id: string; userId?: string; traces?: number; totalTokens?: number; totalCost?: number }
type O11yUserWire = { id: string; traces?: number; totalTokens?: number; totalCost?: number }

/** A finite, non-negative number, else null (the honest guard for cost/latency/tokens). */
const finiteNonNeg = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null

// ── adapters: o11y wire → canonical Observe view-models ───────────────────────

/** Map an o11y trace aggregation (gen_ai spans grouped by trace_id) to the canonical Trace. */
export const traceOf = (t: O11yTraceWire): Trace => {
  const ms = finiteNonNeg(t.latencyMs)
  return {
    id: t.id,
    // The traces view is a scalar aggregation grouped by trace_id — it carries no
    // single start timestamp, name, or I/O; those render an honest em dash.
    timestamp: '',
    name: null,
    userId: t.userId ?? null,
    sessionId: t.sessionId ?? null,
    environment: 'default',
    release: null,
    version: null,
    tags: [],
    public: false,
    bookmarked: false,
    metadata: { serviceName: t.serviceName, observations: t.observations },
    latency: ms !== null ? ms / 1000 : null,
    totalCost: finiteNonNeg(t.totalCost),
    totalTokens: finiteNonNeg(t.totalTokens),
  }
}

/** endTime = startTime + latencyMs (ISO), or null when either is unusable. */
const isoEnd = (start: string | undefined, latencyMs: number | undefined): string | null => {
  if (!start || typeof latencyMs !== 'number' || !Number.isFinite(latencyMs)) return null
  const ms = Date.parse(start)
  return Number.isNaN(ms) ? null : new Date(ms + latencyMs).toISOString()
}

/** Map an o11y gen_ai span to the canonical Observation (SpanTree/metrics ready). */
export const observationOf = (o: O11yObservationWire): Observation => {
  const input = finiteNonNeg(o.promptTokens) ?? 0
  const output = finiteNonNeg(o.completionTokens) ?? 0
  const total = finiteNonNeg(o.totalTokens) ?? input + output
  return {
    id: o.id,
    traceId: o.traceId ?? null,
    parentObservationId: o.parentObservationId ?? null,
    name: o.name ?? null,
    type: (o.type ?? 'GENERATION').toUpperCase(),
    startTime: o.startTime ?? '',
    endTime: isoEnd(o.startTime, o.latencyMs),
    level: (o.statusCode ?? '').toUpperCase().includes('ERROR') ? 'ERROR' : 'DEFAULT',
    statusMessage: null,
    model: o.model ?? null,
    usage: { unit: 'TOKENS', input, output, total },
  }
}

/** Map an o11y session rollup to the thin canonical Session view-model. */
const sessionOf = (s: O11ySessionWire): Session => ({
  id: s.id,
  createdAt: '',
  projectId: '',
  environment: 'default',
})

/** Map an o11y user rollup to the canonical per-user analytics row. */
const userOf = (u: O11yUserWire): O11yUser => ({
  userId: u.id,
  traceCount: finiteNonNeg(u.traces) ?? 0,
  totalCost: finiteNonNeg(u.totalCost) ?? 0,
  totalTokens: finiteNonNeg(u.totalTokens) ?? 0,
  lastSeen: null,
  firstSeen: null,
})

/**
 * Synthesize a Trace header from its observations. o11y exposes no trace-detail
 * endpoint, so the detail is composed from the trace's spans; the header roll-ups
 * are derived from the REAL spans — never fabricated.
 */
const traceHeaderFrom = (id: string, obs: Observation[]): Trace => {
  let totalTokens = 0
  let earliest: string | null = null
  for (const o of obs) {
    totalTokens += o.usage?.total ?? 0
    if (o.startTime && (earliest === null || o.startTime < earliest)) earliest = o.startTime
  }
  return {
    id,
    timestamp: earliest ?? '',
    name: obs.find((o) => o.name)?.name ?? null,
    userId: null,
    sessionId: null,
    environment: 'default',
    release: null,
    version: null,
    tags: [],
    public: false,
    bookmarked: false,
    latency: null,
    totalCost: null,
    totalTokens: totalTokens || null,
  }
}

/**
 * Wrap a fully-fetched, bounded native list into the `O11yList` envelope the
 * modules expect. The o11y reads are limit-bounded single pages, so there is
 * exactly one page; nothing is fabricated.
 */
const asList = <T>(data: T[], q: O11yListQuery): O11yList<T> => ({
  data,
  meta: { page: q.page ?? 1, limit: q.limit ?? data.length, totalItems: data.length, totalPages: 1 },
})

/** Eval-domain score-config → the canonical ScoreConfig. Score CONFIGS are an
 *  eval-orchestration concern (o11y has none), so they STAY on /v1/evals. */
const scoreConfigOf = (c: EvalScoreConfig): ScoreConfig => ({
  id: c.name,
  projectId: '',
  name: c.name,
  dataType: c.dataType,
  minValue: c.minValue ?? null,
  maxValue: c.maxValue ?? null,
  categories: (c.categories ?? []).map((label) => ({ label, value: 0 })),
  isArchived: false,
  createdAt: c.createdAt ?? '',
  updatedAt: c.updatedAt ?? '',
})

/**
 * The Observe READ client. traces / observations / sessions / users (+ the trace and
 * session DETAIL) read NATIVELY from the o11y gen_ai span plane (`/v1/o11y/llm`, the declared
 * observation-of-record — the bare `/v1/o11y` siblings are the APM traces and the org's
 * members, a different subject). trace + session DETAIL are composed from the list views
 * filtered by traceId/sessionId (o11y exposes no detail endpoint — the real
 * waterfall without a backend change). SCORES + rubrics + every eval artifact
 * (datasets/evaluators/runs) STAY the eval-orchestration read on `/v1/evals`; the
 * trace detail's inline scores are the eval scores FOR that trace (listScoresTyped by
 * traceId), so nothing is lost. reviews / health read the bare `/v1/o11y` surface —
 * the review queue and the runtime's own liveness. Every read surfaces honest states
 * (ApiError → RuntimeNotice / empty) until spans flow and the reverse-proxy resolves —
 * never fabricated rows.
 */
export const O11yApi = {
  traces: async (q: O11yListQuery = {}): Promise<O11yList<Trace>> =>
    asList((await o11yList<O11yTraceWire>('llm/traces', { limit: q.limit, offset: offsetOf(q) })).map(traceOf), q),

  // Composed from the trace's spans (o11y, by traceId) + its eval scores (evals, by
  // traceId): the real observation waterfall, without an o11y trace-detail endpoint.
  // The header roll-ups (tokens/cost/latency) come from the SERVER-aggregated trace
  // row — grouped over ALL of the trace's spans server-side — so they never undercount
  // a trace with more than DETAIL_LIMIT spans (the waterfall list itself is bounded to
  // DETAIL_LIMIT; the totals are not). Name + start time are derived from the fetched
  // spans (the aggregation row carries neither). Falls back to the span-derived header
  // when the aggregation row is absent.
  trace: async (id: string): Promise<TraceDetail> => {
    const [obs, aggRows, scores] = await Promise.all([
      o11yList<O11yObservationWire>('llm/observations', { traceId: id, limit: DETAIL_LIMIT }),
      o11yList<O11yTraceWire>('llm/traces', { traceId: id, limit: 1 }),
      EvalsApi.listScoresTyped({ traceId: id, limit: DETAIL_LIMIT }),
    ])
    const observations = obs.map(observationOf)
    const spanHeader = traceHeaderFrom(id, observations)
    const agg = aggRows[0] ? traceOf(aggRows[0]) : null
    const header: Trace = agg
      ? {
          ...spanHeader,
          totalTokens: agg.totalTokens,
          totalCost: agg.totalCost,
          latency: agg.latency,
          sessionId: agg.sessionId ?? spanHeader.sessionId,
          userId: agg.userId ?? spanHeader.userId,
        }
      : spanHeader
    return { ...header, observations, scores }
  },

  sessions: async (q: O11yListQuery = {}): Promise<O11yList<Session>> =>
    asList((await o11yList<O11ySessionWire>('llm/sessions', { limit: q.limit, offset: offsetOf(q) })).map(sessionOf), q),

  // Composed from the session's traces (o11y, by sessionId).
  session: async (id: string): Promise<SessionDetail> => {
    const traces = (await o11yList<O11yTraceWire>('llm/traces', { sessionId: id, limit: DETAIL_LIMIT })).map(traceOf)
    return { ...sessionOf({ id }), traces }
  },

  observations: async (q: O11yListQuery = {}): Promise<O11yList<Observation>> =>
    asList((await o11yList<O11yObservationWire>('llm/observations', { limit: q.limit, offset: offsetOf(q) })).map(observationOf), q),

  // SCORES + rubrics STAY on /v1/evals (the eval artifacts) — only the span
  // plane (traces/observations/sessions) moved to o11y.
  scores: async (q: O11yListQuery = {}): Promise<O11yList<Score>> =>
    asList(await EvalsApi.listScoresTyped({ limit: q.limit }), q),

  scoreConfigs: async (q: O11yListQuery = {}): Promise<O11yList<ScoreConfig>> =>
    asList((await EvalsApi.listScoreConfigs()).map(scoreConfigOf), q),

  users: async (q: O11yListQuery = {}): Promise<O11yList<O11yUser>> =>
    asList((await o11yList<O11yUserWire>('llm/users', { limit: q.limit, offset: offsetOf(q) })).map(userOf), q),

  // ── annotation QUEUES have no o11y llmobs equivalent (flat annotations only) —
  //    honest states over the same /v1/o11y surface until a queue runtime exists ──
  annotationQueues: (q: O11yListQuery = {}) =>
    restGet<O11yList<AnnotationQueue>>(o11yUrl('reviews', { limit: q.limit, page: q.page })),

  annotationQueue: (id: string) =>
    restGet<AnnotationQueueDetail>(o11yUrl(`reviews/${encodeURIComponent(id)}`)),

  annotationQueueItems: (id: string, q: O11yListQuery = {}) =>
    restGet<O11yList<AnnotationQueueItem>>(o11yUrl(`reviews/${encodeURIComponent(id)}/items`, { limit: q.limit, page: q.page })),

  /**
   * Liveness of the embedded o11y runtime — `GET /v1/o11y/health` via the `/v1`
   * bearer BFF. 200 = the runtime is up and the caller's session passed the IAM
   * gate; a typed `ApiError` (503 initializing / 404 unrouted / 401·403 auth)
   * otherwise, so callers render an honest state and the e2e proof can assert on it.
   */
  health: () => restGet<unknown>(o11yUrl('health')),
}
