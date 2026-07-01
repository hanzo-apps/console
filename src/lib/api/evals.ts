/**
 * Evals API — the Hanzo Cloud `/v1/evals/*` facade (cloud `clients/evalsvc`).
 *
 * This is a thin composition over two systems that already work: the console
 * eval engine (datasets / dataset-items / evaluators / scores) and the model
 * gateway (chat completions, used by the run orchestrator). The surface that is
 * actually mounted at the gateway is small and HONEST — only these routes exist:
 *
 *   - POST /v1/evals/datasets        create a dataset            (verbatim proxy)
 *   - POST /v1/evals/dataset-items   add an item to a dataset    (verbatim proxy)
 *   - POST /v1/evals/evaluators      register an evaluator       (verbatim proxy)
 *   - GET  /v1/evals/scores          list scores                 (verbatim proxy)
 *   - POST /v1/evals/runs            run a dataset against a model + LLM judge
 *
 * There is no list endpoint for datasets/items/evaluators at this gateway; the
 * modules attempt the forward-compatible GET and render an honest "not available
 * here yet" state on 404/405 rather than fabricating rows.
 *
 * All routes are raw JSON (the proxied console public API / the orchestrator's
 * own JSON), so they use the REST layer, not the casibase envelope.
 */
import { restGet, restPost, v1Url } from './client'

/** A score row (Langfuse v2 score shape; only the surfaced fields are typed). */
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
  timestamp?: string
  createdAt?: string
}

/** Paged list envelope returned by the console public API. */
export type EvalScoresPage = {
  data: EvalScore[]
  meta?: { page?: number; limit?: number; totalItems?: number; totalPages?: number }
}

/** A dataset (Langfuse v2 dataset shape) — used by the forward-compatible list. */
export type EvalDataset = {
  id?: string
  name: string
  description?: string
  metadata?: unknown
  createdAt?: string
  updatedAt?: string
}

/** A dataset item (input/expected-output pair) used by eval runs. */
export type EvalDatasetItem = {
  id?: string
  datasetName?: string
  input?: unknown
  expectedOutput?: unknown
  metadata?: unknown
  createdAt?: string
}

/** A dataset run / experiment row returned by the forward-compatible read API. */
export type EvalDatasetRun = {
  id?: string
  name?: string
  datasetName?: string
  model?: string
  status?: string
  score?: number
  createdAt?: string
  updatedAt?: string
}

/** One per-item result from a run (mirrors evalsvc `itemResult`). */
export type EvalItemResult = {
  itemId: string
  traceId?: string
  score: number
  output?: string
  error?: string
}

/** The summary returned by POST /v1/evals/runs (mirrors evalsvc `runSummary`). */
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

/** Run request (mirrors evalsvc `runRequest`). */
export type EvalRunRequest = {
  dataset: string
  model: string
  runName?: string
  limit?: number
  judge?: { model?: string; criteria?: string; name?: string }
}

/** Create-dataset body (the cloud `/v1/evals/datasets` facade). */
export type CreateDatasetBody = { name: string; description?: string; metadata?: unknown }

/** Create-dataset-item body (the cloud `/v1/evals/dataset-items` facade). */
export type CreateDatasetItemBody = {
  datasetName: string
  input?: unknown
  expectedOutput?: unknown
  metadata?: unknown
}

export const EvalsApi = {
  /** List scores; throws `ApiError` (with status) on an unreachable backend. */
  listScores: (query?: { name?: string; limit?: number; page?: number }): Promise<EvalScoresPage> => {
    const url = new URL(v1Url('evals/scores'))
    if (query?.name) url.searchParams.set('name', query.name)
    if (query?.limit) url.searchParams.set('limit', String(query.limit))
    if (query?.page) url.searchParams.set('page', String(query.page))
    return restGet<EvalScoresPage>(url.toString())
  },

  /** Run a dataset against a model with an LLM-as-judge; returns a real summary. */
  run: (req: EvalRunRequest): Promise<EvalRunSummary> =>
    restPost<EvalRunSummary>(v1Url('evals/runs'), req),

  /** Create a dataset (verbatim proxy to the console). Returns the created row. */
  createDataset: (body: CreateDatasetBody): Promise<EvalDataset> =>
    restPost<EvalDataset>(v1Url('evals/datasets'), body),

  /** Add an item to a dataset (verbatim proxy to the console). */
  createDatasetItem: (body: CreateDatasetItemBody): Promise<unknown> =>
    restPost<unknown>(v1Url('evals/dataset-items'), body),

  /** Register an evaluator (verbatim proxy to the console; unstable API). */
  createEvaluator: (body: unknown): Promise<unknown> =>
    restPost<unknown>(v1Url('evals/evaluators'), body),

  /**
   * Forward-compatible dataset list. The gateway does not mount GET datasets
   * today, so this 404/405s; the module renders an honest unavailable state and
   * lights up automatically if/when the read route lands.
   */
  listDatasets: (): Promise<{ data?: EvalDataset[] } | EvalDataset[]> =>
    restGet<{ data?: EvalDataset[] } | EvalDataset[]>(v1Url('evals/datasets')),

  /** Forward-compatible dataset item list. */
  listDatasetItems: (): Promise<{ data?: EvalDatasetItem[] } | EvalDatasetItem[]> =>
    restGet<{ data?: EvalDatasetItem[] } | EvalDatasetItem[]>(v1Url('evals/dataset-items')),

  /** Forward-compatible dataset run / experiment list. */
  listDatasetRuns: (): Promise<{ data?: EvalDatasetRun[] } | EvalDatasetRun[]> =>
    restGet<{ data?: EvalDatasetRun[] } | EvalDatasetRun[]>(v1Url('evals/dataset-runs')),
}
