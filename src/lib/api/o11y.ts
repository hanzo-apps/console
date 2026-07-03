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
import { restGet, v1Url } from './client'
import { EvalsApi, type EvalScoreConfig, type EvalSession } from './evals'

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
 * allowed categories. Mirrors `/v1/o11y/score-configs`.
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
 * score against a set of score configs. Mirrors `/v1/o11y/annotation-queues`.
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
 * carrying a `userId`. Mirrors `/v1/o11y/users`.
 */
export type O11yUser = {
  userId: string
  traceCount?: number
  totalCost?: number
  totalTokens?: number
  lastSeen?: string | null
  firstSeen?: string | null
}

/** Build a `/v1/o11y/<path>` URL with optional pagination query. */
const listUrl = (path: string, q: O11yListQuery): string => {
  const params = new URLSearchParams()
  if (q.page) params.set('page', String(q.page))
  if (q.limit) params.set('limit', String(q.limit))
  const qs = params.toString()
  return qs ? `${v1Url(path)}?${qs}` : v1Url(path)
}

/**
 * Wrap a fully-fetched, bounded native list into the `O11yList` envelope the
 * modules expect. The native `/v1/evals` reads are limit-bounded single pages, so
 * there is exactly one page; nothing is fabricated.
 */
const asList = <T>(data: T[], q: O11yListQuery): O11yList<T> => ({
  data,
  meta: { page: q.page ?? 1, limit: q.limit ?? data.length, totalItems: data.length, totalPages: 1 },
})

/** Native session rollup → the thin canonical Session view-model. */
const sessionOf = (s: EvalSession): Session => ({
  id: s.id,
  createdAt: s.firstAt ?? s.createdAt ?? '',
  projectId: '',
  environment: 'default',
})

/** Native score-config → the canonical ScoreConfig (categories become label/value options). */
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
 * The Observe READ client. Retargeted to the NATIVE `/v1/evals` surface (cloud
 * clients/eval, store owned by hanzoai/ai) — the old `/v1/o11y` proxy is gone.
 * Traces / trace-detail / sessions / scores / score-configs / observations all
 * delegate to the one native `EvalsApi` (which maps the wire rows into these
 * canonical view-models), wrapped in the `O11yList` envelope the modules render.
 * Annotation-queues and users have no eval-domain equivalent, so they remain on
 * `/v1/o11y` and surface honest states until that runtime is wired.
 */
export const O11yApi = {
  traces: async (q: O11yListQuery = {}): Promise<O11yList<Trace>> =>
    asList(await EvalsApi.listTraces({ limit: q.limit }), q),
  trace: (id: string): Promise<TraceDetail> => EvalsApi.getTrace(id),

  sessions: async (q: O11yListQuery = {}): Promise<O11yList<Session>> =>
    asList((await EvalsApi.listSessions({ limit: q.limit })).map(sessionOf), q),
  session: async (id: string): Promise<SessionDetail> => {
    const d = await EvalsApi.session(id)
    return { ...sessionOf(d.session), traces: d.traces }
  },

  scores: async (q: O11yListQuery = {}): Promise<O11yList<Score>> =>
    asList(await EvalsApi.listScoresTyped({ limit: q.limit }), q),

  scoreConfigs: async (q: O11yListQuery = {}): Promise<O11yList<ScoreConfig>> =>
    asList((await EvalsApi.listScoreConfigs()).map(scoreConfigOf), q),

  observations: async (q: O11yListQuery = {}): Promise<O11yList<Observation>> =>
    asList(await EvalsApi.listObservations({ limit: q.limit }), q),

  // ── no eval-domain equivalent yet — honest states over /v1/o11y ──
  annotationQueues: (q: O11yListQuery = {}) =>
    restGet<O11yList<AnnotationQueue>>(listUrl('o11y/annotation-queues', q)),

  annotationQueue: (id: string) =>
    restGet<AnnotationQueueDetail>(v1Url(`o11y/annotation-queues/${encodeURIComponent(id)}`)),

  annotationQueueItems: (id: string, q: O11yListQuery = {}) =>
    restGet<O11yList<AnnotationQueueItem>>(listUrl(`o11y/annotation-queues/${encodeURIComponent(id)}/items`, q)),

  users: (q: O11yListQuery = {}) => restGet<O11yList<O11yUser>>(listUrl('o11y/users', q)),
}
