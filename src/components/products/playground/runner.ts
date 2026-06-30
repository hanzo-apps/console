/**
 * Runner — the ONE way to run a single model column.
 *
 * Given a model + messages + settings it opens a STREAMING chat completion
 * (`PlaygroundApi.streamChat`), reads the SSE body chunk-by-chunk, and reports:
 *   - streamed text (via `onDelta`, cumulative),
 *   - REAL token usage (the gateway's final usage chunk),
 *   - time-to-first-token (measured at the first content chunk) and total time.
 * It NEVER throws: a failure (or a mid-stream gateway error) resolves as an honest
 * `error` on the result, and a user stop resolves as `aborted` with the partial
 * text kept — so one column can fail or be stopped without disturbing the others.
 */
import { ApiError, PlaygroundApi, type ChatUsage } from '~/lib/api'
import { splitSSE, dataOf, parseChatData } from './stream'
import type { RunError, RunMessage, RunResult } from './types'

/** Reduce any thrown value to a raw transport error (status + message). */
function toRunError(e: unknown): RunError {
  if (e instanceof ApiError) return { status: e.status, message: e.message }
  if (e instanceof Error) return { status: 0, message: e.message }
  return { status: 0, message: String(e) }
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())

export type RunInput = {
  model: string
  messages: RunMessage[]
  temperature?: number
  top_p?: number
  max_tokens?: number
  stop?: string[]
}

export type RunHandlers = {
  /** First content chunk arrived — `ttftMs` is the measured time-to-first-token. */
  onFirstToken?: (ttftMs: number) => void
  /** Cumulative streamed text so far. */
  onDelta?: (content: string) => void
}

export async function runColumn(input: RunInput, handlers: RunHandlers, signal: AbortSignal): Promise<RunResult> {
  const start = now()
  let firstAt: number | null = null
  let content = ''
  let usage: ChatUsage | null = null
  let finishReason: string | null = null

  const settle = (error: RunResult['error'], aborted: boolean): RunResult => ({
    content,
    usage,
    ttftMs: firstAt != null ? firstAt - start : null,
    totalMs: now() - start,
    finishReason,
    aborted,
    error,
  })

  try {
    const res = await PlaygroundApi.streamChat(input, signal)
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

    const consume = (data: string): void => {
      const delta = parseChatData(data)
      if (!delta) return
      if (delta.error) throw new ApiError(delta.error, res.status)
      if (delta.usage) usage = delta.usage
      if (delta.finishReason) finishReason = delta.finishReason
      if (delta.content) {
        if (firstAt == null) {
          firstAt = now()
          handlers.onFirstToken?.(firstAt - start)
        }
        content += delta.content
        handlers.onDelta?.(content)
      }
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const split = splitSSE(buf)
      buf = split.rest
      for (const ev of split.events) {
        const data = dataOf(ev)
        if (data != null) consume(data)
      }
    }
    // Flush a trailing event that lacked a terminating blank line.
    const tail = dataOf(buf)
    if (tail != null) consume(tail)

    return settle(null, false)
  } catch (e) {
    if (signal.aborted) return settle(null, true)
    return settle(toRunError(e), false)
  }
}
