import { describe, expect, it } from 'vitest'

import { parseTrainingData } from './interactive-data'

describe('parseTrainingData', () => {
  it('parses one prompt→completion JSON object per line', () => {
    const out = parseTrainingData('{"prompt":"a","completion":"b"}\n{"prompt":"c","completion":"d"}')
    expect(out.error).toBeUndefined()
    expect(out.data).toEqual([
      { prompt: 'a', completion: 'b' },
      { prompt: 'c', completion: 'd' },
    ])
  })

  it('ignores blank lines and surrounding whitespace', () => {
    const out = parseTrainingData('\n  {"prompt":"a","completion":"b"}  \n\n')
    expect(out.error).toBeUndefined()
    expect(out.data).toHaveLength(1)
  })

  it('accepts a pre-tokenized row', () => {
    const out = parseTrainingData('{"model_input":{"tokens":[1,2,3]},"target_tokens":[2,3,4],"weights":[1,1,1]}')
    expect(out.error).toBeUndefined()
    expect(out.data).toEqual([{ model_input: { tokens: [1, 2, 3] }, target_tokens: [2, 3, 4], weights: [1, 1, 1] }])
  })

  it('reports the offending line on invalid JSON', () => {
    const out = parseTrainingData('{"prompt":"a","completion":"b"}\nnot json')
    expect(out.data).toEqual([])
    expect(out.error).toMatch(/Line 2 is not valid JSON/)
  })

  it('reports a row missing the required shape', () => {
    const out = parseTrainingData('{"prompt":"a"}')
    expect(out.data).toEqual([])
    expect(out.error).toMatch(/Line 1 needs/)
  })

  it('errors on empty input', () => {
    expect(parseTrainingData('   \n  ').error).toMatch(/at least one/)
  })
})
