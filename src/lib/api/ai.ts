/**
 * AI — the ONE console-side AI surface, over `hanzoai/ai` on the cloud `/v1`.
 *
 * There is one AI backend and one gateway binding (`PlaygroundApi`, the
 * OpenAI-compatible `/v1/chat/completions` + `/v1/models`). This module composes
 * that binding into the three intents the console needs, and nothing here is a
 * parallel client:
 *   - `listModels()` — the model ids the gateway accepts (for model selection).
 *   - `chat()`       — a plain completion; returns the assistant text.
 *   - `ragChat()`    — the SAME completion grounded in a knowledge store. RAG is
 *                      built into chat/completions: the `X-Retrieval-Store` header
 *                      turns on retrieval and names the store (`docs` by default);
 *                      the store's org owner is resolved server-side from the
 *                      session, and the backend degrades to a plain answer if the
 *                      store is unreachable. No separate rag endpoint, no client.
 *
 * Every call throws `ApiError` (with status) on failure so callers render an
 * honest state (`classifyBackend`) — never fabricated text.
 */
import { ApiError } from './client'
import { PlaygroundApi, type ChatMessage } from './playground'

/** Cached model id list — resolved once per session for default-model selection. */
let modelsCache: string[] | null = null

async function models(): Promise<string[]> {
  if (modelsCache) return modelsCache
  modelsCache = await PlaygroundApi.listModels()
  return modelsCache
}

/**
 * Resolve the model id to call: an explicit id wins; otherwise the first Zen
 * model the gateway lists, else the first model. Throws when the gateway lists
 * no models so the caller can show "AI unavailable" rather than guess an id.
 */
async function resolveModel(explicit?: string): Promise<string> {
  if (explicit && explicit.trim()) return explicit.trim()
  const ids = await models()
  if (ids.length === 0) throw new ApiError('No models available', 404)
  return ids.find((m) => /zen/i.test(m)) ?? ids[0]
}

/** Read the assistant text from a completion, throwing the gateway's error. */
function answerOf(r: { choices?: { message?: { content?: string } }[]; error?: { message?: string } }): string {
  if (r.error?.message) throw new ApiError(r.error.message)
  return r.choices?.[0]?.message?.content ?? ''
}

export type AiChatInput = {
  /** The user turn. */
  question: string
  /** Optional system instruction prepended to the thread. */
  system?: string
  /** Optional prior turns (oldest first). */
  history?: ChatMessage[]
  /** Optional explicit model id; defaults to a Zen model from the catalog. */
  model?: string
  /** Sampling temperature; defaults to 0 for deterministic console answers. */
  temperature?: number
}

export const AiApi = {
  /** Model ids the gateway accepts. Throws on an unreachable/unauthorized gateway. */
  listModels: (): Promise<string[]> => PlaygroundApi.listModels(),

  /** A plain completion. Returns the assistant text. */
  chat: async ({ question, system, history, model, temperature = 0 }: AiChatInput): Promise<string> => {
    const messages: ChatMessage[] = []
    if (system?.trim()) messages.push({ role: 'system', content: system })
    if (history?.length) messages.push(...history)
    messages.push({ role: 'user', content: question })
    const r = await PlaygroundApi.chat({ model: await resolveModel(model), messages, temperature })
    return answerOf(r)
  },

  /**
   * A completion grounded in a knowledge store (`docs` by default) via the
   * built-in retrieval path — optionally multi-turn (prior `history` is prepended,
   * so the grounded assistant keeps conversation context). Returns the assistant
   * text; any links it cites are the model's own, surfaced by the caller.
   */
  ragChat: async ({
    question,
    store = 'docs',
    model,
    system,
    history,
    temperature = 0,
  }: AiChatInput & { store?: string }): Promise<string> => {
    const messages: ChatMessage[] = []
    if (system?.trim()) messages.push({ role: 'system', content: system })
    if (history?.length) messages.push(...history)
    messages.push({ role: 'user', content: question })
    const r = await PlaygroundApi.chat(
      { model: await resolveModel(model), messages, temperature },
      { 'X-Retrieval': '1', 'X-Retrieval-Store': store },
    )
    return answerOf(r)
  },
}
