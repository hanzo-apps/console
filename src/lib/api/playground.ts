/**
 * Playground API — the OpenAI-compatible model gateway, via the keyless AI proxy.
 *
 * Two REAL endpoints, both raw OpenAI JSON (NOT the casibase envelope), so they
 * go through the REST layer (`restGet`/`restPost`), like the o11y probe:
 *   - GET  /v1/models            → the model catalog (ids the gateway accepts)
 *   - POST /v1/chat/completions  → run a non-streaming chat completion
 *
 * These endpoints REQUIRE an `Authorization: Bearer` token (a session cookie is
 * rejected), so the browser does NOT call the gateway directly. It calls its OWN
 * origin at a clean `/v1/*` with NO prefix (`originV1Url` — the CTO one-endpoint
 * form); `next.config.mjs` rewrites the AI heads (models/chat/embeddings/audio) to
 * the console's `/ai` bearer proxy, which resolves the user from the session cookie
 * and forwards with a short-lived user token. ONE place addresses the AI runtime.
 */
import { ApiError, restGet, restPost, originV1Url } from './client'
import { invalidateBalance } from '~/lib/billing/live-balance'

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

/**
 * A chat message whose content is plain text OR multimodal content parts (the
 * OpenAI `[{type:'text'},{type:'image_url'}]` shape the Vision tab sends). Kept
 * permissive (`unknown` content) so one streaming binding serves text and vision.
 */
export type StreamMessage = { role: 'system' | 'user' | 'assistant'; content: unknown }

/** Streaming chat request — `ChatRequest` plus optional stop + advanced sampling. */
export type ChatStreamRequest = {
  model: string
  messages: StreamMessage[]
  temperature?: number
  top_p?: number
  max_tokens?: number
  stop?: string[]
  /** Advanced sampling — sent only when set (omitted = gateway default). */
  frequency_penalty?: number
  presence_penalty?: number
  seed?: number
}

/** Request body for an embeddings run. */
export type EmbeddingsRequest = { model: string; input: string | string[] }

/** The raw OpenAI embeddings response (the fields the playground reads). */
export type EmbeddingsResponse = {
  model?: string
  data?: { index?: number; embedding?: number[] }[]
  usage?: { prompt_tokens?: number; total_tokens?: number }
  error?: { message?: string }
}

/** Request body for a text-to-speech run. */
export type SpeechRequest = { model: string; input: string; voice?: string; response_format?: string }

export const PlaygroundApi = {
  /**
   * List model ids the gateway accepts. Returns a de-duplicated, sorted id list;
   * throws `ApiError` (with status) on an unreachable/unauthorized gateway so the
   * module can render an honest state.
   */
  listModels: async (): Promise<string[]> => {
    const r = await restGet<ModelsResponse>(originV1Url('models'))
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
  chat: async (req: ChatRequest, headers?: Record<string, string>): Promise<ChatCompletion> => {
    const res = await restPost<ChatCompletion>(originV1Url('chat/completions'), { ...req, stream: false }, headers)
    // A completion just debited cloud credit (gateway meters synchronously) — nudge
    // the shared live balance so every wallet surface reflects the new number now.
    invalidateBalance()
    return res
  },

  /**
   * Open a STREAMING chat completion (Server-Sent Events). Returns the raw
   * `Response` so the caller reads `response.body` chunk-by-chunk — that is what
   * lets the multi-model compare board measure real time-to-first-token and
   * render each model's tokens as they arrive. `stream_options.include_usage`
   * asks the gateway to emit a final usage chunk so prompt/completion token
   * counts (and therefore cost) are REAL, not estimated. Credentials are the
   * session cookie only; the keyless `/ai` proxy mints the bearer the gateway
   * requires and forwards the SSE bytes straight through.
   */
  streamChat: (req: ChatStreamRequest, signal?: AbortSignal): Promise<Response> =>
    fetch(originV1Url('chat/completions'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ ...req, stream: true, stream_options: { include_usage: true } }),
      signal,
      cache: 'no-store',
    }),

  /** Run an embeddings request; returns the raw OpenAI embeddings response. */
  embeddings: (req: EmbeddingsRequest): Promise<EmbeddingsResponse> =>
    restPost<EmbeddingsResponse>(originV1Url('embeddings'), req),

  /**
   * Synthesize speech (text → audio). Returns the audio bytes as a Blob (the
   * gateway responds with audio/*); throws `ApiError` carrying the gateway
   * message on failure so the caller renders an honest state, never silence.
   */
  speech: async (req: SpeechRequest, signal?: AbortSignal): Promise<Blob> => {
    const res = await fetch(originV1Url('audio/speech'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal,
      cache: 'no-store',
    })
    if (!res.ok) {
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
    return res.blob()
  },
}
