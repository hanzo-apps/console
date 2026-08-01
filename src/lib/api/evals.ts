/**
 * Evals + Observe API — the native Hanzo Cloud `/v1/evals/*` surface (cloud
 * `clients/eval`, the THIN API; the trace/observation store is the datastore
 * warehouse owned by hanzoai/ai — `hanzo.observations` / `hanzo.cloud_usage`).
 *
 * This is the ONE client for the console's Observe surface: datasets, dataset
 * items, evaluators, rubrics, scores, traces (+ the trace-detail
 * span/observation tree), observations, sessions, dataset runs / experiments,
 * and the dashboard metrics. It is the faithful port target of the upstream
 * observability screens, reskinned to @hanzo/gui.
 *
 * TRANSPORT: every call is SAME-ORIGIN with NO prefix (`originV1Url('evals/…')`
 * → `<origin>/v1/evals/…`, the CTO one-endpoint-form). `next.config.mjs` rewrites
 * the `evals` head to the console's `/v1` user-bearer proxy — the SAME
 * per-tenant path Prompts/Agents use. The facade authorizes on the validated
 * Bearer owner claim and scopes every read/write to that org SERVER-SIDE; a
 * cookie-only call has no bearer and 403s. `evals` is allow-listed in
 * `proxy-allow.ts`, so the proxy admits `v1/evals/*` and nothing else.
 *
 * SHAPES: list endpoints return `{ data: [...] }`. Trace / Observation / Score /
 * Session are mapped into the canonical Observe-derived view-model types
 * (`./o11y`), so the shared observability primitives (SpanTree waterfall,
 * metrics folds, formatters) render either surface unchanged.
 *
 * HONESTY: every field is a real backend value. A missing enrichment (latency /
 * cost / tokens the thin API does not yet roll up) is `null` → the UI renders an
 * em dash. An unbound endpoint (trace-detail / observations / sessions / metrics,
 * pending the ai-store read-through — see the module BE-gap notes) throws a typed
 * `ApiError` the module turns into an honest BackendStateCard — never a fabricated
 * row.
 *
 * Ported layout/flows from the upstream observability product (MIT) — see NOTICE. No third-party code is
 * copied; this is a clean client over the native `/v1/evals` contract.
 */
import { restGet, restPost, restDelete, originV1Url, ApiError } from './client'
import type { Observation, Score, Trace, TraceDetail } from './o11y'

// ── native wire shapes (exactly what cloud clients/eval returns) ─────────────

/** A dataset (cloud `datasetView`). */
export type EvalDataset = {
  id?: string
  name: string
  description?: string
  metadata?: Record<string, unknown>
  items?: number
  createdAt?: string
  updatedAt?: string
}

/** A dataset item — one input/expected pair (cloud `itemView`). */
export type EvalDatasetItem = {
  id: string
  datasetName?: string
  input?: unknown
  expectedOutput?: unknown
  metadata?: Record<string, unknown>
  status?: string
  createdAt?: string
  updatedAt?: string
}

/** An evaluator — a judge model + rubric (cloud `evaluatorView`). */
export type EvalEvaluator = {
  name: string
  model?: string
  criteria?: string
  scoreName?: string
  createdAt?: string
  updatedAt?: string
}

/** A dataset run / experiment row (cloud `listRuns`). */
export type EvalDatasetRun = {
  dataset?: string
  runName?: string
  model?: string
  judgeModel?: string
  items?: number
  scored?: number
  avgScore?: number
  createdAt?: string
  updatedAt?: string
}

/** One per-item run result (cloud `itemResult`). */
export type EvalItemResult = {
  itemId: string
  traceId?: string
  score: number
  output?: string
  error?: string
}

/** The summary returned by POST /v1/evals/runs (cloud `runSummary`). */
export type EvalRunSummary = {
  dataset: string
  model: string
  judgeModel: string
  runName: string
  items: number
  scored: number
  avgScore: number
  results?: EvalItemResult[]
}

/** Run request (cloud `runRequest`). */
export type EvalRunRequest = {
  dataset: string
  model: string
  runName?: string
  limit?: number
  judge?: { model?: string; criteria?: string; name?: string }
}

export type CreateDatasetBody = { name: string; description?: string; metadata?: Record<string, unknown> }
export type CreateDatasetItemBody = {
  input?: unknown
  expectedOutput?: unknown
  metadata?: Record<string, unknown>
  status?: string
}
export type CreateEvaluatorBody = { name: string; model?: string; criteria?: string; scoreName?: string }
export type CreateScoreConfigBody = {
  name: string
  dataType?: 'NUMERIC' | 'CATEGORICAL' | 'BOOLEAN'
  minValue?: number
  maxValue?: number
  categories?: string[]
}

// ── legacy score-page shape kept for EvalScoresView (backward compatible) ────

export type EvalScore = {
  id: string
  name?: string
  value?: number
  stringValue?: string
  dataType?: string
  source?: string
  comment?: string
  traceId?: string
  observationId?: string
  datasetRunId?: string
  runName?: string
  timestamp?: string
  createdAt?: string
}
export type EvalScoresPage = {
  data: EvalScore[]
  meta?: { page?: number; limit?: number; totalItems?: number; totalPages?: number }
}

/** Native score-config wire shape (cloud `scoreConfigView`). */
export type EvalScoreConfig = {
  name: string
  dataType: string
  minValue?: number | null
  maxValue?: number | null
  categories?: string[]
  createdAt?: string
  updatedAt?: string
}

/** Dashboard metrics rollup (Observe · Dashboards). BE-gap shape; folded client-side today. */
export type EvalMetrics = {
  totals: {
    traces: number
    cost: number | null
    tokens: number | null
    avgLatency: number | null
    p95Latency: number | null
  }
  tracesSeries: { label: string; value: number }[]
  costSeries: { label: string; value: number }[]
  tokensSeries: { label: string; value: number }[]
}

// ── envelope helpers ─────────────────────────────────────────────────────────

/** Unwrap a `{ data: [...] }` list envelope (or a bare array), never throwing on shape. */
const rows = <T>(res: { data?: T[] } | T[] | null | undefined): T[] =>
  Array.isArray(res) ? res : Array.isArray(res?.data) ? (res as { data: T[] }).data : []

const url = (path: string, query?: Record<string, string | number | undefined>): string => {
  const u = new URL(originV1Url(`evals/${path}`))
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== '' && v !== null) u.searchParams.set(k, String(v))
    }
  }
  return u.toString()
}

// ── adapters: native wire → canonical Observe view-models ───────────────────

type TraceWire = {
  id: string
  name?: string
  datasetName?: string
  datasetItemId?: string
  runName?: string
  sessionId?: string
  model?: string
  input?: unknown
  output?: unknown
  timestamp?: string
  latency?: number | null
  latencyMs?: number | null
  totalCost?: number | null
  totalTokens?: number | null
  tags?: string[]
}

/**
 * A finite, NON-NEGATIVE number, else null — the honest guard for latency / cost /
 * tokens. A malformed response (`1e999` → Infinity, `-5`, `NaN`) becomes null so
 * the UI renders an em dash and metric folds are never skewed by a bogus value.
 */
const nonNeg = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null

/** Same guard, defaulting to 0 for the non-nullable usage token members. */
const nonNeg0 = (v: unknown): number => nonNeg(v) ?? 0

/** Map a native trace to the canonical Trace. Missing enrichment stays null (→ em dash). */
export const toTrace = (t: TraceWire): Trace => {
  const ms = nonNeg(t.latencyMs)
  const latency = nonNeg(t.latency) ?? (ms !== null ? ms / 1000 : null)
  return {
    id: t.id,
    timestamp: t.timestamp ?? '',
    name: t.name ?? (t.runName ? `eval:${t.runName}` : null),
    userId: null,
    sessionId: t.sessionId ?? t.runName ?? null,
    environment: 'default',
    release: null,
    version: null,
    // Coerce every tag to a string — a non-string tag would crash React rendering.
    tags: Array.isArray(t.tags)
      ? t.tags.filter((x): x is string => typeof x === 'string')
      : t.runName
        ? [t.runName]
        : [],
    public: false,
    bookmarked: false,
    input: t.input,
    output: t.output,
    metadata: { dataset: t.datasetName, datasetItemId: t.datasetItemId, model: t.model, runName: t.runName },
    latency,
    totalCost: nonNeg(t.totalCost),
    totalTokens: nonNeg(t.totalTokens),
  }
}

type ObservationWire = {
  id: string
  traceId?: string
  parentObservationId?: string | null
  parentId?: string | null
  name?: string
  type?: string
  model?: string
  input?: unknown
  output?: unknown
  startTime?: string
  endTime?: string | null
  level?: string
  statusMessage?: string | null
  latencyMs?: number | null
  promptTokens?: number
  outputTokens?: number
  totalTokens?: number
  totalCost?: number
  usage?: { unit?: string | null; input?: number; output?: number; total?: number }
}

/** Map a native observation to the canonical Observation (SpanTree/metrics ready). */
export const toObservation = (o: ObservationWire): Observation => {
  // Token counts are finite + non-negative or 0 — a bogus usage number must never
  // reach the waterfall or the token folds.
  const input = nonNeg0(o.usage?.input ?? o.promptTokens)
  const output = nonNeg0(o.usage?.output ?? o.outputTokens)
  const total =
    o.usage?.total != null ? nonNeg0(o.usage.total) : o.totalTokens != null ? nonNeg0(o.totalTokens) : input + output
  return {
    id: o.id,
    traceId: o.traceId ?? null,
    parentObservationId: o.parentObservationId ?? o.parentId ?? null,
    name: o.name ?? null,
    type: (o.type ?? 'SPAN').toUpperCase(),
    startTime: o.startTime ?? '',
    endTime: o.endTime ?? null,
    level: o.level ?? 'DEFAULT',
    statusMessage: o.statusMessage ?? null,
    model: o.model ?? null,
    input: o.input,
    output: o.output,
    metadata: undefined,
    usage: { unit: o.usage ? (o.usage.unit ?? null) : 'TOKENS', input, output, total },
  }
}

type ScoreWire = {
  id: string
  name?: string
  value?: number
  stringValue?: string
  dataType?: string
  comment?: string | null
  timestamp?: string
  traceId?: string
  observationId?: string | null
  runName?: string
}

/** Map a native score event to the canonical Score. */
export const toScore = (s: ScoreWire): Score => ({
  id: s.id,
  name: s.name ?? '',
  // Scores may legitimately be negative, but never non-finite — NaN/Inf → 0.
  value: typeof s.value === 'number' && Number.isFinite(s.value) ? s.value : 0,
  stringValue: s.stringValue ?? null,
  dataType: (s.dataType ?? 'NUMERIC').toUpperCase(),
  source: 'EVAL',
  comment: s.comment ?? null,
  timestamp: s.timestamp ?? '',
  traceId: s.traceId ?? null,
  observationId: s.observationId ?? null,
  sessionId: null,
  configId: null,
})

/** A session — traces grouped by session id, with read-time rollups (cloud `sessionView`). */
export type EvalSession = {
  id: string
  createdAt?: string
  firstAt?: string
  lastAt?: string
  traceCount?: number | null
  totalCost?: number | null
  totalTokens?: number | null
}

/** Full session detail — the session + its traces. */
export type EvalSessionDetail = { session: EvalSession; traces: Trace[] }

// ── the eval-orchestration client ─────────────────────────────────────────────
// SCOPE: this is the /v1/evals eval-ARTIFACT SDK — datasets, evaluators, runs,
// rubrics, scores, AND the eval-domain trace/observation/session reads (which
// carry the eval cost/token/score joins raw OTel spans lack). It is NOT the Observe
// console read plane: as of the gen_ai observation-of-record flip,
// O11yApi.traces/observations/sessions read the o11y SPAN plane (/v1/o11y), NOT these.
// The five eval trace/observation/session readers below are a RETAINED SDK surface (a
// real, currently-unwired eval-domain capability, 0 non-test refs) — do NOT re-wire
// them into O11yApi (that reintroduces the duplicate Observe read the flip removed).
// O11yApi.scores/scoreConfigs DO still delegate here — scores stay eval artifacts.

export const EvalsApi = {
  // ---- eval-domain traces + trace-detail tree (RETAINED SDK, not the Observe plane) ----
  /** List traces (newest first). Backed today; enrichment columns may be null. */
  listTraces: async (q: { runName?: string; datasetName?: string; limit?: number } = {}): Promise<Trace[]> => {
    const res = await restGet<{ data?: TraceWire[] }>(url('traces', q))
    return rows<TraceWire>(res).map(toTrace)
  },
  /**
   * Trace detail — the trace + its observation TREE + its scores (the crown-jewel
   * span-tree/waterfall). BE GAP until the ai-store read-through is bound; the
   * module renders an honest state on 404/503, never a fabricated tree.
   */
  getTrace: async (id: string): Promise<TraceDetail> => {
    const res = await restGet<{ trace?: TraceWire; observations?: ObservationWire[]; scores?: ScoreWire[] } & TraceWire>(
      url(`traces/${encodeURIComponent(id)}`),
    )
    // Never synthesize a hollow trace from a 200-empty — a missing trace is an
    // honest not-found the module renders as a BackendStateCard.
    const base = res.trace ?? (res as TraceWire)
    if (!base || !base.id) throw new ApiError('trace not found', 404)
    return {
      ...toTrace(base),
      observations: (res.observations ?? []).map(toObservation),
      scores: (res.scores ?? []).map(toScore),
    }
  },

  // ---- eval-domain observations (RETAINED SDK, not the Observe plane) --------
  /** List observations (generations/spans). BE GAP until bound. */
  listObservations: async (q: { traceId?: string; type?: string; limit?: number } = {}): Promise<Observation[]> => {
    const res = await restGet<{ data?: ObservationWire[] }>(url('observations', q))
    return rows<ObservationWire>(res).map(toObservation)
  },

  // ---- eval-domain sessions (RETAINED SDK, not the Observe plane) ------------
  /** List sessions (traces grouped by session id, with rollups). BE GAP until bound. */
  listSessions: async (q: { limit?: number } = {}): Promise<EvalSession[]> => {
    const res = await restGet<{ data?: EvalSession[] }>(url('sessions', q))
    return rows<EvalSession>(res)
  },
  /** Session detail — the session + its traces. BE GAP until bound. */
  session: async (id: string): Promise<EvalSessionDetail> => {
    const res = await restGet<{ session?: EvalSession; traces?: TraceWire[] } & EvalSession>(
      url(`sessions/${encodeURIComponent(id)}`),
    )
    const base: EvalSession = res.session ?? (res as EvalSession)
    if (!base || !base.id) throw new ApiError('session not found', 404)
    return { session: base, traces: (res.traces ?? []).map(toTrace) }
  },

  // ---- scores + rubrics (Observe · Scores) ----------------------------------
  /** List scores as canonical Score[] (for the scores table + metrics folds). */
  listScoresTyped: async (
    q: { name?: string; runName?: string; traceId?: string; limit?: number } = {},
  ): Promise<Score[]> => {
    const res = await restGet<{ data?: ScoreWire[] }>(url('scores', q))
    return rows<ScoreWire>(res).map(toScore)
  },
  /** Legacy score-page shape kept for EvalScoresView. */
  listScores: async (query?: { name?: string; limit?: number; page?: number }): Promise<EvalScoresPage> => {
    const res = await restGet<{ data?: EvalScore[] }>(url('scores', { name: query?.name, limit: query?.limit }))
    return { data: rows<EvalScore>(res) }
  },
  listScoreConfigs: async (): Promise<EvalScoreConfig[]> => {
    const res = await restGet<{ data?: EvalScoreConfig[] }>(url('rubrics'))
    return rows<EvalScoreConfig>(res)
  },
  createScoreConfig: (body: CreateScoreConfigBody): Promise<EvalScoreConfig> =>
    restPost<EvalScoreConfig>(url('rubrics'), body),

  // ---- datasets + items (Observe · Datasets) --------------------------------
  listDatasets: async (): Promise<EvalDataset[]> => {
    const res = await restGet<{ data?: EvalDataset[] }>(url('datasets'))
    return rows<EvalDataset>(res)
  },
  getDataset: (name: string): Promise<EvalDataset> => restGet<EvalDataset>(url(`datasets/${encodeURIComponent(name)}`)),
  createDataset: (body: CreateDatasetBody): Promise<EvalDataset> => restPost<EvalDataset>(url('datasets'), body),
  deleteDataset: (name: string): Promise<void> => restDelete(url(`datasets/${encodeURIComponent(name)}`)),
  listDatasetItems: async (datasetName: string, limit?: number): Promise<EvalDatasetItem[]> => {
    const res = await restGet<{ data?: EvalDatasetItem[] }>(
      url(`datasets/${encodeURIComponent(datasetName)}/items`, { limit }),
    )
    return rows<EvalDatasetItem>(res)
  },
  createDatasetItem: (datasetName: string, body: CreateDatasetItemBody): Promise<EvalDatasetItem> =>
    restPost<EvalDatasetItem>(url(`datasets/${encodeURIComponent(datasetName)}/items`), body),

  // ---- evaluators -----------------------------------------------------------
  listEvaluators: async (): Promise<EvalEvaluator[]> => {
    const res = await restGet<{ data?: EvalEvaluator[] }>(url('evaluators'))
    return rows<EvalEvaluator>(res)
  },
  createEvaluator: (body: CreateEvaluatorBody): Promise<EvalEvaluator> =>
    restPost<EvalEvaluator>(url('evaluators'), body),

  // ---- runs / experiments (Observe · Experiments) ---------------------------
  listRuns: async (datasetName?: string): Promise<EvalDatasetRun[]> => {
    const res = await restGet<{ data?: EvalDatasetRun[] }>(url('runs', { datasetName }))
    return rows<EvalDatasetRun>(res)
  },
  run: (req: EvalRunRequest): Promise<EvalRunSummary> => restPost<EvalRunSummary>(url('runs'), req),
}
