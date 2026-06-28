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
 * Tenancy is server-side: the gateway validates the session cookie and injects the
 * org from the JWT, so the browser sends cookie credentials only.
 */
import { restGet, v1Url } from './client'

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

/** Full trace detail — the trace plus its observations and scores. */
export type TraceDetail = Trace & { observations: Observation[]; scores: Score[] }

/** Full session detail — the session plus its traces. */
export type SessionDetail = Session & { traces: Trace[] }

/** Build a `/v1/o11y/<path>` URL with optional pagination query. */
const listUrl = (path: string, q: O11yListQuery): string => {
  const params = new URLSearchParams()
  if (q.page) params.set('page', String(q.page))
  if (q.limit) params.set('limit', String(q.limit))
  const qs = params.toString()
  return qs ? `${v1Url(path)}?${qs}` : v1Url(path)
}

export const O11yApi = {
  traces: (q: O11yListQuery = {}) => restGet<O11yList<Trace>>(listUrl('o11y/traces', q)),
  trace: (id: string) => restGet<TraceDetail>(v1Url(`o11y/traces/${encodeURIComponent(id)}`)),

  sessions: (q: O11yListQuery = {}) => restGet<O11yList<Session>>(listUrl('o11y/sessions', q)),
  session: (id: string) => restGet<SessionDetail>(v1Url(`o11y/sessions/${encodeURIComponent(id)}`)),

  scores: (q: O11yListQuery = {}) => restGet<O11yList<Score>>(listUrl('o11y/scores', q)),
}
