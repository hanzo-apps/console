/**
 * Share — encode the composer state into a link and restore it on load.
 *
 * The whole request (mode, model, system prompt, messages, settings) round-trips
 * through ONE URL query param (`?p=`). The payload is JSON, URI-encoded — no
 * server, no shortener, nothing fabricated: opening a shared link reconstructs
 * exactly what the author had. Decoding is defensive (any malformed/partial token
 * yields `null`) so a hand-edited URL can never crash the page.
 */
import { DEFAULT_SETTINGS, type Settings } from './types'

/** A shared composer state — text only (uploaded images are not part of a link). */
export type ShareState = {
  mode: 'chat' | 'completions'
  model: string
  system: string
  messages: { role: 'user' | 'assistant'; content: string }[]
  settings: Settings
}

/** The query parameter a shared link uses. */
export const SHARE_PARAM = 'p'

/** Encode a composer state into the value for `?p=` (URI-safe). */
export function encodeShare(s: ShareState): string {
  return encodeURIComponent(JSON.stringify(s))
}

/**
 * The ONE way to deep-link into the Playground preselected on a model — a
 * `/playground?p=…` path carrying a minimal share state (just the model; empty
 * prompt/messages, default settings). Any surface that offers "try this model in the
 * playground" (the model catalog, the marketplace) uses this so the target model
 * always arrives selected. PURE (no window/router); the caller navigates the path.
 */
export function playgroundPathForModel(modelId: string): string {
  const state: ShareState = { mode: 'chat', model: modelId, system: '', messages: [], settings: DEFAULT_SETTINGS }
  return `/playground?${SHARE_PARAM}=${encodeShare(state)}`
}

/** Decode a `?p=` token back into a composer state, or `null` when invalid. */
export function decodeShare(token: string): ShareState | null {
  if (!token) return null
  let raw: unknown
  try {
    raw = JSON.parse(decodeURIComponent(token))
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const mode = o.mode === 'completions' ? 'completions' : 'chat'
  const model = typeof o.model === 'string' ? o.model : ''
  const system = typeof o.system === 'string' ? o.system : ''
  const messages = Array.isArray(o.messages)
    ? o.messages
        .filter((m): m is { role: unknown; content: unknown } => !!m && typeof m === 'object')
        .map((m) => ({
          role: (m as { role?: unknown }).role === 'assistant' ? ('assistant' as const) : ('user' as const),
          content: typeof (m as { content?: unknown }).content === 'string' ? ((m as { content: string }).content) : '',
        }))
    : []
  const so = (o.settings && typeof o.settings === 'object' ? o.settings : {}) as Partial<Settings>
  const settings: Settings = {
    temperature: numOr(so.temperature, DEFAULT_SETTINGS.temperature),
    topP: numOr(so.topP, DEFAULT_SETTINGS.topP),
    maxTokens: typeof so.maxTokens === 'string' ? so.maxTokens : DEFAULT_SETTINGS.maxTokens,
    stop: typeof so.stop === 'string' ? so.stop : DEFAULT_SETTINGS.stop,
    frequencyPenalty: numOr(so.frequencyPenalty, DEFAULT_SETTINGS.frequencyPenalty),
    presencePenalty: numOr(so.presencePenalty, DEFAULT_SETTINGS.presencePenalty),
    seed: typeof so.seed === 'string' ? so.seed : DEFAULT_SETTINGS.seed,
  }
  return { mode, model, system, messages, settings }
}

function numOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}
