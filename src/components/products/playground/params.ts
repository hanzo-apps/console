/**
 * Params — turn the composer's `Settings` into the REAL request fields the
 * gateway accepts, or omit them.
 *
 * ONE pure mapping, used by both the run (`runner`) and the request preview
 * (`request-preview`), so the cURL shown is exactly what is sent. A field is
 * included only when it carries a real value: an empty/zero "max tokens", "seed",
 * or penalty becomes `undefined` (the gateway default) rather than a fabricated
 * number — the same honesty rule the rest of the playground follows.
 */
import type { Settings } from './types'

/** The sampling fields a chat completion request carries (OpenAI-compatible). */
export type RunParams = {
  temperature: number
  top_p: number
  max_tokens?: number
  stop?: string[]
  frequency_penalty?: number
  presence_penalty?: number
  seed?: number
}

/** Map composer settings to request params; empty/zero fields are omitted. */
export function paramsOf(s: Settings): RunParams {
  const max = Number(s.maxTokens)
  const stops = s.stop
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
  const seedStr = s.seed.trim()
  const seedNum = Number(seedStr)
  return {
    temperature: s.temperature,
    top_p: s.topP,
    max_tokens: Number.isFinite(max) && max > 0 ? Math.floor(max) : undefined,
    stop: stops.length ? stops : undefined,
    // 0 is the no-op default for the penalties, so only send a non-zero value.
    frequency_penalty: s.frequencyPenalty !== 0 ? s.frequencyPenalty : undefined,
    presence_penalty: s.presencePenalty !== 0 ? s.presencePenalty : undefined,
    // An empty seed field = gateway default; 0 IS a valid seed, so guard on text.
    seed: seedStr !== '' && Number.isFinite(seedNum) ? Math.floor(seedNum) : undefined,
  }
}
