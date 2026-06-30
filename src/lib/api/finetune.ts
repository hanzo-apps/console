/**
 * Typed client for the cloud fine-tuning broker, reached through the console's OWN
 * same-origin `/training` proxy (`app/training/[...path]/route.ts`), which forwards
 * to hanzoai/ai `/v1/finetune/*` with the session cookie. The browser holds no
 * key and never calls the backend directly.
 *
 * The broker speaks the casibase `{ status, msg, data }` envelope (it is the same
 * Go server as the rest of `/v1`), so — unlike a plain-REST sub-service — we unwrap
 * `data` here and throw `ApiError` on a non-ok envelope, including the backend's
 * HTTP-200-with-`status:"error"` shape (Beego's ServeJSON never sets a 4xx for a
 * logical error). One place owns that unwrap so every call site gets the payload or
 * a typed failure.
 */
import { restGet, restPost, ApiError } from './client'

/** Base of the same-origin training proxy (`<origin>/training`). */
const trainingBase = (): string =>
  typeof window !== 'undefined' ? `${window.location.origin}/training` : '/training'

type Query = Record<string, string | number | boolean | undefined | null>

const trainingUrl = (path: string, query?: Query): string => {
  const base = `${trainingBase()}/${path.replace(/^\/+/, '')}`
  if (!query) return base
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v))
  }
  const s = qs.toString()
  return s ? `${base}?${s}` : base
}

type Envelope<T> = { status: 'ok' | 'error'; msg: string; data: T }

function unwrap<T>(env: Envelope<T> | undefined): T {
  if (!env || env.status !== 'ok') {
    throw new ApiError(env?.msg || 'Request failed')
  }
  return env.data
}

// ── Types (mirror object/finetune_*.go JSON) ────────────────────────────────

export type FinetuneStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

export type Hyperparams = {
  epochs: number
  learningRate: number
  batchSize: number
  gradAccum: number
  maxSeqLen: number
  loraRank: number
  loraAlpha: number
  loraDropout: number
  quant4bit: boolean
  gradientCheckpointing: boolean
  warmupRatio: number
  weightDecay: number
}

export type FinetuneJob = {
  owner: string
  name: string
  createdTime?: string
  updatedTime?: string
  createdBy?: string
  displayName?: string
  baseModel?: string
  method?: string
  task?: string
  dataset?: string
  preset?: string
  hyperparams?: string
  runtime?: string
  gpuType?: string
  gpuCount?: number
  numNodes?: number
  namespace?: string
  crName?: string
  status?: FinetuneStatus
  progress?: number
  message?: string
  outputUri?: string
  deployedModel?: string
  deployUrl?: string
  gpuSeconds?: number
  costCents?: number
  startedTime?: string
  finishedTime?: string
  metered?: boolean
  error?: string
}

export type HfModel = {
  id: string
  downloads?: number
  likes?: number
  tags?: string[]
  pipeline_tag?: string
  library_name?: string
  private?: boolean
  gated?: boolean | string
  lastModified?: string
}

export type HfDataset = {
  id: string
  downloads?: number
  likes?: number
  tags?: string[]
  private?: boolean
  gated?: boolean | string
  lastModified?: string
}

export type HfRepoInfo = {
  id: string
  tags?: string[]
  pipeline_tag?: string
  downloads?: number
  likes?: number
  private?: boolean
  gated?: boolean | string
  siblings?: { rfilename: string; size?: number }[]
  lastModified?: string
}

export type BaseModelInfo = {
  id: string
  displayName: string
  family: string
  paramsB: number
  note?: string
}

export type MethodInfo = { id: string; displayName: string; description: string }
export type GpuOption = { type: string; displayName: string; memory: string; hourlyCents: number }

export type FinetuneCatalog = {
  baseModels: BaseModelInfo[]
  methods: MethodInfo[]
  tasks: string[]
  presets: string[]
  gpus: GpuOption[]
}

export type FinetuneRecommendation = {
  runtime: string
  hyperparams: Hyperparams
  gpuType: string
  gpuCount: number
  numNodes: number
  paramsB: number
  estMinutes: number
  estCostCents: number
}

export type CreateFinetuneInput = {
  displayName?: string
  baseModel: string
  method: string
  task?: string
  dataset: string
  preset?: string
  hyperparams?: Hyperparams
  gpuType?: string
  gpuCount?: number
  numNodes?: number
  datasetExamples?: number
}

export type DeployResult = {
  modelId: string
  provider: string
  service: string
  namespace: string
  url: string
}

// ── Calls ───────────────────────────────────────────────────────────────────

export const FinetuneApi = {
  listJobs: async (): Promise<FinetuneJob[]> =>
    unwrap(await restGet<Envelope<FinetuneJob[]>>(trainingUrl('jobs'))) ?? [],

  getJob: async (name: string): Promise<FinetuneJob> =>
    unwrap(await restGet<Envelope<FinetuneJob>>(trainingUrl('job', { name }))),

  createJob: async (input: CreateFinetuneInput): Promise<FinetuneJob> =>
    unwrap(await restPost<Envelope<FinetuneJob>>(trainingUrl('jobs'), input)),

  cancelJob: async (name: string): Promise<FinetuneJob> =>
    unwrap(await restPost<Envelope<FinetuneJob>>(trainingUrl('cancel', { name }))),

  deployJob: async (name: string): Promise<DeployResult> =>
    unwrap(await restPost<Envelope<DeployResult>>(trainingUrl('deploy', { name }))),

  catalog: async (): Promise<{ catalog: FinetuneCatalog; recommendation?: FinetuneRecommendation }> =>
    unwrap(
      await restGet<Envelope<{ catalog: FinetuneCatalog; recommendation?: FinetuneRecommendation }>>(
        trainingUrl('presets'),
      ),
    ),

  recommend: async (q: {
    baseModel: string
    method?: string
    task?: string
    preset?: string
    datasetExamples?: number
  }): Promise<{ catalog: FinetuneCatalog; recommendation: FinetuneRecommendation }> =>
    unwrap(
      await restGet<Envelope<{ catalog: FinetuneCatalog; recommendation: FinetuneRecommendation }>>(
        trainingUrl('presets', q),
      ),
    ),

  searchModels: async (q: string, task?: string, limit = 30): Promise<HfModel[]> =>
    unwrap(await restGet<Envelope<HfModel[]>>(trainingUrl('hf/models', { q, task, limit }))) ?? [],

  searchDatasets: async (q: string, limit = 30): Promise<HfDataset[]> =>
    unwrap(await restGet<Envelope<HfDataset[]>>(trainingUrl('hf/datasets', { q, limit }))) ?? [],

  getRepo: async (id: string, kind: 'model' | 'dataset' = 'model'): Promise<HfRepoInfo> =>
    unwrap(await restGet<Envelope<HfRepoInfo>>(trainingUrl('hf/repo', { id, kind }))),
}
