import { afterEach, describe, expect, it, vi } from 'vitest'

import { AiApi } from './ai'
import { PlaygroundApi } from './playground'

const enc = new TextEncoder()

/** Build a streaming SSE `Response` from raw chunk strings (as the /ai proxy emits). */
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

afterEach(() => vi.restoreAllMocks())

describe('AiApi.ragChatStream — grounded streaming send', () => {
  it('accumulates deltas, resolves the final text, and grounds via retrieval headers', async () => {
    const spy = vi.spyOn(PlaygroundApi, 'streamChat').mockResolvedValue(
      sse([
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
        'data: [DONE]\n\n',
      ]),
    )
    const deltas: string[] = []
    const text = await AiApi.ragChatStream(
      { question: 'hi', model: 'zen', store: 'docs' },
      (c) => deltas.push(c),
    )

    expect(text).toBe('Hello world')
    expect(deltas).toEqual(['Hello', 'Hello world'])
    // Grounding: the retrieval switch rode the SAME streaming request.
    const headers = spy.mock.calls[0][2]
    expect(headers).toMatchObject({ 'X-Retrieval': '1', 'X-Retrieval-Store': 'docs' })
    // The user turn is the last message.
    expect(spy.mock.calls[0][0].messages.at(-1)).toEqual({ role: 'user', content: 'hi' })
  })

  it('prepends system + history so the thread keeps context', async () => {
    const spy = vi.spyOn(PlaygroundApi, 'streamChat').mockResolvedValue(sse(['data: [DONE]\n\n']))
    await AiApi.ragChatStream(
      { question: 'q2', model: 'zen', system: 'be brief', history: [{ role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1' }] },
      () => {},
    )
    expect(spy.mock.calls[0][0].messages).toEqual([
      { role: 'system', content: 'be brief' },
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q2' },
    ])
  })

  it('reassembles a delta split across network chunk boundaries', async () => {
    vi.spyOn(PlaygroundApi, 'streamChat').mockResolvedValue(
      sse(['data: {"choices":[{"delta":{"content":"Hel', 'lo"}}]}\n\n', 'data: [DONE]\n\n']),
    )
    const text = await AiApi.ragChatStream({ question: 'hi', model: 'zen' }, () => {})
    expect(text).toBe('Hello')
  })

  it('throws an ApiError carrying the status on a non-ok response (402 billing gate)', async () => {
    vi.spyOn(PlaygroundApi, 'streamChat').mockResolvedValue(
      jsonResponse(402, { error: { message: 'Insufficient balance. Please add credits.' } }),
    )
    await expect(AiApi.ragChatStream({ question: 'hi', model: 'zen' }, () => {})).rejects.toMatchObject({
      status: 402,
      message: expect.stringContaining('Insufficient balance'),
    })
  })

  it('throws on a mid-stream gateway error', async () => {
    vi.spyOn(PlaygroundApi, 'streamChat').mockResolvedValue(
      sse([
        'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
        'data: {"error":{"message":"upstream exploded"}}\n\n',
      ]),
    )
    await expect(AiApi.ragChatStream({ question: 'hi', model: 'zen' }, () => {})).rejects.toThrow('upstream exploded')
  })

  // REGRESSION (the live "(empty response)" bug): the gateway can answer a 200 whose
  // BODY is a plain casibase error envelope (NOT SSE) — e.g. a prompt over the model's
  // context window. That body has no `data:` events, so the stream yields no content;
  // the reader MUST surface the gateway's real message instead of resolving to ''.
  it('surfaces a 200 casibase error envelope (context-length) instead of an empty completion', async () => {
    vi.spyOn(PlaygroundApi, 'streamChat').mockResolvedValue(
      jsonResponse(200, {
        status: 'error',
        msg: 'the token count: [4198] exceeds the model: [minimax-m2.5]\'s maximum token count: [4096]',
        data: null,
        data2: null,
      }),
    )
    await expect(AiApi.ragChatStream({ question: 'hi', model: 'zen' }, () => {})).rejects.toThrow(
      /exceeds the model/,
    )
  })

  it('surfaces a 200 OpenAI-style {error:{message}} envelope instead of an empty completion', async () => {
    vi.spyOn(PlaygroundApi, 'streamChat').mockResolvedValue(
      jsonResponse(200, { error: { message: 'model is not available' } }),
    )
    await expect(AiApi.ragChatStream({ question: 'hi', model: 'zen' }, () => {})).rejects.toThrow(
      'model is not available',
    )
  })

  it('still resolves an empty-but-successful completion (no false error on a blank stream)', async () => {
    vi.spyOn(PlaygroundApi, 'streamChat').mockResolvedValue(sse(['data: [DONE]\n\n']))
    await expect(AiApi.ragChatStream({ question: 'hi', model: 'zen' }, () => {})).resolves.toBe('')
  })
})
