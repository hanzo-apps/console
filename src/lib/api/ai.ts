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
import { invalidateBalance } from '~/lib/billing/live-balance'
import { splitSSE, dataOf, parseChatData, streamErrorMessage } from './stream'

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

/** Assemble the OpenAI message thread for a turn (system → history → user). */
function buildThread(question: string, system?: string, history?: ChatMessage[]): ChatMessage[] {
  const messages: ChatMessage[] = []
  if (system?.trim()) messages.push({ role: 'system', content: system })
  if (history?.length) messages.push(...history)
  messages.push({ role: 'user', content: question })
  return messages
}

/**
 * Read a streaming chat-completion `Response` to completion, invoking `onDelta`
 * with the CUMULATIVE text after each content chunk. Throws `ApiError` on a non-ok
 * HTTP response or a mid-stream gateway error (carrying the gateway's message), and
 * always releases the reader on every exit path (no held socket). Pure over its
 * `Response`, so it is unit-tested with a fake SSE stream — no network.
 */
export async function readChatStream(res: Response, onDelta: (text: string) => void): Promise<string> {
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '')
    let msg = `Request failed (HTTP ${res.status})`
    try {
      const j = JSON.parse(text) as { error?: { message?: string }; msg?: string }
      msg = j?.error?.message ?? j?.msg ?? msg
    } catch {
      /* non-JSON error body — keep the status message */
    }
    throw new ApiError(msg, res.status)
  }

  let content = ''
  const consume = (data: string): void => {
    const delta = parseChatData(data)
    if (!delta) return
    if (delta.error) throw new ApiError(delta.error, res.status)
    if (delta.content) {
      content += delta.content
      onDelta(content)
    }
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let raw = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value, { stream: true })
      raw += chunk
      buf += chunk
      const split = splitSSE(buf)
      buf = split.rest
      for (const ev of split.events) {
        const data = dataOf(ev)
        if (data != null) consume(data)
      }
    }
    const tail = dataOf(buf)
    if (tail != null) consume(tail)
  } finally {
    await reader.cancel().catch(() => {})
  }
  // The gateway can answer a 200 with a PLAIN JSON error envelope (not SSE) —
  // e.g. a prompt over the model's context window, or a premium model on a
  // trial balance. That body carries no `data:` events, so the stream yields no
  // content; surface the gateway's real message instead of an empty completion.
  if (content === '') {
    const envelopeError = streamErrorMessage(raw)
    if (envelopeError) throw new ApiError(envelopeError, res.status)
  }
  return content
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
    const r = await PlaygroundApi.chat({
      model: await resolveModel(model),
      messages: buildThread(question, system, history),
      temperature,
    })
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
    const r = await PlaygroundApi.chat(
      { model: await resolveModel(model), messages: buildThread(question, system, history), temperature },
      { 'X-Retrieval': '1', 'X-Retrieval-Store': store },
    )
    return answerOf(r)
  },

  /**
   * The STREAMING twin of `ragChat` — the same grounded completion, but rendered
   * token-by-token: `onDelta` fires with the cumulative text as each chunk arrives
   * (like the playground compare board). Resolves with the final text; throws
   * `ApiError` on failure or a mid-stream gateway error so the caller shows an
   * honest state. `signal` lets the caller cancel (unmount / new chat).
   */
  ragChatStream: async (
    { question, store = 'docs', model, system, history, temperature = 0 }: AiChatInput & { store?: string },
    onDelta: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<string> => {
    const res = await PlaygroundApi.streamChat(
      { model: await resolveModel(model), messages: buildThread(question, system, history), temperature },
      signal,
      { 'X-Retrieval': '1', 'X-Retrieval-Store': store },
    )
    const text = await readChatStream(res, onDelta)
    // A streamed completion just debited cloud credit — nudge the shared live
    // balance so every wallet surface reflects the spend without a reload.
    invalidateBalance()
    return text
  },
}
