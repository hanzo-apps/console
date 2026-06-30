import { describe, it, expect } from 'vitest'

import { splitSSE, dataOf, parseChatData } from './stream'

describe('splitSSE — complete events + trailing partial', () => {
  it('splits on blank lines and keeps the remainder', () => {
    expect(splitSSE('a\n\nb\n\nc')).toEqual({ events: ['a', 'b'], rest: 'c' })
  })

  it('handles a fully-terminated buffer (empty remainder)', () => {
    expect(splitSSE('data: x\n\n')).toEqual({ events: ['data: x'], rest: '' })
  })

  it('treats a partial event as remainder (not yet complete)', () => {
    expect(splitSSE('data: {"a"')).toEqual({ events: [], rest: 'data: {"a"' })
  })
})

describe('dataOf — extract the data payload', () => {
  it('reads a single data line', () => {
    expect(dataOf('data: {"x":1}')).toBe('{"x":1}')
  })
  it('joins multiple data lines and ignores other fields', () => {
    expect(dataOf('event: msg\ndata: line1\ndata: line2')).toBe('line1\nline2')
  })
  it('returns null when there is no data line', () => {
    expect(dataOf('id: 7')).toBeNull()
  })
})

describe('parseChatData — one streamed chunk', () => {
  it('parses the [DONE] sentinel', () => {
    expect(parseChatData('[DONE]')).toEqual({ content: '', usage: null, finishReason: null, error: null, done: true })
  })

  it('reads a content delta', () => {
    const d = parseChatData('{"choices":[{"delta":{"content":"hi"}}]}')
    expect(d?.content).toBe('hi')
    expect(d?.done).toBe(false)
  })

  it('reads the final usage + finish_reason chunk', () => {
    const d = parseChatData('{"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":4,"total_tokens":7}}')
    expect(d?.content).toBe('')
    expect(d?.finishReason).toBe('stop')
    expect(d?.usage).toEqual({ prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 })
  })

  it('surfaces a structured error', () => {
    expect(parseChatData('{"error":{"message":"boom"}}')?.error).toBe('boom')
  })

  it('surfaces a flat string error', () => {
    expect(parseChatData('{"error":"flat"}')?.error).toBe('flat')
  })

  it('returns null on non-JSON', () => {
    expect(parseChatData('not json')).toBeNull()
  })
})
