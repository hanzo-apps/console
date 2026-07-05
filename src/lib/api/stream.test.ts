import { describe, expect, it } from 'vitest'

import { streamErrorMessage } from './stream'

describe('streamErrorMessage — plain JSON error envelope on a non-SSE body', () => {
  it('reads the casibase {status:"error", msg} envelope (the live context-length case)', () => {
    const body = JSON.stringify({
      status: 'error',
      msg: 'model "" is not available. Use GET /v1/models to list available models',
      data: null,
      data2: null,
    })
    expect(streamErrorMessage(body)).toBe(
      'model "" is not available. Use GET /v1/models to list available models',
    )
  })

  it('reads an OpenAI-style {error:{message}} envelope', () => {
    expect(streamErrorMessage(JSON.stringify({ error: { message: 'boom' } }))).toBe('boom')
  })

  it('reads an {error:"string"} envelope', () => {
    expect(streamErrorMessage(JSON.stringify({ error: 'nope' }))).toBe('nope')
  })

  it('is null for an SSE buffer (a real streaming completion, not an error)', () => {
    expect(streamErrorMessage('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n')).toBeNull()
  })

  it('is null for a completion object with choices (never mistake a completion for an error)', () => {
    const completion = JSON.stringify({ status: 'error', choices: [{ message: { content: 'x' } }] })
    expect(streamErrorMessage(completion)).toBeNull()
  })

  it('is null for empty / whitespace / non-JSON / a bare success envelope', () => {
    expect(streamErrorMessage('')).toBeNull()
    expect(streamErrorMessage('   ')).toBeNull()
    expect(streamErrorMessage('not json')).toBeNull()
    expect(streamErrorMessage(JSON.stringify({ status: 'ok', data: {} }))).toBeNull()
  })
})
