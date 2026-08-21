/**
 * Training API — the cloud fine-tuning broker + model serving (hanzoai/ai
 * `/v1/ai/finetune/*`, `/v1/ml/models`, per HIP-0139), reached through the
 * console's OWN same-origin `/training` proxy (`app/training/[...path]/route.ts`),
 * which forwards the session cookie + active org. The browser holds no key and
 * never calls the backend directly.
 *
 * Endpoints:
 *   - GET/POST /v1/ai/finetune/jobs   — list / create training jobs. POST persists
 *     the job and submits a real TrainJob CR; it is billing-gated by the
 *     ResourceMeter → 402 on an unfunded org (surfaced honestly).
 *   - GET      /v1/ml/models          — the org's trained/registered models.
 *
 * Tolerant by construction: the exact success envelope isn't pinned, so we accept
 * a casibase `{data}` wrap, a named-key object (`{jobs}`/`{models}`), or a bare
 * array — and each field is normalized with fallbacks. A rename upstream degrades
 * a cell, never the page. Nothing is fabricated: an unreachable/empty endpoint
 * yields an honest empty/backend-state, never demo rows.
 */
import { restGet, restPost } from './client'

const trainingBase = (): string =>
  typeof window !== 'undefined' ? `${window.location.origin}/training` : '/training'

type Query = Record<string, string | number | boolean | undefined | null>

const trainUrl = (path: string, query?: Query): string => {
  const base = `${trainingBase()}/${path.replace(/^\/+/, '')}`
  if (!query) return base
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v))
  const s = qs.toString()
  return s ? `${base}?${s}` : base
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined

/** First array found: a bare array, a casibase `{data:[...]}`, or a named key. */
function arrayOf(payload: unknown, keys: string[]): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[]
  const o = rec(payload)
  if (Array.isArray(o.data)) return o.data as Record<string, unknown>[]
  for (const k of keys) if (Array.isArray(o[k])) return o[k] as Record<string, unknown>[]
  return []
}

/** One object: a casibase `{data:{...}}` wrap, else the payload itself. */
function objectOf(payload: unknown): Record<string, unknown> {
  const o = rec(payload)
  return rec(o.data) && Object.keys(rec(o.data)).length ? rec(o.data) : o
}

// ── Types (tolerant; all fields optional-safe) ───────────────────────────────

export type TrainStatus = 'queued' | 'pending' | 'training' | 'running' | 'completed' | 'succeeded' | 'failed' | 'cancelled' | (string & {})

export type TrainJob = {
  id: string
  name?: string
  baseModel?: string
  outputModel?: string
  version?: string
  /** Training method: Fine-tune / LoRA / QLoRA / Full. */
  type?: string
  dataset?: string
  datasetSamples?: number
  status: TrainStatus
  /** 0–100. */
  progress?: number
  gpu?: string
  gpuCount?: number
  costCents?: number
  createdAt?: string
}

export type MlModel = {
  id: string
  name?: string
  baseModel?: string
  status?: string
  params?: string
  createdAt?: string
}

export type CreateTrainJobInput = {
  baseModel: string
  type: string
  dataset: string
  hyperparams?: { learningRate?: number; batchSize?: number; epochs?: number; preset?: string }
  gpu?: string
  gpuCount?: number
}

// ── Normalizers ──────────────────────────────────────────────────────────────

function normJob(r: Record<string, unknown>, i: number): TrainJob {
  return {
    id: str(r.id) ?? str(r.jobId) ?? str(r.name) ?? `job-${i}`,
    name: str(r.name) ?? str(r.displayName),
    baseModel: str(r.baseModel) ?? str(r.base_model) ?? str(r.model),
    outputModel: str(r.outputModel) ?? str(r.output_model) ?? str(r.deployedModel),
    version: str(r.version) ?? str(r.tag),
    type: str(r.type) ?? str(r.method) ?? str(r.trainingType),
    dataset: str(r.dataset) ?? str(r.datasetId) ?? str(r.dataset_name),
    datasetSamples: num(r.datasetSamples) ?? num(r.datasetExamples) ?? num(r.samples) ?? num(r.numExamples),
    status: (str(r.status) ?? str(r.state) ?? 'unknown') as TrainStatus,
    progress: num(r.progress) ?? num(r.percent) ?? num(r.progressPct),
    gpu: str(r.gpu) ?? str(r.gpuType) ?? str(r.accelerator),
    gpuCount: num(r.gpuCount) ?? num(r.numGpus) ?? num(r.gpus),
    costCents: num(r.costCents) ?? num(r.cost_cents) ?? (num(r.cost) !== undefined ? Math.round((num(r.cost) as number) * 100) : undefined),
    createdAt: str(r.createdAt) ?? str(r.createdTime) ?? str(r.created_at) ?? str(r.startedTime),
  }
}

function normModel(r: Record<string, unknown>, i: number): MlModel {
  return {
    id: str(r.id) ?? str(r.modelId) ?? str(r.name) ?? `model-${i}`,
    name: str(r.name) ?? str(r.displayName) ?? str(r.id),
    baseModel: str(r.baseModel) ?? str(r.base_model),
    status: str(r.status) ?? str(r.state),
    params: str(r.params) ?? str(r.parameters) ?? str(r.size),
    createdAt: str(r.createdAt) ?? str(r.createdTime),
  }
}

// ── Calls ─────────────────────────────────────────────────────────────────────

export const TrainApi = {
  listJobs: async (): Promise<TrainJob[]> => {
    const r = await restGet<unknown>(trainUrl('ai/finetune/jobs'))
    return arrayOf(r, ['jobs', 'items']).map(normJob)
  },

  /** Create a training job. Throws ApiError(402) when the ResourceMeter gate blocks. */
  createJob: async (input: CreateTrainJobInput): Promise<TrainJob> => {
    const r = await restPost<unknown>(trainUrl('ai/finetune/jobs'), input)
    return normJob(objectOf(r), 0)
  },

  models: async (): Promise<MlModel[]> => {
    const r = await restGet<unknown>(trainUrl('ml/models'))
    return arrayOf(r, ['models', 'items']).map(normModel)
  },
}

// ── Static option catalogs (UI inputs, not backend-fetched) ──────────────────

/** Training methods offered in the New-job panel. */
export const TRAIN_TYPES = [
  { id: 'lora', label: 'Fine-tune · LoRA' },
  { id: 'qlora', label: 'Fine-tune · QLoRA' },
  { id: 'full', label: 'Full fine-tune' },
] as const

/** Hyperparameter presets (client-side starting points). */
export const TRAIN_PRESETS = ['balanced', 'fast', 'quality'] as const

/** GPU compute options with real hourly rates (DO GPU Droplet resale pricing, cents/hr). */
export const TRAIN_GPUS = [
  { id: 'l40s-1x', label: 'L40S ×1', gpu: 'L40S', gpuCount: 1, hourlyCents: 179 },
  { id: 'a100-1x', label: 'A100 80GB ×1', gpu: 'A100', gpuCount: 1, hourlyCents: 319 },
  { id: 'h100-1x', label: 'H100 80GB ×1', gpu: 'H100', gpuCount: 1, hourlyCents: 449 },
  { id: 'h100-8x', label: 'H100 80GB ×8', gpu: 'H100', gpuCount: 8, hourlyCents: 3499 },
] as const
