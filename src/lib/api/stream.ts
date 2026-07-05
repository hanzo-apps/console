/**
 * SSE — pure parsing of the gateway's streaming chat completion.
 *
 * The OpenAI-compatible stream is a sequence of `data: {json}` events separated
 * by blank lines, ending with `data: [DONE]`. Each chunk carries a content delta;
 * the final chunk carries `usage` (because the request sets
 * `stream_options.include_usage`). These functions are pure so every streaming
 * loop (the playground compare board's `runner.ts` AND the chat page's
 * `AiApi.ragChatStream`) is unit-tested without a network — ONE parser, no dupes.
 */
import type { ChatUsage } from './playground'

/** Split a decoded buffer into COMPLETE SSE events + the trailing partial event. */
export function splitSSE(buffer: string): { events: string[]; rest: string } {
  const parts = buffer.split(/\r?\n\r?\n/)
  const rest = parts.pop() ?? ''
  return { events: parts.filter((p) => p.trim().length > 0), rest }
}

/** Join the `data:` lines of one SSE event into its payload (null if none). */
export function dataOf(event: string): string | null {
  const data = event
    .split(/\r?\n/)
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).replace(/^ /, ''))
    .join('\n')
  return data.length > 0 ? data : null
}

/** A parsed streaming chunk. */
export type ChatDelta = {
  content: string
  usage: ChatUsage | null
  finishReason: string | null
  /** A mid-stream error reported by the gateway, if any. */
  error: string | null
  /** The `[DONE]` sentinel. */
  done: boolean
}

/** Parse one chunk's `data:` payload into a delta (null when it isn't valid JSON). */
export function parseChatData(data: string): ChatDelta | null {
  if (data === '[DONE]') return { content: '', usage: null, finishReason: null, error: null, done: true }
  let json: unknown
  try {
    json = JSON.parse(data)
  } catch {
    return null
  }
  if (!json || typeof json !== 'object') return null
  const o = json as {
    choices?: { delta?: { content?: unknown }; finish_reason?: unknown }[]
    usage?: ChatUsage | null
    error?: { message?: unknown } | string
  }
  const choice = o.choices?.[0]
  const content = typeof choice?.delta?.content === 'string' ? choice.delta.content : ''
  const finishReason = typeof choice?.finish_reason === 'string' ? choice.finish_reason : null
  let error: string | null = null
  if (typeof o.error === 'string') error = o.error
  else if (o.error && typeof o.error === 'object' && typeof o.error.message === 'string') error = o.error.message
  return { content, usage: o.usage ?? null, finishReason, error, done: false }
}

/**
 * A gateway error that arrives as a PLAIN JSON envelope on the response body —
 * NOT as an SSE stream. The gateway returns a bare `{status:'error', msg}`
 * (casibase envelope, e.g. a model over its context window or a premium-model
 * 402) or an OpenAI-style `{error:{message}}`; because it has no `data:` prefix,
 * the SSE reader yields NO content and would otherwise return an empty string —
 * surfacing an "(empty response)" bubble that hides the real reason. This
 * detects that body so the reader can throw the gateway's actual message.
 * Returns the message, or null when `raw` is a normal SSE buffer / not an error
 * envelope (a real completion object with `choices` is never treated as an error).
 */
export function streamErrorMessage(raw: string): string | null {
  const s = raw.trim()
  if (!s || s.startsWith('data:')) return null
  let json: unknown
  try {
    json = JSON.parse(s)
  } catch {
    return null
  }
  if (!json || typeof json !== 'object') return null
  const o = json as {
    status?: unknown
    msg?: unknown
    error?: { message?: unknown } | string
    choices?: unknown
  }
  // A completion/chunk object (has `choices`) is not an error envelope.
  if (Array.isArray(o.choices)) return null
  if (typeof o.error === 'string' && o.error) return o.error
  if (o.error && typeof o.error === 'object' && typeof o.error.message === 'string' && o.error.message)
    return o.error.message
  if (o.status === 'error' && typeof o.msg === 'string' && o.msg) return o.msg
  return null
}
