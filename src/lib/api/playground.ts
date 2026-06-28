/**
 * Playground API — the OpenAI-compatible model gateway on the cloud `/v1`.
 *
 * Two REAL endpoints, both raw OpenAI JSON (NOT the casibase envelope), so they
 * go through the REST layer (`restGet`/`restPost`), like the o11y probe:
 *   - GET  /v1/models            → the model catalog (ids the gateway accepts)
 *   - POST /v1/chat/completions  → run a non-streaming chat completion
 *
 * No prompt/playground logic is reimplemented server-side — the gateway IS the
 * runtime. The module composes messages and reads the real completion back.
 */
import { restGet, restPost, v1Url } from './client'

/** One OpenAI chat message. */
export type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** Token usage reported by the gateway, when present. */
export type ChatUsage = {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

/** The raw OpenAI chat-completion response (the fields the playground reads). */
export type ChatCompletion = {
  id?: string
  model?: string
  choices?: { index?: number; message?: { role?: string; content?: string }; finish_reason?: string }[]
  usage?: ChatUsage
  error?: { message?: string }
}

/** Request body for a completion run. */
export type ChatRequest = {
  model: string
  messages: ChatMessage[]
  temperature?: number
  max_tokens?: number
  top_p?: number
}

/** Raw `/v1/models` response (OpenAI list envelope). */
type ModelsResponse = { object?: string; data?: { id?: string; owned_by?: string }[] }

export const PlaygroundApi = {
  /**
   * List model ids the gateway accepts. Returns a de-duplicated, sorted id list;
   * throws `ApiError` (with status) on an unreachable/unauthorized gateway so the
   * module can render an honest state.
   */
  listModels: async (): Promise<string[]> => {
    const r = await restGet<ModelsResponse>(v1Url('models'))
    const ids = (r?.data ?? [])
      .map((m) => m?.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
    return Array.from(new Set(ids)).sort((a, b) => a.localeCompare(b))
  },

  /**
   * Run a non-streaming chat completion against the gateway. Optional `headers`
   * ride the same request — the retrieval/RAG switch (`X-Retrieval-Store`) is the
   * only caller of this today, so RAG and plain chat share ONE gateway binding.
   */
  chat: (req: ChatRequest, headers?: Record<string, string>): Promise<ChatCompletion> =>
    restPost<ChatCompletion>(v1Url('chat/completions'), { ...req, stream: false }, headers),
}
