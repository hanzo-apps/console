import { describe, expect, it } from 'vitest'

import { splitThinking } from './thinking'

describe('splitThinking — final answer separated from chain-of-thought', () => {
  it('passes plain content through untouched (no reasoning)', () => {
    expect(splitThinking('PONG')).toEqual({ answer: 'PONG', thinking: '' })
  })

  it('strips a fully-delimited <think>…</think> block, keeping only the answer', () => {
    expect(splitThinking('<think>The user is asking me to reply. I should comply.</think>PONG')).toEqual({
      answer: 'PONG',
      thinking: 'The user is asking me to reply. I should comply.',
    })
  })

  it('handles a leading reasoning run closed by a lone </think> (implicit open)', () => {
    expect(splitThinking('The user is asking me to… I should comply directly.</think>\n\nPONG')).toEqual({
      answer: 'PONG',
      thinking: 'The user is asking me to… I should comply directly.',
    })
  })

  it('is streaming-safe: an unclosed <think> holds its tail out of the answer', () => {
    expect(splitThinking('<think>still reasoning about the reply')).toEqual({
      answer: '',
      thinking: 'still reasoning about the reply',
    })
  })

  it('keeps prose that merely mentions think outside a tag', () => {
    expect(splitThinking('I think the answer is 42.')).toEqual({ answer: 'I think the answer is 42.', thinking: '' })
  })

  it('joins multiple reasoning blocks and preserves the surrounding answer', () => {
    expect(splitThinking('<think>a</think>Hello <think>b</think>world')).toEqual({
      answer: 'Hello world',
      thinking: 'a\n\nb',
    })
  })
})
