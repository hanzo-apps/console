/**
 * Interactive Training API — the ENGINE plane (hanzo engine `/v1/training/*`), the
 * live-in-memory Tinker-style surface: a LoRA training client you create, drive with
 * forward_backward + optim_step, sample from, and save a PEFT adapter out of. Distinct
 * from `train.ts` (the CLOUD jobs plane — k8s TrainJobs). The browser calls the clean,
 * prefix-free `/v1/training/*` (the /v1-first law); `next.config.mjs` dispatches the
 * `training` head to the keyless `/ai` bearer proxy (`app/ai/[...path]/route.ts`), which
 * mints a short-lived user-bound token and forwards to the gateway — no key in the browser.
 *
 * Wire contract (all `/v1`):
 *   POST   /v1/training/clients                         create a client (base_model + lora)
 *   GET    /v1/training/clients                         list → {clients:[Info]}
 *   GET    /v1/training/clients/{id}                    one Info + {loss_history:[number]}
 *   DELETE /v1/training/clients/{id}                    drop → {id,deleted:true}
 *   POST   /v1/training/clients/{id}/forward_backward   accumulate grads → {loss,num_tokens,metrics}
 *   POST   /v1/training/clients/{id}/optim_step         apply Adam step   → {optim_steps}
 *   POST   /v1/training/clients/{id}/sample             sample text       → {sequences:[{tokens,text}]}
 *   POST   /v1/training/clients/{id}/save_weights       export adapter    → {path,format:"peft"}
 *
 * Errors are honest: the engine answers 400/404/409 with a plain-text reason, streamed
 * through the proxy verbatim; `restGet`/`restPost`/`restDelete` throw `ApiError` carrying
 * that text (status preserved), so a caller surfaces the real reason — never a fake row.
 * Every field is normalized tolerantly (snake_case canonical, camelCase accepted): an
 * upstream rename degrades a cell, never the page.
 */
import { restGet, restPost, restDelete, originV1Url } from './client'

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined
const numArray = (v: unknown): number[] => (Array.isArray(v) ? v.map(num).filter((n): n is number => typeof n === 'number') : [])

/** First array found: a named key, a casibase `{data:[...]}`, or a bare array. */
function arrayOf(payload: unknown, keys: string[]): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[]
  const o = rec(payload)
  for (const k of keys) if (Array.isArray(o[k])) return o[k] as Record<string, unknown>[]
  if (Array.isArray(o.data)) return o.data as Record<string, unknown>[]
  return []
}

// ── The 7 Llama projection targets a LoRA adapter attaches to (attention + MLP). ─────
export const LLAMA_TARGET_MODULES = ['q_proj', 'k_proj', 'v_proj', 'o_proj', 'gate_proj', 'up_proj', 'down_proj'] as const

/** Default LoRA hyperparameters for a new client. */
export const DEFAULT_LORA = { rank: 16, alpha: 32.0, target_modules: [...LLAMA_TARGET_MODULES] as string[] }

// ── Types (tolerant; response fields optional-safe) ──────────────────────────────────

export type LoraConfig = { rank: number; alpha: number; target_modules: string[] }

export type TrainingClientStatus = 'loading' | 'ready' | 'failed' | (string & {})

export type TrainingClientInfo = {
  id: string
  base_model: string
  status: TrainingClientStatus
  error?: string
  lora_config: LoraConfig
  trainable_params?: number
  forward_backward_calls: number
  optim_steps: number
  last_loss?: number
}

/** A client's full state — its Info plus the accumulated per-step loss curve. */
export type TrainingClientDetail = TrainingClientInfo & { loss_history: number[] }

/** One training datum: a prompt→completion pair, OR pre-tokenized input + targets (+ weights). */
export type PromptCompletion = { prompt: string; completion: string }
export type TokenDatum = { model_input: { tokens: number[] }; target_tokens: number[]; weights?: number[] }
export type Datum = PromptCompletion | TokenDatum

export type ForwardBackwardResult = { loss?: number; num_tokens?: number; metrics: Record<string, number> }
export type OptimStepResult = { optim_steps: number }

/** Adam optimizer step params — `lr` is required; the rest ride through as given. */
export type AdamParams = { lr: number; beta1?: number; beta2?: number; eps?: number; weight_decay?: number }

export type SamplingParams = {
  max_tokens?: number
  temperature?: number
  top_k?: number
  top_p?: number
  seed?: number
  stop_tokens?: number[]
}
/** Sample from a prompt XOR pre-tokenized `tokens` (never both). */
export type SampleInput = { prompt?: string; tokens?: number[]; sampling_params?: SamplingParams; num_samples?: number }
export type SampleSequence = { tokens: number[]; text: string }
export type SampleResult = { sequences: SampleSequence[] }

export type SaveWeightsResult = { path: string; format: string }

export type CreateClientInput = { base_model: string; rank?: number; alpha?: number; target_modules?: string[] }

// ── Normalizers (exported for direct unit tests) ─────────────────────────────────────

export function normLoraConfig(v: unknown): LoraConfig {
  const o = rec(v)
  const tm = Array.isArray(o.target_modules) ? o.target_modules : Array.isArray(o.targetModules) ? o.targetModules : []
  return {
    rank: num(o.rank) ?? num(o.r) ?? DEFAULT_LORA.rank,
    alpha: num(o.alpha) ?? num(o.lora_alpha) ?? DEFAULT_LORA.alpha,
    target_modules: tm.map(String).filter(Boolean),
  }
}

export function normClientInfo(v: unknown, i = 0): TrainingClientInfo {
  const r = rec(v)
  return {
    id: str(r.id) ?? str(r.client_id) ?? str(r.clientId) ?? `client-${i}`,
    base_model: str(r.base_model) ?? str(r.baseModel) ?? str(r.model) ?? '',
    status: (str(r.status) ?? str(r.state) ?? 'loading') as TrainingClientStatus,
    error: str(r.error) ?? str(r.message),
    lora_config: normLoraConfig(r.lora_config ?? r.loraConfig),
    trainable_params: num(r.trainable_params) ?? num(r.trainableParams),
    forward_backward_calls: num(r.forward_backward_calls) ?? num(r.forwardBackwardCalls) ?? 0,
    optim_steps: num(r.optim_steps) ?? num(r.optimSteps) ?? 0,
    last_loss: num(r.last_loss) ?? num(r.lastLoss),
  }
}

export function normClientDetail(v: unknown): TrainingClientDetail {
  const r = rec(v)
  return { ...normClientInfo(r), loss_history: numArray(r.loss_history ?? r.lossHistory) }
}

export function normForwardBackward(v: unknown): ForwardBackwardResult {
  const r = rec(v)
  const m = rec(r.metrics)
  const metrics: Record<string, number> = {}
  for (const [k, val] of Object.entries(m)) {
    const n = num(val)
    if (n !== undefined) metrics[k] = n
  }
  return { loss: num(r.loss), num_tokens: num(r.num_tokens) ?? num(r.numTokens), metrics }
}

export function normSampleResult(v: unknown): SampleResult {
  const seqs = arrayOf(v, ['sequences', 'samples', 'completions'])
  return {
    sequences: seqs.map((s) => ({ tokens: numArray(s.tokens), text: str(s.text) ?? str(s.completion) ?? '' })),
  }
}

// ── Calls ─────────────────────────────────────────────────────────────────────────

/** The clean `/v1/training/...` addresses (dispatched to the `/ai` bearer proxy by next.config). */
const clientsUrl = (): string => originV1Url('training/clients')
const clientUrl = (id: string): string => originV1Url(`training/clients/${encodeURIComponent(id)}`)

export const TrainingApi = {
  /** Create a LoRA training client on a base model; it starts `loading` and reports `ready` when warm. */
  create: async (input: CreateClientInput): Promise<TrainingClientInfo> => {
    const body = {
      base_model: input.base_model,
      lora_config: {
        rank: input.rank ?? DEFAULT_LORA.rank,
        alpha: input.alpha ?? DEFAULT_LORA.alpha,
        target_modules: input.target_modules ?? DEFAULT_LORA.target_modules,
      },
    }
    return normClientInfo(await restPost<unknown>(clientsUrl(), body))
  },

  list: async (): Promise<TrainingClientInfo[]> => {
    const r = await restGet<unknown>(clientsUrl())
    return arrayOf(r, ['clients', 'items']).map((c, i) => normClientInfo(c, i))
  },

  get: async (id: string): Promise<TrainingClientDetail> => normClientDetail(await restGet<unknown>(clientUrl(id))),

  remove: (id: string): Promise<void> => restDelete(clientUrl(id)),

  /** Accumulate gradients over one batch (prompt→completion rows or pre-tokenized data). */
  forwardBackward: async (id: string, data: Datum[]): Promise<ForwardBackwardResult> =>
    normForwardBackward(await restPost<unknown>(`${clientUrl(id)}/forward_backward`, { data })),

  /** Apply one Adam optimizer step over the accumulated gradients. */
  optimStep: async (id: string, adam_params: AdamParams): Promise<OptimStepResult> => {
    const r = rec(await restPost<unknown>(`${clientUrl(id)}/optim_step`, { adam_params }))
    return { optim_steps: num(r.optim_steps) ?? num(r.optimSteps) ?? 0 }
  },

  /** Sample completions from the current adapter (prompt XOR pre-tokenized `tokens`). */
  sample: async (id: string, input: SampleInput): Promise<SampleResult> =>
    normSampleResult(await restPost<unknown>(`${clientUrl(id)}/sample`, input)),

  /** Export the trained LoRA adapter to a named PEFT directory. */
  saveWeights: async (id: string, name: string, dir?: string): Promise<SaveWeightsResult> => {
    const r = rec(await restPost<unknown>(`${clientUrl(id)}/save_weights`, dir ? { name, dir } : { name }))
    return { path: str(r.path) ?? '', format: str(r.format) ?? 'peft' }
  },
}
