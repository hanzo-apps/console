import { afterEach, describe, expect, it, vi } from 'vitest'

import { PlaygroundApi } from '~/lib/api'
import { runColumn } from './runner'
import type { RunMessage } from './types'

const enc = new TextEncoder()

/** Build a streaming SSE `Response` from raw chunk strings (as the proxy emits). */
function sse(chunks: string[], status = 200): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch))
      c.close()
    },
  })
  return new Response(stream, { status, headers: { 'content-type': 'text/event-stream' } })
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const MSGS: RunMessage[] = [{ role: 'user', content: 'hi' }]
const fresh = (): AbortSignal => new AbortController().signal

afterEach(() => vi.restoreAllMocks())

describe('runColumn — parallel-safe streaming with real metrics', () => {
  it('aggregates content, captures usage, and measures ttft <= total', async () => {
    vi.spyOn(PlaygroundApi, 'streamChat').mockResolvedValue(
      sse([
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}\n\n',
        'data: [DONE]\n\n',
      ]),
    )
    const deltas: string[] = []
    const r = await runColumn({ model: 'zen', messages: MSGS }, { onDelta: (c) => deltas.push(c) }, fresh())

    expect(r.content).toBe('Hello world')
    expect(r.usage).toEqual({ prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 })
    expect(r.finishReason).toBe('stop')
    expect(r.error).toBeNull()
    expect(r.aborted).toBe(false)
    expect(r.ttftMs).not.toBeNull()
    expect(r.totalMs).not.toBeNull()
    expect((r.totalMs ?? 0) >= (r.ttftMs ?? 0)).toBe(true)
    expect(deltas.at(-1)).toBe('Hello world')
  })

  it('reassembles a delta split across network chunk boundaries', async () => {
    vi.spyOn(PlaygroundApi, 'streamChat').mockResolvedValue(
      sse(['data: {"choices":[{"delta":{"content":"Hel', 'lo"}}]}\n\n', 'data: [DONE]\n\n']),
    )
    const r = await runColumn({ model: 'zen', messages: MSGS }, {}, fresh())
    expect(r.content).toBe('Hello')
    expect(r.error).toBeNull()
  })

  it('surfaces a non-ok HTTP response as a raw error carrying the status (402)', async () => {
    vi.spyOn(PlaygroundApi, 'streamChat').mockResolvedValue(
      jsonResponse(402, { error: { message: 'Insufficient balance. Please add credits.' } }),
    )
    const r = await runColumn({ model: 'zen', messages: MSGS }, {}, fresh())
    expect(r.content).toBe('')
    expect(r.error?.status).toBe(402)
    expect(r.error?.message).toContain('Insufficient balance')
  })

  it('surfaces a mid-stream gateway error, keeping the partial text', async () => {
    vi.spyOn(PlaygroundApi, 'streamChat').mockResolvedValue(
      sse([
        'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
        'data: {"error":{"message":"upstream exploded"}}\n\n',
      ]),
    )
    const r = await runColumn({ model: 'zen', messages: MSGS }, {}, fresh())
    expect(r.error).not.toBeNull()
    expect(r.error?.message).toBe('upstream exploded')
    expect(r.content).toBe('partial')
  })

  it('treats a user stop as aborted (no error card)', async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    vi.spyOn(PlaygroundApi, 'streamChat').mockImplementation(() =>
      Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
    )
    const r = await runColumn({ model: 'zen', messages: MSGS }, {}, ctrl.signal)
    expect(r.aborted).toBe(true)
    expect(r.error).toBeNull()
  })
})
