/**
 * Playground feature types — the shape of a single-model run.
 *
 * A run is one model over an ordered list of chat messages (a system prompt plus
 * one or more user/assistant turns). Each run streams text and reports REAL token
 * usage + latency (time-to-first-token and total) + an honest error, so the
 * Response panel never fabricates a number.
 */
import type { ChatUsage, ModelPricing } from '~/lib/api'

/**
 * Sampling settings for a run. `maxTokens`/`seed` are free text so the field can
 * be empty (= gateway default); the request builder (`paramsOf`) turns them into
 * real numbers or omits them — it never sends a fabricated value.
 */
export type Settings = {
  temperature: number
  topP: number
  /** Free text so the field can be empty (= gateway default). */
  maxTokens: string
  /** Comma-separated stop sequences; '' = none. */
  stop: string
  /** Advanced: penalize token frequency (-2…2). 0 = off (omitted). */
  frequencyPenalty: number
  /** Advanced: penalize token presence (-2…2). 0 = off (omitted). */
  presencePenalty: number
  /** Advanced: deterministic sampling seed; free text, '' = none. */
  seed: string
}

/** The composer's initial settings — mirrors the mockup (temp 0.7, top-p 0.9). */
export const DEFAULT_SETTINGS: Settings = {
  temperature: 0.7,
  topP: 0.9,
  maxTokens: '1024',
  stop: '',
  frequencyPenalty: 0,
  presencePenalty: 0,
  seed: '',
}

/** A multimodal content part (an uploaded image) — text or an image URL. */
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

/** One message in a run; content is plain text OR multimodal parts. */
export type RunMessage = { role: 'system' | 'user' | 'assistant'; content: string | ContentPart[] }

/** Lifecycle of a run. `stopped` = user-aborted (partial text kept). */
export type RunPhase = 'idle' | 'streaming' | 'done' | 'error' | 'stopped'

/**
 * A raw transport error from the runner — status + message only, no UI semantics.
 * The runner stays pure (gui-free, unit-testable); the UI boundary classifies this
 * into a `BackendState` for display (`classifyBackend`).
 */
export type RunError = { status: number; message: string }

/** The outcome the runner resolves with for one run. */
export type RunResult = {
  content: string
  usage: ChatUsage | null
  ttftMs: number | null
  totalMs: number | null
  finishReason: string | null
  /** True when the user stopped the run (partial text kept, not an error). */
  aborted: boolean
  error: RunError | null
}

export type { ModelPricing }
