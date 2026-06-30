/**
 * Playground feature types — the shape of a compare run.
 *
 * A "compare" is just N model columns sharing ONE prompt; a single-model run is
 * N = 1, the same engine with one column. Each column carries its own model,
 * optional per-column settings, and its own live result (streamed text + REAL
 * token usage + latency + an honest error), so one column erroring or being
 * stopped never disturbs the others.
 */
import type { ChatUsage, ModelPricing } from '~/lib/api'
import type { BackendState } from '~/components/ui/BackendState'

/** Sampling settings shared across columns (or overridden per column). */
export type Settings = {
  temperature: number
  topP: number
  /** Free-text so the field can be empty (= gateway default). */
  maxTokens: string
  /** Comma-separated stop sequences; '' = none. */
  stop: string
}

export const DEFAULT_SETTINGS: Settings = { temperature: 0.7, topP: 1, maxTokens: '1024', stop: '' }

/** A multimodal content part (Vision tab) — text or an image URL. */
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

/** One message in a run; content is plain text OR multimodal parts. */
export type RunMessage = { role: 'system' | 'user' | 'assistant'; content: string | ContentPart[] }

/** Lifecycle of a single column's run. */
export type RunPhase = 'idle' | 'streaming' | 'done' | 'error'

/** The live state of one model column. */
export type Column = {
  /** Stable id (so React keys + in-flight aborts survive model edits). */
  id: string
  model: string
  /** Per-column settings override; null = use the shared settings. */
  settings: Settings | null
  phase: RunPhase
  /** Streamed text so far. */
  content: string
  /** Real token usage from the gateway (null until the usage chunk arrives). */
  usage: ChatUsage | null
  /** Time-to-first-token, ms (null until the first content chunk). */
  ttftMs: number | null
  /** Total wall time, ms (null until the run settles). */
  totalMs: number | null
  /** Honest error for THIS column only. */
  error: BackendState | null
}

/**
 * A raw transport error from the runner — status + message only, no UI semantics.
 * The runner stays pure (gui-free, unit-testable); the UI boundary classifies this
 * into a `BackendState` for display (`classifyBackend`).
 */
export type RunError = { status: number; message: string }

/** The outcome the runner resolves with for one column. */
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
