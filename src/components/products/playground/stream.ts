/**
 * SSE — pure parsing of the gateway's streaming chat completion.
 *
 * The OpenAI-compatible stream is a sequence of `data: {json}` events separated
 * by blank lines, ending with `data: [DONE]`. Each chunk carries a content delta;
 * the final chunk carries `usage` (because the request sets
 * `stream_options.include_usage`). These functions are pure so the streaming loop
 * and token accounting in `runner.ts` are unit-tested without a network.
 */
import type { ChatUsage } from '~/lib/api'

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
